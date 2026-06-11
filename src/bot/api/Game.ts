import { reader, type WorldTile } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';

/** Minimal world/self facade for scripts. Grows over Slices 3-4. */
export const Game = {
    ingame(): boolean {
        return reader.ingame();
    },

    /** The local player's world tile, or null before login/scene load. */
    tile(): WorldTile | null {
        return reader.worldTile();
    },

    energy(): number {
        return reader.energy();
    },

    weight(): number {
        return reader.weight();
    },

    /** Server ticks observed since the client booted (~600ms each). */
    tick(): number {
        return BotHost.tickCount;
    }
};

export type { WorldTile };
