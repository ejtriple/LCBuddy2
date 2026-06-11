import { reader, type NpcSnapshot } from '../../adapter/ClientAdapter.js';

/**
 * NPC reads (Slice 2: snapshots; the RuneMate-style query builder with
 * .name()/.within()/.reachable() lands in Slice 3).
 */
export const Npcs = {
    /** Snapshot of every NPC in the scene, unordered. */
    all(): NpcSnapshot[] {
        return reader.npcs();
    },

    /** The `count` nearest NPCs by tile distance, nearest first. */
    nearest(count: number = 1): NpcSnapshot[] {
        return reader
            .npcs()
            .sort((a, b) => a.distance - b.distance)
            .slice(0, count);
    }
};

export type { NpcSnapshot };
