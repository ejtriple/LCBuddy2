import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import ChickenKiller from './ChickenKiller.js';
import CrashTestBot from './CrashTestBot.js';
import DebugBot from './DebugBot.js';

ScriptRegistry.register({
    name: 'DebugBot',
    description: 'Logs nearest NPCs each tick and paints an overlay box',
    create: () => new DebugBot()
});

ScriptRegistry.register({
    name: 'ChickenKiller',
    description: 'Kills chickens, loots and buries bones (anchor = start tile)',
    create: () => new ChickenKiller()
});

ScriptRegistry.register({
    name: 'CrashTestBot',
    description: 'Throws on iteration 3 to demonstrate crash isolation',
    create: () => new CrashTestBot()
});
