import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import ChickenKiller from './ChickenKiller.js';
import CrashTestBot from './CrashTestBot.js';
import DebugBot from './DebugBot.js';
import NavDemo from './NavDemo.js';
import RockCrab from './RockCrab.js';
import Woodcutter from './Woodcutter.js';

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
    name: 'Woodcutter',
    description: 'Chops trees and drops logs (anchor = start tile, needs an axe)',
    create: () => new Woodcutter()
});

ScriptRegistry.register({
    name: 'RockCrab',
    description: 'Rellekka rock crabs: aggro-stack-kill-reset, loots key halves (web-walks to the field)',
    create: () => new RockCrab()
});

ScriptRegistry.register({
    name: 'NavDemo',
    description: 'Web-walks Lumbridge -> chicken pen (through the gate) -> Varrock square',
    create: () => new NavDemo()
});

ScriptRegistry.register({
    name: 'CrashTestBot',
    description: 'Throws on iteration 3 to demonstrate crash isolation',
    create: () => new CrashTestBot()
});
