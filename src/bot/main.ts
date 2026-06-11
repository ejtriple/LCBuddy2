import BotClient from './BotClient.js';
import { BotHost } from './BotHost.js';
import BotPanel from './ui/BotPanel.js';

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

    const panelRoot = document.getElementById('bot-panel');
    if (panelRoot) {
        new BotPanel(panelRoot, BotHost);
    }

    // DevTools handle (works because this bundle never mangles names).
    // The stable script-facing ABI (globalThis.__lcbuddy) lands in Slice 7.
    (globalThis as Record<string, unknown>).lcbuddy = { client, host: BotHost };
}
