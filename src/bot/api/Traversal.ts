import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Navigator } from '../nav/Navigator.js';
import { WalkExecutor, type WalkOptions } from '../nav/WalkExecutor.js';

/**
 * Script-facing web-walking (Slice 5b): cross-world paths from the baked
 * collision pack + door/transport edges, executed as ordinary game clicks.
 */
export const Traversal = {
    /**
     * Walk to `dest` anywhere in the world, opening doors and taking known
     * transports on the way. Resolves true on arrival (within opts.radius,
     * default 2), false on failure/timeout. Sleeps via Execution.* only —
     * Stop unwinds it like any other script wait.
     */
    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        return WalkExecutor.walkTo(dest, opts);
    },

    /** Spawn the nav worker + load the collision pack ahead of the first
     *  walkTo (optional; walkTo does it lazily). */
    preload(): void {
        Navigator.start();
    },

    /** Remaining tile count of the walk in progress (0 when idle). */
    remaining(): number {
        return WalkExecutor.remaining;
    }
};

export type { WalkOptions };
