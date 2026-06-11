import type { AbstractBot } from '../api/Bot.js';

export interface ScriptMeta {
    name: string;
    description: string;
    create(): AbstractBot;
}

/** Available scripts. Built-ins register at module load (scripts/index.ts);
 *  URL/file loading lands in Slice 7. */
class ScriptRegistryImpl {
    private metas = new Map<string, ScriptMeta>();

    register(meta: ScriptMeta): void {
        this.metas.set(meta.name, meta);
    }

    list(): ScriptMeta[] {
        return [...this.metas.values()];
    }

    get(name: string): ScriptMeta | undefined {
        return this.metas.get(name);
    }
}

export const ScriptRegistry = new ScriptRegistryImpl();
