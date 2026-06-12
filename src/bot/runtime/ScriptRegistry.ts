import type { AbstractBot } from '../api/Bot.js';

export interface ScriptMeta {
    name: string;
    description: string;
    version?: string;
    /** Where the script came from: undefined = built-in, else URL/file label. */
    origin?: string;
    create(): AbstractBot;
}

/** Available scripts. Built-ins register at module load (scripts/index.ts);
 *  external scripts register through the loader (Slice 7) — re-registering a
 *  name replaces it (the hot-reload path). */
class ScriptRegistryImpl {
    private metas = new Map<string, ScriptMeta>();
    private changeListeners = new Set<() => void>();

    register(meta: ScriptMeta): void {
        this.metas.set(meta.name, meta);
        for (const listener of this.changeListeners) {
            try {
                listener();
            } catch (err) {
                console.error('[lcbuddy] registry listener error', err);
            }
        }
    }

    list(): ScriptMeta[] {
        return [...this.metas.values()];
    }

    get(name: string): ScriptMeta | undefined {
        return this.metas.get(name);
    }

    onChange(cb: () => void): () => void {
        this.changeListeners.add(cb);
        return () => this.changeListeners.delete(cb);
    }
}

export const ScriptRegistry = new ScriptRegistryImpl();
