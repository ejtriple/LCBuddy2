import { reader } from './adapter/ClientAdapter.js';
import BotClient from './BotClient.js';
import { BotHost } from './BotHost.js';
import { ActionRouter } from './input/ActionRouter.js';
import { VirtualInput } from './input/VirtualInput.js';
import { Navigator } from './nav/Navigator.js';
import { ScriptRegistry } from './runtime/ScriptRegistry.js';
import { ScriptRunner } from './runtime/ScriptRunner.js';
import BotPanel from './ui/BotPanel.js';
import Overlay from './ui/Overlay.js';
import './scripts/index.js';

export { BotClient, BotHost };

// Self-boot when loaded in a page that provides the game canvas (bot.html).
// Connection args mirror /rs2.cgi defaults; override via query string, e.g.
// bot.html?nodeid=10&members=0&lowmem=1
if (typeof document !== 'undefined' && document.getElementById('canvas')) {
    const params = new URLSearchParams(window.location.search);
    const nodeid = parseInt(params.get('nodeid') ?? '10', 10);
    const lowmem = params.get('lowmem') === '1';
    const members = params.get('members') !== '0';

    const client = new BotClient(nodeid, lowmem, members);

    // Slice 6 additive hook: bot.html?inputmode=synthetic forces every
    // script run synthetic (used by tools/synthetic-test.ts); default
    // behavior (no param) is untouched — scripts pick their own inputMode.
    const inputmode = params.get('inputmode');
    if (inputmode === 'synthetic' || inputmode === 'direct') {
        ActionRouter.force(inputmode);
    }

    const panelRoot = document.getElementById('bot-panel');
    if (panelRoot) {
        new BotPanel(panelRoot, BotHost);
    }

    const overlayCanvas = document.getElementById('overlay');
    if (overlayCanvas instanceof HTMLCanvasElement) {
        new Overlay(overlayCanvas);
    }

    // DevTools handle (works because this bundle never mangles names).
    // The stable script-facing ABI (globalThis.__lcbuddy) lands in Slice 7.
    (globalThis as Record<string, unknown>).lcbuddy = { client, host: BotHost, runner: ScriptRunner, registry: ScriptRegistry, reader, navigator: Navigator, vinput: VirtualInput, router: ActionRouter };
}
