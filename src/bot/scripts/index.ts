import { GATHERING_SETTINGS } from './GatheringBot.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import ChickenKiller, { SETTINGS as CHICKEN_SETTINGS } from './ChickenKiller.js';
import CrashTestBot from './CrashTestBot.js';
import DebugBot from './DebugBot.js';
import GatheringBot from './GatheringBot.js';
import NavDemo from './NavDemo.js';
import RockCrab, { SETTINGS as ROCKCRAB_SETTINGS } from './RockCrab.js';
import Woodcutter, { SETTINGS as WOODCUTTER_SETTINGS } from './Woodcutter.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// --- combat ---
ScriptRegistry.register({
    name: 'ChickenKiller',
    description: 'Kills chickens, loots and buries bones (anchor = start tile)',
    category: 'Combat',
    tags: ['f2p', 'lumbridge', 'bones', 'feathers', 'afk'],
    settingsSchema: CHICKEN_SETTINGS,
    create: () => new ChickenKiller()
});

ScriptRegistry.register({
    name: 'RockCrab',
    description: 'Rellekka rock crabs: aggro-stack-kill-reset, loots key halves',
    category: 'Combat',
    tags: ['members', 'rellekka', 'keys', 'afk'],
    settingsSchema: ROCKCRAB_SETTINGS,
    create: () => new RockCrab()
});

// --- woodcutting ---
ScriptRegistry.register({
    name: 'Woodcutter',
    description: 'Chops trees and drops logs (anchor = start tile, needs an axe)',
    category: 'Woodcutting',
    tags: ['f2p', 'gathering', 'drop'],
    settingsSchema: WOODCUTTER_SETTINGS,
    create: () => new Woodcutter()
});

// --- gathering presets (all GatheringBot, varied by settings defaults) ---

/** Build a gathering preset: GATHERING_SETTINGS with overridden defaults. */
function gathering(overrides: Record<string, unknown>): SettingsSchema {
    const schema: SettingsSchema = {};
    for (const [key, def] of Object.entries(GATHERING_SETTINGS)) {
        schema[key] = key in overrides ? { ...def, default: overrides[key] } : def;
    }
    return schema;
}

ScriptRegistry.register({
    name: 'Miner',
    description: 'Mines rocks and drops the ore (anchor = start tile, needs a pickaxe)',
    category: 'Mining',
    tags: ['f2p', 'gathering', 'drop'],
    settingsSchema: gathering({ targetType: 'loc', target: 'Rocks', action: 'Mine', dropMatch: 'ore', leashRadius: 8 }),
    create: () => new GatheringBot()
});

ScriptRegistry.register({
    name: 'Fisher',
    description: 'Net/bait-fishes a spot and drops the catch (needs a net or rod+bait)',
    category: 'Fishing',
    tags: ['f2p', 'gathering', 'drop'],
    settingsSchema: gathering({ targetType: 'npc', target: 'Fishing spot', action: 'Net', dropMatch: 'raw', leashRadius: 12 }),
    create: () => new GatheringBot()
});

// --- navigation / develop ---
ScriptRegistry.register({
    name: 'NavDemo',
    description: 'Web-walks Lumbridge -> castle stairs -> chicken pen -> Varrock -> Falador',
    category: 'Navigation',
    tags: ['demo', 'web-walk'],
    create: () => new NavDemo()
});

ScriptRegistry.register({
    name: 'DebugBot',
    description: 'Logs nearest NPCs each tick and paints an overlay box',
    category: 'Develop',
    tags: ['debug', 'overlay'],
    create: () => new DebugBot()
});

ScriptRegistry.register({
    name: 'CrashTestBot',
    description: 'Throws on iteration 3 to demonstrate crash isolation',
    category: 'Develop',
    tags: ['test'],
    create: () => new CrashTestBot()
});
