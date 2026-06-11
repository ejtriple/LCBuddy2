// Tick-driven walk executor (Slice 5b): turns a NavWorker path into game
// clicks. Called from scripts via Traversal.walkTo, so every wait goes
// through Execution.* — stop/pause/abort semantics hold exactly like any
// other script action (PLAN.md §2).
//
// Loop: walk toward the furthest path tile within ~18 tiles that's inside
// the loaded scene; when the next path segment is an annotated door/
// transport crossing, approach it, interact with the annotated action and
// wait for the crossing to open (loc gone / level changed); on stall
// re-click, on repeated stall re-path from the current position.

import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { Execution } from '../api/Execution.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { Navigator, type PathResult } from './Navigator.js';
import type { TransportInfo, Waypoint } from './PathFinder.js';

const CLICK_RANGE = 18; // furthest path tile to click (well inside the scene)
const PROGRESS_WINDOW = 26; // how far ahead we look for our own position on the path
const TRANSPORT_TRIGGER = 3; // handle a crossing once we're this close to its approach tile
const STUCK_TICKS = 8; // no tile change for this many ticks -> re-click
const MAX_RECLICKS = 2; // re-clicks per path before we re-path instead
const MAX_REPATHS = 5;
const RECLICK_INTERVAL_MS = 3600; // re-assert the walk even without a stall
const PATH_REQUEST_TIMEOUT_MS = 30_000; // includes first-use worker boot + pack fetch
const TRANSPORT_WAIT_MS = 8000;

export interface WalkOptions {
    /** Arrive when within this Chebyshev distance of dest (default 2). */
    radius?: number;
    /** Overall walk budget (default 300s — Lumbridge->Varrock walks ~2.5min). */
    timeoutMs?: number;
    /** Progress lines (path stats, transports, repaths) for the script log. */
    log?: (msg: string) => void;
}

interface PathStep extends WorldTile {
    transport?: TransportInfo;
}

type FollowResult = 'arrived' | 'repath' | 'failed';

function chebyshev(a: WorldTile, b: WorldTile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Expand direction-change waypoints back into the full tile path. */
function expandWaypoints(waypoints: Waypoint[]): PathStep[] {
    const tiles: PathStep[] = [];
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (i === 0) {
            tiles.push({ x: wp.x, z: wp.z, level: wp.level, transport: wp.transport });
            continue;
        }
        const prev = waypoints[i - 1];
        if (wp.transport || wp.level !== prev.level) {
            // a crossing is a single annotated hop, never a straight run
            tiles.push({ x: wp.x, z: wp.z, level: wp.level, transport: wp.transport });
            continue;
        }
        const dx = Math.sign(wp.x - prev.x);
        const dz = Math.sign(wp.z - prev.z);
        const steps = Math.max(Math.abs(wp.x - prev.x), Math.abs(wp.z - prev.z));
        for (let step = 1; step <= steps; step++) {
            tiles.push({ x: prev.x + dx * step, z: prev.z + dz * step, level: wp.level });
        }
    }
    return tiles;
}

class WalkExecutorImpl {
    /** Live progress for overlays: remaining path tiles of the current walk. */
    remaining = 0;

    /**
     * Web-walk to `dest`. Resolves true on arrival, false on failure/timeout.
     * Only call from script context (sleeps via Execution.*).
     */
    async walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        const radius = opts?.radius ?? 2;
        const timeoutMs = opts?.timeoutMs ?? 300_000;
        const log = opts?.log ?? ((): void => {});
        const deadline = performance.now() + timeoutMs;

        try {
            for (let repaths = 0; repaths <= MAX_REPATHS; repaths++) {
                const me = reader.worldTile();
                if (!me) {
                    return false;
                }
                if (chebyshev(me, dest) <= radius && me.level === dest.level) {
                    return true;
                }

                const path = await this.requestPath(me, dest);
                if (!path.ok) {
                    log(`no path to (${dest.x},${dest.z},${dest.level}): ${path.reason}`);
                    return false;
                }
                log(`path: cost ${path.cost}, ${path.waypoints.length} waypoints, expanded ${path.expanded}, worker ${path.elapsedMs?.toFixed(1)}ms${repaths > 0 ? ` (repath ${repaths})` : ''}`);

                const tiles = expandWaypoints(path.waypoints);

                // the terminal tile is the pathfinder's goal — when dest itself
                // is unwalkable it snaps to the nearest reachable tile, and
                // standing there already is as arrived as we can get
                const terminal = tiles[tiles.length - 1];
                if (terminal && me.level === terminal.level && me.x === terminal.x && me.z === terminal.z) {
                    if (chebyshev(me, dest) > radius) {
                        log(`dest (${dest.x},${dest.z}) unreachable beyond (${me.x},${me.z}) — treating nearest reachable tile as arrival`);
                    }
                    return true;
                }

                const result = await this.followPath(tiles, dest, radius, deadline, log);
                if (result === 'arrived') {
                    return true;
                }
                if (result === 'failed') {
                    return false;
                }
                // 'repath': loop with a fresh path from wherever we are now
            }
            log(`giving up after ${MAX_REPATHS} repaths`);
            return false;
        } finally {
            this.remaining = 0;
        }
    }

    /** Bridge the Navigator promise into the script scheduler. */
    private async requestPath(from: WorldTile, to: WorldTile): Promise<PathResult> {
        let result: PathResult | null = null;
        Navigator.findPath(from, to).then(
            r => (result = r),
            err => (result = { ok: false, reason: err instanceof Error ? err.message : String(err), expanded: 0 })
        );
        const settled = await Execution.delayUntil(() => result !== null, PATH_REQUEST_TIMEOUT_MS);
        return settled && result ? result : { ok: false, reason: 'path request timed out', expanded: 0 };
    }

    private async followPath(tiles: PathStep[], dest: WorldTile, radius: number, deadline: number, log: (msg: string) => void): Promise<FollowResult> {
        let pathIdx = 0;
        let stuckTicks = 0;
        let reclicks = 0;
        let lastTile: WorldTile | null = null;
        let lastClickAt = 0;
        let lastTarget = -1;

        while (performance.now() < deadline) {
            const me = reader.worldTile();
            if (!me) {
                return 'failed';
            }

            if (chebyshev(me, dest) <= radius && me.level === dest.level) {
                return 'arrived';
            }

            // standing on the path's terminal tile = the pathfinder's goal
            // (dest may have snapped to the nearest walkable tile)
            const terminal = tiles[tiles.length - 1];
            if (terminal && me.level === terminal.level && me.x === terminal.x && me.z === terminal.z) {
                return 'arrived';
            }

            // advance our position along the path (largest index we're on/next to)
            let found = -1;
            for (let i = pathIdx; i < Math.min(pathIdx + PROGRESS_WINDOW, tiles.length); i++) {
                if (tiles[i].level === me.level && chebyshev(tiles[i], me) <= 1) {
                    found = i;
                }
            }
            if (found !== -1) {
                pathIdx = found;
            } else if (tiles[pathIdx].level !== me.level || chebyshev(tiles[pathIdx], me) > 6) {
                log(`deviated from path at (${me.x},${me.z},${me.level})`);
                return 'repath';
            }
            this.remaining = tiles.length - 1 - pathIdx;

            // stall bookkeeping
            if (lastTile && me.x === lastTile.x && me.z === lastTile.z && me.level === lastTile.level) {
                stuckTicks += 2;
            } else {
                stuckTicks = 0;
            }
            lastTile = me;

            // next annotated crossing ahead; handle it once we're close
            let crossingIdx = -1;
            for (let i = pathIdx + 1; i < tiles.length; i++) {
                if (tiles[i].transport) {
                    crossingIdx = i;
                    break;
                }
            }
            if (crossingIdx !== -1 && chebyshev(me, tiles[crossingIdx - 1]) <= TRANSPORT_TRIGGER) {
                const handled = await this.handleTransport(tiles[crossingIdx], log);
                if (handled) {
                    // crossing is open/taken: drop the annotation so the
                    // normal walker clicks straight through it
                    tiles[crossingIdx].transport = undefined;
                    pathIdx = Math.max(pathIdx, crossingIdx - 1);
                    stuckTicks = 0;
                    reclicks = 0;
                    lastTile = null;
                    continue;
                }
                return 'repath';
            }

            const stuck = stuckTicks >= STUCK_TICKS;
            if (stuck) {
                if (reclicks >= MAX_RECLICKS) {
                    log(`stuck at (${me.x},${me.z}) — repathing`);
                    return 'repath';
                }
                reclicks++;
                stuckTicks = 0;
            }

            // click the furthest path tile within range, inside the scene,
            // and never past the next crossing's approach tile
            const limit = crossingIdx !== -1 ? crossingIdx - 1 : tiles.length - 1;
            let target = -1;
            for (let i = pathIdx; i <= limit; i++) {
                if (tiles[i].level !== me.level || chebyshev(tiles[i], me) > CLICK_RANGE) {
                    break;
                }
                if (reader.toLocal(tiles[i].x, tiles[i].z)) {
                    target = i;
                }
            }

            if (target !== -1 && !(tiles[target].x === me.x && tiles[target].z === me.z)) {
                const now = performance.now();
                if (target !== lastTarget || stuck || now - lastClickAt > RECLICK_INTERVAL_MS) {
                    const local = reader.toLocal(tiles[target].x, tiles[target].z);
                    if (local) {
                        ActionRouter.driver.walk(local.lx, local.lz);
                        lastClickAt = now;
                        lastTarget = target;
                    }
                }
            } else if (target === -1) {
                // nothing clickable (scene edge?) — treat like a stall
                stuckTicks += 2;
            }

            await Execution.delayTicks(2);
        }

        log('walk timed out');
        return 'failed';
    }

    /**
     * Cross an annotated door/transport: find the loc, fire the annotated
     * action, wait for the crossing to open. True when the path can continue
     * (including "door already open" — no matching loc at the tile).
     */
    private async handleTransport(step: PathStep, log: (msg: string) => void): Promise<boolean> {
        const transport = step.transport!;

        for (let attempt = 0; attempt < 2; attempt++) {
            const loc = this.findTransportLoc(transport);
            if (!loc) {
                if (transport.toLevel === undefined) {
                    // door already open (e.g. the pen gate during the chicken
                    // soak) — the way through is clear, just keep walking
                    log(`${transport.locName} at (${transport.locX},${transport.locZ}) already open`);
                    return true;
                }
                log(`transport loc '${transport.locName}' not found near (${transport.locX},${transport.locZ})`);
                return false;
            }

            if (!loc.interact(transport.action)) {
                log(`'${transport.action}' not offered by ${transport.locName} (ops: ${loc.actions().join(', ')})`);
                return false;
            }

            let crossed: boolean;
            if (transport.toLevel !== undefined) {
                const toLevel = transport.toLevel;
                crossed = await Execution.delayUntil(() => reader.worldTile()?.level === toLevel, TRANSPORT_WAIT_MS);
            } else {
                // open = the closed-door loc vanishes from that tile
                crossed = await Execution.delayUntil(() => this.findTransportLoc(transport) === null, TRANSPORT_WAIT_MS);
            }
            if (crossed) {
                log(`${transport.action} ${transport.locName} at (${transport.locX},${transport.locZ}) ok`);
                return true;
            }
            log(`${transport.action} ${transport.locName} did not resolve, retrying`);
        }
        return false;
    }

    private findTransportLoc(transport: TransportInfo): Loc | null {
        return Locs.query()
            .name(transport.locName)
            .action(transport.action)
            .where(loc => {
                const tile = loc.tile();
                return Math.max(Math.abs(tile.x - transport.locX), Math.abs(tile.z - transport.locZ)) <= 3;
            })
            .nearest();
    }
}

export const WalkExecutor = new WalkExecutorImpl();
