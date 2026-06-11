// Offline collision pack builder (Slice 5, docs/PLAN.md "Navigation / web-walking").
//
// Replays Engine-TS@274 GameMap.loadGround/loadLocations over every packed
// mapsquare (engine repo, data/pack/.cache/maps-server.zip or
// data/pack/server/maps/) through the vendored rsmod collision engine
// (src/bot/nav/rsmod/), then bakes per-tile walkability + 8-direction step
// legality (rsmod StepValidator semantics) into collision.lcnav.
//
// Usage: bun tools/nav/build-collision.ts [--engine <dir>] [--members true|false]
//                                         [--out <file>] [--verify true|false]
//
// Output format (little-endian):
//   magic 'LCNV' (4 bytes), version u8=1, members u8, reserved u16=0,
//   mapsquareCount u16; then per mapsquare: mx u8, mz u8, levelMask u8
//   (bit L = level L present), then for each present level ascending:
//   4096 bytes exit mask (index = x*64+z; bit 0=N,1=E,2=S,3=W,4=NE,5=SE,
//   6=SW,7=NW = step legal) followed by 512 bytes walkable bitset
//   (bit (x*64+z)&7 of byte (x*64+z)>>3). Unallocated/void tiles: 0/0.

import fs from 'node:fs';
import path from 'node:path';

import { unzipSync } from 'fflate';

import { bunzip2 } from '#/io/BZip2.js';
import CollisionEngine from '#/bot/nav/rsmod/CollisionEngine.js';
import { changeLandCollision, changeLocCollision, changeRoofCollision } from '#/bot/nav/rsmod/collision.js';
import { CollisionFlag, CollisionType } from '#/bot/nav/rsmod/flags.js';
import { canTravel } from '#/bot/nav/rsmod/StepValidator.js';

// ---- minimal big-endian byte reader (Engine-TS@274 src/io/Packet.ts semantics) ----

class Reader {
    readonly data: Uint8Array;
    readonly view: DataView;
    pos = 0;

    constructor(data: Uint8Array) {
        this.data = data;
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }

    get available(): number {
        return this.view.byteLength - this.pos;
    }

    g1(): number {
        return this.view.getUint8(this.pos++);
    }

    g1b(): number {
        return this.view.getInt8(this.pos++);
    }

    g2(): number {
        const result: number = this.view.getUint16(this.pos);
        this.pos += 2;
        return result;
    }

    g2s(): number {
        const result: number = this.view.getInt16(this.pos);
        this.pos += 2;
        return result;
    }

    g3(): number {
        this.pos += 3;
        return (this.data[this.pos - 3] << 16) + (this.data[this.pos - 2] << 8) + this.data[this.pos - 1];
    }

    g4s(): number {
        const result: number = this.view.getInt32(this.pos);
        this.pos += 4;
        return result;
    }

    gbool(): boolean {
        return this.g1() === 1;
    }

    gjstr(terminator: number = 10): string {
        const length: number = this.view.byteLength;
        let str: string = '';
        let b: number;
        while ((b = this.view.getUint8(this.pos++)) !== terminator && this.pos < length) {
            str += String.fromCharCode(b);
        }
        return str;
    }

    // 1-or-2-byte smart: first byte < 0x80 reads u8, else u16 - 0x8000
    gsmarts(): number {
        return this.view.getUint8(this.pos) < 0x80 ? this.g1() : this.g2() - 0x8000;
    }
}

// ---- minimal jagfile reader (Engine-TS@274 src/io/Jagfile.ts semantics) ----
// Needed only to pull loc.dat out of the client config archive; per-file
// streams are headerless bzip2 (decompressed with the client's own bunzip2).

class JagArchive {
    private readonly data: Uint8Array;
    private readonly compressWhole: boolean;
    private readonly fileHash: number[] = [];
    private readonly filePackedSize: number[] = [];
    private readonly filePos: number[] = [];

    constructor(src: Uint8Array) {
        let reader = new Reader(src);
        const unpackedSize: number = reader.g3();
        const packedSize: number = reader.g3();

        if (unpackedSize === packedSize) {
            this.data = src;
            this.compressWhole = false;
        } else {
            // whole-archive compression: re-read the table from the decompressed stream
            this.data = bunzip2(src.subarray(6));
            reader = new Reader(this.data);
            this.compressWhole = true;
        }

        const fileCount: number = reader.g2();
        let pos: number = reader.pos + fileCount * 10;
        for (let i: number = 0; i < fileCount; i++) {
            this.fileHash[i] = reader.g4s();
            reader.g3(); // unpacked size
            this.filePackedSize[i] = reader.g3();
            this.filePos[i] = pos;
            pos += this.filePackedSize[i];
        }
    }

    static genHash(name: string): number {
        let hash: number = 0;
        name = name.toUpperCase();
        for (let i: number = 0; i < name.length; i++) {
            hash = (hash * 61 + name.charCodeAt(i) - 32) | 0;
        }
        return hash;
    }

    read(name: string): Uint8Array | null {
        const hash: number = JagArchive.genHash(name);
        const index: number = this.fileHash.indexOf(hash);
        if (index === -1) {
            return null;
        }
        const src: Uint8Array = this.data.subarray(this.filePos[index], this.filePos[index] + this.filePackedSize[index]);
        return this.compressWhole ? src : bunzip2(src);
    }
}

// ---- minimal LocType decoder (Engine-TS@274 src/cache/config/LocType.ts) ----
// Decodes only what collision needs (width, length, blockwalk, blockrange,
// active — plus models/shapes/op presence for the active postDecode rule);
// every other opcode is consumed per the format and discarded.

class LocDef {
    models: Uint16Array | null = null;
    shapes: Uint8Array | null = null;
    width = 1;
    length = 1;
    blockwalk = true;
    blockrange = true;
    active = -1;
    op: (string | null)[] | null = null;
    debugname: string | null = null;

    decodeType(dat: Reader): void {
        while (dat.available > 0) {
            const code: number = dat.g1();
            if (code === 0) {
                break;
            }
            this.decode(code, dat);
        }
    }

    private decode(code: number, dat: Reader): void {
        if (code === 1) {
            const count = dat.g1();
            this.models = new Uint16Array(count);
            this.shapes = new Uint8Array(count);
            for (let i = 0; i < count; i++) {
                this.models[i] = dat.g2();
                this.shapes[i] = dat.g1();
            }
        } else if (code === 2 || code === 3) {
            dat.gjstr(); // name / desc
        } else if (code === 5) {
            const count = dat.g1();
            this.models = new Uint16Array(count);
            this.shapes = null;
            for (let i = 0; i < count; i++) {
                this.models[i] = dat.g2();
            }
        } else if (code === 14) {
            this.width = dat.g1();
        } else if (code === 15) {
            this.length = dat.g1();
        } else if (code === 17) {
            this.blockwalk = false;
        } else if (code === 18) {
            this.blockrange = false;
        } else if (code === 19) {
            this.active = dat.g1();
        } else if (code === 21 || code === 22 || code === 23 || code === 25 || code === 62 || code === 64 || code === 73 || code === 74) {
            // hillskew / sharelight / occlude / hasalpha / mirror / !shadow / forcedecor / breakroutefinding
        } else if (code === 24 || code === 60 || code === 61 || code === 65 || code === 66 || code === 67 || code === 68) {
            dat.g2(); // anim / mapfunction / category / resizex/y/z / mapscene
        } else if (code === 28 || code === 69 || code === 75) {
            dat.g1(); // wallwidth / forceapproach / raiseobject
        } else if (code === 29 || code === 39) {
            dat.g1b(); // ambient / contrast
        } else if (code >= 30 && code < 35) {
            if (!this.op) {
                this.op = new Array(5).fill(null);
            }
            this.op[code - 30] = dat.gjstr();
        } else if (code === 40) {
            const count = dat.g1();
            for (let i = 0; i < count; i++) {
                dat.g2(); // recol_s
                dat.g2(); // recol_d
            }
        } else if (code === 70 || code === 71 || code === 72) {
            dat.g2s(); // offsetx / offsety / offsetz
        } else if (code === 249) {
            const count = dat.g1();
            for (let i = 0; i < count; i++) {
                dat.g3(); // param id
                if (dat.gbool()) {
                    dat.gjstr();
                } else {
                    dat.g4s();
                }
            }
        } else if (code === 250) {
            this.debugname = dat.gjstr();
        } else {
            throw new Error(`Unrecognized loc config code: ${code} (packed data out of sync?)`);
        }
    }

    postDecode(): void {
        if (this.active === -1) {
            this.active = 0;
            if (this.models && (!this.shapes || (this.shapes && this.shapes[0] === 10))) {
                this.active = 1;
            }
            if (this.op !== null) {
                this.active = 1;
            }
        }
    }
}

function loadLocTypes(engineDir: string): { configs: LocDef[]; names: Map<string, number> } {
    const server = new Reader(new Uint8Array(fs.readFileSync(path.join(engineDir, 'data/pack/server/loc.dat'))));
    const jag = new JagArchive(new Uint8Array(fs.readFileSync(path.join(engineDir, 'data/pack/client/config'))));
    const clientDat = jag.read('loc.dat');
    if (!clientDat) {
        throw new Error('loc.dat missing from client config archive');
    }
    const client = new Reader(clientDat);

    const count = server.g2();
    client.pos = 2;

    const configs: LocDef[] = [];
    const names = new Map<string, number>();
    for (let id = 0; id < count; id++) {
        const config = new LocDef();
        config.decodeType(server);
        config.decodeType(client);
        config.postDecode();
        configs[id] = config;
        if (config.debugname) {
            names.set(config.debugname, id);
        }
    }
    return { configs, names };
}

// ---- GameMap port (Engine-TS@274 src/engine/GameMap.ts, collision parts only) ----

const OPEN = 0x0;
const BLOCK_MAP_SQUARE = 0x1;
const LINK_BELOW = 0x2;
const REMOVE_ROOFS = 0x4;

const LEVELS = 4;
const MAP_X = 64;
const MAP_Z = 64;
const MAPSQUARE = MAP_X * LEVELS * MAP_Z;

// ZoneMap.zoneIndex (src/engine/zone/ZoneMap.ts)
function zoneIndex(x: number, z: number, level: number): number {
    return ((x >> 3) & 0x7ff) | (((z >> 3) & 0x7ff) << 11) | ((level & 0x3) << 22);
}

function packCoord(x: number, z: number, level: number): number {
    return (z & 0x3f) | ((x & 0x3f) << 6) | ((level & 0x3) << 12);
}

function unpackCoord(packed: number): { x: number; z: number; level: number } {
    const z: number = packed & 0x3f;
    const x: number = (packed >> 6) & 0x3f;
    const level: number = (packed >> 12) & 0x3;
    return { x, z, level };
}

class CollisionBuilder {
    readonly collision = new CollisionEngine();
    private readonly members: boolean;
    private readonly freemap = new Set<number>();
    private readonly locTypes: LocDef[];

    constructor(members: boolean, locTypes: LocDef[]) {
        this.members = members;
        this.locTypes = locTypes;
    }

    loadFreeToPlayZones(csvPath: string): number {
        const csv = fs.readFileSync(csvPath, 'ascii').split(/\r?\n/);
        for (let index = 0; index < csv.length; index++) {
            const line = csv[index];
            if (line.startsWith('//') || !line.length) {
                continue;
            }
            const [y, mx, mz, lx, lz] = line.split('_').map(Number);
            if (lx % 8 !== 0 || lz % 8 !== 0) {
                console.warn('free2play.csv line is not aligned to a zone: ' + line);
            }
            this.freemap.add(zoneIndex((mx << 6) + lx, (mz << 6) + lz, y));
        }
        return this.freemap.size;
    }

    private isFreeToPlay(x: number, z: number): boolean {
        return this.freemap.has(zoneIndex(x, z, 0));
    }

    private bordersFreeToPlay(x: number, z: number): boolean {
        return this.isFreeToPlay(x + 1, z) || this.isFreeToPlay(x - 1, z) || this.isFreeToPlay(x, z + 1) || this.isFreeToPlay(x, z - 1);
    }

    loadMapsquare(landData: Uint8Array, locData: Uint8Array, mapsquareX: number, mapsquareZ: number): void {
        const lands = new Int8Array(MAPSQUARE);
        this.loadGround(lands, new Reader(landData), mapsquareX, mapsquareZ);
        this.loadLocations(lands, new Reader(locData), mapsquareX, mapsquareZ);
    }

    private loadGround(lands: Int8Array, packet: Reader, mapsquareX: number, mapsquareZ: number): void {
        for (let level: number = 0; level < LEVELS; level++) {
            for (let x: number = 0; x < MAP_X; x++) {
                for (let z: number = 0; z < MAP_Z; z++) {
                    while (true) {
                        const opcode: number = packet.g1();
                        if (opcode === 0) {
                            break;
                        } else if (opcode === 1) {
                            packet.pos++;
                            break;
                        }

                        if (opcode <= 49) {
                            packet.pos++;
                        } else if (opcode <= 81) {
                            lands[packCoord(x, z, level)] = opcode - 49;
                        }
                    }
                }
            }
        }
        for (let level: number = 0; level < LEVELS; level++) {
            for (let x: number = 0; x < MAP_X; x++) {
                const absoluteX: number = x + mapsquareX;

                for (let z: number = 0; z < MAP_Z; z++) {
                    const absoluteZ: number = z + mapsquareZ;

                    if (!this.members && !this.isFreeToPlay(absoluteX, absoluteZ) && !this.bordersFreeToPlay(absoluteX, absoluteZ)) {
                        continue;
                    }

                    if (x % 7 === 0 && z % 7 === 0) {
                        // allocate per zone
                        this.collision.allocateIfAbsent(absoluteX, absoluteZ, level);
                    }

                    const land: number = lands[packCoord(x, z, level)];

                    if ((land & REMOVE_ROOFS) !== OPEN) {
                        changeRoofCollision(this.collision, absoluteX, absoluteZ, level, true);
                    }

                    if ((land & BLOCK_MAP_SQUARE) !== BLOCK_MAP_SQUARE) {
                        continue;
                    }

                    const bridged: boolean = (level === 1 ? land & LINK_BELOW : lands[packCoord(x, z, 1)] & LINK_BELOW) === LINK_BELOW;
                    const actualLevel: number = bridged ? level - 1 : level;
                    if (actualLevel < 0) {
                        continue;
                    }

                    changeLandCollision(this.collision, absoluteX, absoluteZ, actualLevel, true);
                }
            }
        }
    }

    private loadLocations(lands: Int8Array, packet: Reader, mapsquareX: number, mapsquareZ: number): void {
        let locId: number = -1;
        let locIdOffset: number = packet.gsmarts();
        while (locIdOffset !== 0) {
            locId += locIdOffset;

            let coord: number = 0;
            let coordOffset: number = packet.gsmarts();

            while (coordOffset !== 0) {
                const { x, z, level } = unpackCoord((coord += coordOffset - 1));

                const info: number = packet.g1();
                coordOffset = packet.gsmarts();

                const absoluteX: number = x + mapsquareX;
                const absoluteZ: number = z + mapsquareZ;

                if (!this.members && !this.isFreeToPlay(absoluteX, absoluteZ) && !this.bordersFreeToPlay(absoluteX, absoluteZ)) {
                    continue;
                }

                const bridged: boolean = (level === 1 ? lands[coord] & LINK_BELOW : lands[packCoord(x, z, 1)] & LINK_BELOW) === LINK_BELOW;
                const actualLevel: number = bridged ? level - 1 : level;
                if (actualLevel < 0) {
                    continue;
                }

                const type: LocDef = this.locTypes[locId];
                if (!type) {
                    throw new Error(`Invalid loc type ${locId} in map m${mapsquareX >> 6}_${mapsquareZ >> 6}`);
                }

                const width: number = type.width;
                const length: number = type.length;
                const shape: number = info >> 2;
                const angle: number = info & 0x3;

                if (type.blockwalk) {
                    changeLocCollision(this.collision, shape, angle, type.blockrange, length, width, type.active, absoluteX, absoluteZ, actualLevel, true);
                }
            }
            locIdOffset = packet.gsmarts();
        }
    }
}

// ---- baking ----

// bit order 0=N,1=E,2=S,3=W,4=NE,5=SE,6=SW,7=NW
const DIRS: [number, number][] = [
    [0, 1], // N
    [1, 0], // E
    [0, -1], // S
    [-1, 0], // W
    [1, 1], // NE
    [1, -1], // SE
    [-1, -1], // SW
    [-1, 1] // NW
];

interface BakedLevel {
    exit: Uint8Array; // 4096 bytes, index = x*64+z
    walk: Uint8Array; // 512-byte bitset, bit (x*64+z)&7 of byte (x*64+z)>>3
    allocatedTiles: number;
    walkableTiles: number;
}

interface BakedMapsquare {
    mx: number;
    mz: number;
    levels: (BakedLevel | null)[];
}

function bakeMapsquare(collision: CollisionEngine, mx: number, mz: number): BakedMapsquare {
    const mapsquareX = mx << 6;
    const mapsquareZ = mz << 6;
    const levels: (BakedLevel | null)[] = [null, null, null, null];

    for (let level = 0; level < LEVELS; level++) {
        // a level is present iff at least one of its 8x8 zones is allocated
        const zoneAllocated: boolean[] = [];
        let any = false;
        for (let zx = 0; zx < 8; zx++) {
            for (let zz = 0; zz < 8; zz++) {
                const allocated = collision.isZoneAllocated(mapsquareX + (zx << 3), mapsquareZ + (zz << 3), level);
                zoneAllocated[zx * 8 + zz] = allocated;
                any ||= allocated;
            }
        }
        if (!any) {
            continue;
        }

        const exit = new Uint8Array(MAP_X * MAP_Z);
        const walk = new Uint8Array((MAP_X * MAP_Z) >> 3);
        let allocatedTiles = 0;
        let walkableTiles = 0;

        for (let x = 0; x < MAP_X; x++) {
            for (let z = 0; z < MAP_Z; z++) {
                if (!zoneAllocated[(x >> 3) * 8 + (z >> 3)]) {
                    continue; // unallocated/void: exit 0, walkable 0
                }
                allocatedTiles++;

                const absX = mapsquareX + x;
                const absZ = mapsquareZ + z;
                const index = x * 64 + z;

                if ((collision.get(absX, absZ, level) & CollisionFlag.WALK_BLOCKED) === CollisionFlag.OPEN) {
                    walk[index >> 3] |= 1 << (index & 0x7);
                    walkableTiles++;
                }

                let mask = 0;
                for (let dir = 0; dir < 8; dir++) {
                    if (canTravel(collision, level, absX, absZ, DIRS[dir][0], DIRS[dir][1], 1, 0, CollisionType.NORMAL)) {
                        mask |= 1 << dir;
                    }
                }
                exit[index] = mask;
            }
        }

        levels[level] = { exit, walk, allocatedTiles, walkableTiles };
    }

    return { mx, mz, levels };
}

function writePack(baked: BakedMapsquare[], members: boolean): Uint8Array<ArrayBuffer> {
    const emitted = baked.filter(ms => ms.levels.some(level => level !== null));

    let size = 10;
    for (const ms of emitted) {
        size += 3 + ms.levels.filter(level => level !== null).length * (4096 + 512);
    }

    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let pos = 0;

    out[pos++] = 0x4c; // 'L'
    out[pos++] = 0x43; // 'C'
    out[pos++] = 0x4e; // 'N'
    out[pos++] = 0x56; // 'V'
    out[pos++] = 1; // version
    out[pos++] = members ? 1 : 0;
    view.setUint16(pos, 0, true); // reserved
    pos += 2;
    view.setUint16(pos, emitted.length, true);
    pos += 2;

    for (const ms of emitted) {
        out[pos++] = ms.mx;
        out[pos++] = ms.mz;
        let levelMask = 0;
        for (let level = 0; level < LEVELS; level++) {
            if (ms.levels[level]) {
                levelMask |= 1 << level;
            }
        }
        out[pos++] = levelMask;
        for (let level = 0; level < LEVELS; level++) {
            const baked = ms.levels[level];
            if (!baked) {
                continue;
            }
            out.set(baked.exit, pos);
            pos += 4096;
            out.set(baked.walk, pos);
            pos += 512;
        }
    }

    if (pos !== size) {
        throw new Error(`pack size mismatch: wrote ${pos}, expected ${size}`);
    }
    return out;
}

// ---- verification ----

class Verifier {
    failures = 0;
    private readonly byKey = new Map<number, BakedMapsquare>();

    constructor(baked: BakedMapsquare[]) {
        for (const ms of baked) {
            this.byKey.set((ms.mx << 8) | ms.mz, ms);
        }
    }

    private levelAt(x: number, z: number, level: number): BakedLevel | null {
        return this.byKey.get(((x >> 6) << 8) | (z >> 6))?.levels[level] ?? null;
    }

    walkable(x: number, z: number, level: number): boolean {
        const baked = this.levelAt(x, z, level);
        if (!baked) {
            return false;
        }
        const index = (x & 0x3f) * 64 + (z & 0x3f);
        return (baked.walk[index >> 3] & (1 << (index & 0x7))) !== 0;
    }

    exitMask(x: number, z: number, level: number): number {
        const baked = this.levelAt(x, z, level);
        if (!baked) {
            return 0;
        }
        return baked.exit[(x & 0x3f) * 64 + (z & 0x3f)];
    }

    check(label: string, ok: boolean): void {
        console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
        if (!ok) {
            this.failures++;
        }
    }
}

function verify(baked: BakedMapsquare[], collision: CollisionEngine, locs: { configs: LocDef[]; names: Map<string, number> }): number {
    console.log('verify:');
    const v = new Verifier(baked);

    // loc decode sanity against content-repo ground truth: [tree] is a 2x2
    // blockwalk/blockrange loc with ops (active=1) in this content build
    const treeId = locs.names.get('tree');
    const tree = treeId !== undefined ? locs.configs[treeId] : undefined;
    v.check("loc 'tree' decoded 2x2 blockwalk blockrange active", !!tree && tree.width === 2 && tree.length === 2 && tree.blockwalk && tree.blockrange && tree.active === 1);
    const stumpId = locs.names.get('treestump');
    const stump = stumpId !== undefined ? locs.configs[stumpId] : undefined;
    v.check("loc 'treestump' decoded 1x1 blockwalk", !!stump && stump.width === 1 && stump.length === 1 && stump.blockwalk);

    // walkable world tiles (level 0)
    v.check('(3222,3218) Lumbridge castle courtyard walkable', v.walkable(3222, 3218, 0));
    v.check('(3232,3298) chicken pen east Lumbridge walkable', v.walkable(3232, 3298, 0));
    v.check('(3230,3250) walkable', v.walkable(3230, 3250, 0));

    // water: River Lum south of the Lumbridge bridge. The plan's guess
    // (3228,3265) turned out to be the west bank (walkable); probing the
    // baked grid puts the river at x=3231..3238 there, with pure FLOOR
    // (0x200000) flags — these two tiles are mid-river water.
    for (const [x, z] of [
        [3231, 3265],
        [3232, 3264]
    ]) {
        const water = !v.walkable(x, z, 0);
        v.check(`(${x},${z}) River Lum water not walkable`, water);
        if (!water) {
            console.log('    water probe (flags, w=walkable):');
            for (let pz = z + 2; pz >= z - 2; pz--) {
                let row = `    z=${pz}:`;
                for (let px = x - 4; px <= x + 4; px++) {
                    row += ` ${px},${pz}=${collision.get(px, pz, 0).toString(16)}${v.walkable(px, pz, 0) ? 'w' : ''}`;
                }
                console.log(row);
            }
        }
    }

    // chicken pen fence line: the pen's east fence runs between x=3236 and
    // x=3237 (the plan guessed 3235/3236; the baked grid puts the E-step
    // block one tile east) — crossing must be blocked both ways
    let blockedPairs = 0;
    let openPair = -1;
    for (let z = 3290; z <= 3300; z++) {
        const eastBlocked = (v.exitMask(3236, z, 0) & 0x2) === 0; // bit 1 = E
        const westBlocked = (v.exitMask(3237, z, 0) & 0x8) === 0; // bit 3 = W
        if (eastBlocked && westBlocked) {
            blockedPairs++;
        } else {
            openPair = z;
        }
    }
    v.check(`chicken pen fence blocks E/W crossing at x=3236/3237 (${blockedPairs}/11 pairs blocked)`, blockedPairs > 0);
    if (blockedPairs === 0 && openPair !== -1) {
        console.log(`    e.g. z=${openPair}: exit(3236)=${v.exitMask(3236, openPair, 0).toString(2)} exit(3237)=${v.exitMask(3237, openPair, 0).toString(2)}`);
    }

    // exit masks must agree with the walkable bit (a legal step implies an
    // enterable destination): spot-check the courtyard tile's neighbors
    let consistent = true;
    const mask = v.exitMask(3222, 3218, 0);
    for (let dir = 0; dir < 8; dir++) {
        if ((mask & (1 << dir)) !== 0 && !v.walkable(3222 + DIRS[dir][0], 3218 + DIRS[dir][1], 0)) {
            consistent = false;
        }
    }
    v.check('(3222,3218) exit mask consistent with neighbor walkability', consistent);

    return v.failures;
}

// ---- main ----

function parseArgs(): { engine: string; members: boolean; out: string; verify: boolean } {
    const args = process.argv.slice(2);
    let engine = '/Users/elliotninjaone/code/lostcity-dev/engine';
    let members = true;
    let out = 'out/collision.lcnav';
    let verifyFlag = true;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--engine') {
            engine = args[++i];
        } else if (args[i] === '--members') {
            members = args[++i] !== 'false';
        } else if (args[i] === '--out') {
            out = args[++i];
        } else if (args[i] === '--verify') {
            verifyFlag = args[++i] !== 'false';
        } else if (args[i] === '--no-verify') {
            verifyFlag = false;
        } else {
            console.error(`unknown argument: ${args[i]}`);
            process.exit(2);
        }
    }
    return { engine, members, out, verify: verifyFlag };
}

function main(): void {
    const opts = parseArgs();
    const started = performance.now();

    console.log(`engine: ${opts.engine}`);
    console.log(`members: ${opts.members}`);

    const locs = loadLocTypes(opts.engine);
    console.log(`loc types: ${locs.configs.length}`);

    const builder = new CollisionBuilder(opts.members, locs.configs);

    // Environment.build.srcDir defaults to '../content' relative to the engine dir
    const f2pCsv = path.resolve(opts.engine, '../content/maps/free2play.csv');
    if (fs.existsSync(f2pCsv)) {
        console.log(`free2play zones: ${builder.loadFreeToPlayZones(f2pCsv)} (${f2pCsv})`);
    } else if (!opts.members) {
        throw new Error(`--members false requires free2play.csv (looked at ${f2pCsv})`);
    }

    // load every mapsquare, zip cache first like the engine does
    const squares: { mx: number; mz: number }[] = [];
    const zipPath = path.join(opts.engine, 'data/pack/.cache/maps-server.zip');
    const dirPath = path.join(opts.engine, 'data/pack/server/maps');
    if (fs.existsSync(zipPath)) {
        const mapEntries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
        const maps: string[] = Object.keys(mapEntries).filter(name => name[0] === 'm');
        for (const map of maps) {
            const [mx, mz] = map.substring(1).split('_').map(Number);
            builder.loadMapsquare(mapEntries[`m${mx}_${mz}`], mapEntries[`l${mx}_${mz}`], mx << 6, mz << 6);
            squares.push({ mx, mz });
        }
    } else if (fs.existsSync(dirPath)) {
        const maps: string[] = fs.readdirSync(dirPath).filter(x => x[0] === 'm');
        for (const map of maps) {
            const [mx, mz] = map.substring(1).split('_').map(Number);
            builder.loadMapsquare(new Uint8Array(fs.readFileSync(path.join(dirPath, `m${mx}_${mz}`))), new Uint8Array(fs.readFileSync(path.join(dirPath, `l${mx}_${mz}`))), mx << 6, mz << 6);
            squares.push({ mx, mz });
        }
    } else {
        throw new Error(`no maps found (looked at ${zipPath} and ${dirPath})`);
    }
    squares.sort((a, b) => a.mx - b.mx || a.mz - b.mz);
    const loaded = performance.now();
    console.log(`mapsquares loaded: ${squares.length} (${(loaded - started).toFixed(0)}ms, ${builder.collision.zoneCount()} zones)`);

    const baked: BakedMapsquare[] = squares.map(({ mx, mz }) => bakeMapsquare(builder.collision, mx, mz));
    const raw = writePack(baked, opts.members);
    const gz = Bun.gzipSync(raw, { level: 9 });

    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, raw);
    fs.writeFileSync(`${opts.out}.gz`, gz);

    const emitted = baked.filter(ms => ms.levels.some(level => level !== null));
    console.log('report:');
    console.log(`  mapsquares: ${emitted.length} emitted of ${squares.length} parsed`);
    for (let level = 0; level < LEVELS; level++) {
        let allocated = 0;
        let walkable = 0;
        let present = 0;
        for (const ms of baked) {
            const data = ms.levels[level];
            if (data) {
                present++;
                allocated += data.allocatedTiles;
                walkable += data.walkableTiles;
            }
        }
        console.log(`  level ${level}: ${present} mapsquares, ${allocated} allocated tiles, ${walkable} walkable`);
    }
    console.log(`  raw: ${raw.length} bytes (${(raw.length / 1048576).toFixed(2)} MB) -> ${opts.out}`);
    console.log(`  gzip: ${gz.length} bytes (${(gz.length / 1048576).toFixed(2)} MB) -> ${opts.out}.gz`);
    console.log(`  elapsed: ${((performance.now() - started) / 1000).toFixed(1)}s`);

    if (opts.verify) {
        const failures = verify(baked, builder.collision, locs);
        if (failures > 0) {
            console.error(`${failures} verification check(s) failed`);
            process.exit(1);
        }
    }
}

main();
