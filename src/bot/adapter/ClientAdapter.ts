import { MiniMenuAction } from '#/client/MiniMenuAction.js';
import Skill from '#/client/Skill.js';
import { ButtonType, ComponentType } from '#/config/IfType.js';
import IfType from '#/config/IfType.js';
import LocType from '#/config/LocType.js';
import ObjType from '#/config/ObjType.js';

import { SELF_TEST, type RawClient } from './RawClient.js';

const SCENE_SIZE = 104;
/** Scratch minimenu slot for direct actions (arrays are length 500; the real
 *  menu builder never reaches this high). */
const SCRATCH_SLOT = 499;

/**
 * THE ONLY file that reads or writes client internals. Everything else in
 * src/bot/ goes through `reader` (and, from Slice 3, `actions`). An upstream
 * rename is fixed here and in RawClient.ts — nowhere else.
 */

let raw: RawClient | null = null;
let packetListener: ((ptype: number) => void) | null = null;

export interface WorldTile {
    x: number;
    z: number;
    level: number;
}

export interface ChatLine {
    type: number;
    username: string | null;
    text: string;
}

export interface StatSnapshot {
    name: string;
    effective: number;
    base: number;
    xp: number;
}

export interface NpcSnapshot {
    /** Scene slot index — stable while the NPC stays in the scene. */
    index: number;
    name: string | null;
    /** Combat level shown in the minimenu (-1 if none). */
    level: number;
    tile: WorldTile;
    /** Chebyshev tile distance from the local player. */
    distance: number;
    /** Right-click ops from the npc type (interact by matching these). */
    ops: (string | null)[];
    /** In combat (health bar showing) right now. */
    inCombat: boolean;
    health: number;
    totalHealth: number;
}

export interface PlayerSnapshot {
    index: number;
    name: string | null;
    tile: WorldTile;
    distance: number;
    inCombat: boolean;
}

export interface LocSnapshot {
    /** Scene typecode — menuParamA for OPLOC*. */
    typecode: number;
    id: number;
    name: string | null;
    ops: (string | null)[];
    tile: WorldTile;
    distance: number;
}

export interface GroundItemSnapshot {
    id: number;
    name: string | null;
    count: number;
    ops: (string | null)[];
    tile: WorldTile;
    distance: number;
}

export interface InvItemSnapshot {
    slot: number;
    id: number;
    name: string | null;
    count: number;
    /** Held ops (iop), e.g. Bury/Eat/Wield. */
    ops: (string | null)[];
    /** The TYPE_INV component this item sits on — menuParamC for OPHELD*. */
    comId: number;
}

/**
 * Bind the adapter to the live client and install the packet hook (H4).
 * Returns the list of expected internal names missing on the instance —
 * non-empty means an upstream merge moved something (shown as a red banner
 * in the panel; fix in adapter/).
 */
export function attach(client: unknown): string[] {
    const missing = SELF_TEST.filter(name => !(name in (client as Record<string, unknown>)));
    raw = client as RawClient;

    // H4: wrap tcpIn — one packet per `true` return; ptype0 holds the opcode.
    if (!missing.includes('tcpIn')) {
        const orig = raw.tcpIn;
        raw.tcpIn = async function (this: RawClient): Promise<boolean> {
            const processed = await orig.call(this);
            if (processed && packetListener) {
                try {
                    packetListener(this.ptype0);
                } catch (err) {
                    console.error('[lcbuddy] packet listener error', err);
                }
            }
            return processed;
        };
    }

    return missing;
}

export function setPacketListener(cb: ((ptype: number) => void) | null): void {
    packetListener = cb;
}

export const reader = {
    attached(): boolean {
        return raw !== null;
    },

    ingame(): boolean {
        return raw?.ingame ?? false;
    },

    sceneState(): number {
        return raw?.sceneState ?? 0;
    },

    worldTile(): WorldTile | null {
        if (!raw || !raw.localPlayer) {
            return null;
        }

        return {
            x: raw.mapBuildBaseX + (raw.localPlayer.x >> 7),
            z: raw.mapBuildBaseZ + (raw.localPlayer.z >> 7),
            level: raw.minusedlevel
        };
    },

    energy(): number {
        return raw?.runenergy ?? 0;
    },

    weight(): number {
        return raw?.runweight ?? 0;
    },

    skillCount(): number {
        return Skill.count;
    },

    skillUsed(index: number): boolean {
        return Skill.used[index] ?? false;
    },

    stat(index: number): StatSnapshot {
        return {
            name: Skill.names[index] ?? `#${index}`,
            effective: raw?.statEffectiveLevel[index] ?? 0,
            base: raw?.statBaseLevel[index] ?? 0,
            xp: raw?.statXP[index] ?? 0
        };
    },

    varp(index: number): number {
        return raw?.var[index] ?? 0;
    },

    chat(count: number): ChatLine[] {
        const lines: ChatLine[] = [];
        if (!raw) {
            return lines;
        }

        for (let i = 0; i < count && i < 100; i++) {
            const text = raw.chatText[i];
            if (text === null) {
                break;
            }

            lines.push({ type: raw.chatType[i], username: raw.chatUsername[i], text });
        }

        return lines;
    },

    playerCount(): number {
        return raw?.playerCount ?? 0;
    },

    npcCount(): number {
        return raw?.npcCount ?? 0;
    },

    npcs(): NpcSnapshot[] {
        const out: NpcSnapshot[] = [];
        if (!raw || !raw.localPlayer) {
            return out;
        }

        const px = raw.mapBuildBaseX + (raw.localPlayer.x >> 7);
        const pz = raw.mapBuildBaseZ + (raw.localPlayer.z >> 7);

        for (let i = 0; i < raw.npcCount; i++) {
            const npc = raw.npc[raw.npcIds[i]];
            if (!npc) {
                continue;
            }

            const x = raw.mapBuildBaseX + (npc.x >> 7);
            const z = raw.mapBuildBaseZ + (npc.z >> 7);
            out.push({
                index: raw.npcIds[i],
                name: npc.type?.name ?? null,
                level: npc.type?.vislevel ?? -1,
                tile: { x, z, level: raw.minusedlevel },
                distance: Math.max(Math.abs(x - px), Math.abs(z - pz)),
                ops: npc.type?.op ?? [],
                inCombat: combatShowing(npc.combatCycle),
                health: npc.health,
                totalHealth: npc.totalHealth
            });
        }

        return out;
    },

    players(): PlayerSnapshot[] {
        const out: PlayerSnapshot[] = [];
        if (!raw || !raw.localPlayer) {
            return out;
        }

        const px = raw.mapBuildBaseX + (raw.localPlayer.x >> 7);
        const pz = raw.mapBuildBaseZ + (raw.localPlayer.z >> 7);

        for (let i = 0; i < raw.playerCount; i++) {
            const player = raw.players[raw.playerIds[i]];
            if (!player) {
                continue;
            }

            const x = raw.mapBuildBaseX + (player.x >> 7);
            const z = raw.mapBuildBaseZ + (player.z >> 7);
            out.push({
                index: raw.playerIds[i],
                name: player.name,
                tile: { x, z, level: raw.minusedlevel },
                distance: Math.max(Math.abs(x - px), Math.abs(z - pz)),
                inCombat: combatShowing(player.combatCycle)
            });
        }

        return out;
    },

    /** Local player in combat (health bar showing). */
    inCombat(): boolean {
        return raw?.localPlayer ? combatShowing(raw.localPlayer.combatCycle) : false;
    },

    /** Every loc in the scene at the current level (walls, scenery, ground decor). */
    locs(): LocSnapshot[] {
        const out: LocSnapshot[] = [];
        if (!raw || !raw.world || !raw.localPlayer) {
            return out;
        }

        const level = raw.minusedlevel;
        const px = raw.mapBuildBaseX + (raw.localPlayer.x >> 7);
        const pz = raw.mapBuildBaseZ + (raw.localPlayer.z >> 7);

        for (let lx = 0; lx < SCENE_SIZE; lx++) {
            for (let lz = 0; lz < SCENE_SIZE; lz++) {
                // note decorType takes (level, z, x) — upstream quirk
                const typecodes = [raw.world.wallType(level, lx, lz), raw.world.sceneType(level, lx, lz), raw.world.gdType(level, lx, lz), raw.world.decorType(level, lz, lx)];

                for (const typecode of typecodes) {
                    if (typecode === 0) {
                        continue;
                    }

                    const id = (typecode >> 14) & 0x7fff;
                    const loc = LocType.list(id);
                    const x = raw.mapBuildBaseX + lx;
                    const z = raw.mapBuildBaseZ + lz;

                    out.push({
                        typecode,
                        id,
                        name: loc.name,
                        ops: loc.op ?? [],
                        tile: { x, z, level },
                        distance: Math.max(Math.abs(x - px), Math.abs(z - pz))
                    });
                }
            }
        }

        return out;
    },

    groundItems(): GroundItemSnapshot[] {
        const out: GroundItemSnapshot[] = [];
        if (!raw || !raw.localPlayer) {
            return out;
        }

        const level = raw.minusedlevel;
        const px = raw.mapBuildBaseX + (raw.localPlayer.x >> 7);
        const pz = raw.mapBuildBaseZ + (raw.localPlayer.z >> 7);

        for (let lx = 0; lx < SCENE_SIZE; lx++) {
            for (let lz = 0; lz < SCENE_SIZE; lz++) {
                const stack = raw.groundObj[level][lx][lz];
                if (!stack) {
                    continue;
                }

                const x = raw.mapBuildBaseX + lx;
                const z = raw.mapBuildBaseZ + lz;
                const distance = Math.max(Math.abs(x - px), Math.abs(z - pz));

                for (let obj = stack.head(); obj; obj = stack.next()) {
                    const type = ObjType.list(obj.id);
                    out.push({
                        id: obj.id,
                        name: type.name,
                        count: obj.count,
                        ops: groundOps(type.op),
                        tile: { x, z, level },
                        distance
                    });
                }
            }
        }

        return out;
    },

    /** Inventory (backpack) contents, resolved from the live TYPE_INV component. */
    inventory(): InvItemSnapshot[] {
        const out: InvItemSnapshot[] = [];
        const comId = findInvComponent();
        if (comId === -1) {
            return out;
        }

        const com = IfType.list[comId];
        if (!com.linkObjType || !com.linkObjNumber) {
            return out;
        }

        for (let slot = 0; slot < com.linkObjType.length; slot++) {
            const idPlusOne = com.linkObjType[slot];
            if (idPlusOne <= 0) {
                continue;
            }

            const id = idPlusOne - 1;
            const type = ObjType.list(id);
            out.push({
                slot,
                id,
                name: type.name,
                count: com.linkObjNumber[slot],
                ops: heldOps(type.iop),
                comId
            });
        }

        return out;
    },

    inventorySize(): number {
        const comId = findInvComponent();
        if (comId === -1) {
            return 0;
        }

        return IfType.list[comId].linkObjType?.length ?? 0;
    },

    /** Component id of the active "Click here to continue" button, or -1. */
    chatContinueComId(): number {
        if (!raw || raw.chatModalId === -1 || raw.resumedPauseButton) {
            return -1;
        }

        const modal = IfType.list[raw.chatModalId];
        if (!modal?.children) {
            return -1;
        }

        for (const childId of modal.children) {
            const child = IfType.list[childId];
            if (child && child.buttonType === ButtonType.BUTTON_CONTINUE) {
                return childId;
            }
        }

        return -1;
    },

    /** World tile -> scene-local, or null when outside the loaded scene. */
    toLocal(x: number, z: number): { lx: number; lz: number } | null {
        if (!raw) {
            return null;
        }

        const lx = x - raw.mapBuildBaseX;
        const lz = z - raw.mapBuildBaseZ;
        if (lx < 0 || lz < 0 || lx >= SCENE_SIZE || lz >= SCENE_SIZE) {
            return null;
        }

        return { lx, lz };
    },

    localPlayerName(): string | null {
        return raw?.localPlayer?.name ?? null;
    },

    menuEntries(): string[] {
        if (!raw) {
            return [];
        }

        return raw.menuOption.slice(0, raw.menuNumEntries);
    },

    modals(): { main: number; side: number; chat: number } {
        return {
            main: raw?.mainModalId ?? -1,
            side: raw?.sideModalId ?? -1,
            chat: raw?.chatModalId ?? -1
        };
    }
};

/**
 * Direct interaction surface (Slice 3). Only input drivers call these. Every
 * op goes through the client's own doAction/tryMove so anticheat counters,
 * approach logic and packet bytes are exactly what a human click produces.
 */
export const actions = {
    /**
     * Dispatch a minimenu action with explicit params through a scratch menu
     * slot. Returns false when the client isn't attached/ingame.
     */
    menuAction(action: number, a: number, b: number, c: number): boolean {
        if (!raw || !raw.ingame) {
            return false;
        }

        raw.menuAction[SCRATCH_SLOT] = action;
        raw.menuParamA[SCRATCH_SLOT] = a;
        raw.menuParamB[SCRATCH_SLOT] = b;
        raw.menuParamC[SCRATCH_SLOT] = c;
        raw.doAction(SCRATCH_SLOT);
        return true;
    },

    /**
     * Walk toward a scene-local tile (MOVE_GAMECLICK, nearest-snap on
     * blocked). Returns false if no path was found.
     */
    walkTo(lx: number, lz: number): boolean {
        if (!raw || !raw.ingame || !raw.localPlayer) {
            return false;
        }

        return raw.tryMove(raw.localPlayer.routeX[0], raw.localPlayer.routeZ[0], lx, lz, true, 0, 0, 0, 0, 0, 0);
    },

    /** Press the active "Click here to continue" dialog button. */
    continueDialog(): boolean {
        const comId = reader.chatContinueComId();
        if (comId === -1) {
            return false;
        }

        return actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, comId);
    }
};

/** Ground-item ops with the client's synthesized default 'Take' at op 3
 *  (Client.ts ~9437: added whenever op[2] is unset). */
function groundOps(op: (string | null)[] | null): (string | null)[] {
    const ops = [...(op ?? [null, null, null, null, null])];
    if (!ops[2]) {
        ops[2] = 'Take';
    }

    return ops;
}

/** Held ops with the client's synthesized default 'Drop' at op 5
 *  (Client.ts ~9718: added whenever iop[4] is unset). */
function heldOps(iop: (string | null)[] | null): (string | null)[] {
    const ops = [...(iop ?? [null, null, null, null, null])];
    if (!ops[4]) {
        ops[4] = 'Drop';
    }

    return ops;
}

/** Mirrors the client's own health-bar condition (Client.ts ~4659). */
function combatShowing(combatCycle: number): boolean {
    return combatCycle > loopCycleNow() + 100;
}

function loopCycleNow(): number {
    // Client.loopCycle is static; read it off the attached instance's
    // constructor to keep this file free of a direct Client import
    return raw ? ((raw as unknown as { constructor: { loopCycle: number } }).constructor.loopCycle ?? 0) : 0;
}

let cachedInvComId = -1;

/**
 * The backpack container: a TYPE_INV child of the tab-3 sidebar interface
 * (cache ids differ per revision, so resolve at runtime and cache).
 */
function findInvComponent(): number {
    if (!raw) {
        return -1;
    }

    if (cachedInvComId !== -1) {
        return cachedInvComId;
    }

    const tabInterfaceId = raw.sideIcon[3];
    if (tabInterfaceId === undefined || tabInterfaceId === -1) {
        return -1;
    }

    const queue: number[] = [tabInterfaceId];
    while (queue.length > 0) {
        const com = IfType.list[queue.shift()!];
        if (!com) {
            continue;
        }

        if (com.type === ComponentType.TYPE_INV && com.objOps) {
            cachedInvComId = com.id;
            return cachedInvComId;
        }

        if (com.children) {
            queue.push(...com.children);
        }
    }

    return -1;
}
