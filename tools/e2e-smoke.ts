// Browser smoke test for the bot client (Slice 1 exit criterion): boots
// bot.html in headless Chrome, logs in through the client's own login(),
// and asserts the panel mirrors live game state.
//
// Requires a running local Engine (docs/DEV.md) with the bot deployed
// (tools/deploy-local.sh) and Google Chrome installed.
//
// Usage: bun tools/e2e-smoke.ts [base-url] [username] [password]

import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8888';
// default to a per-run name: fresh save, and immune to a lingering
// "already online" session from a previous run
const username = process.argv[3] ?? `smoke${Date.now().toString(36).slice(-7)}`;
const password = process.argv[4] ?? 'test';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();

    const pageErrors: string[] = [];
    const resourceNoise: string[] = [];
    page.on('pageerror', err => pageErrors.push(String(err)));
    page.on('console', msg => {
        if (msg.type() !== 'error') {
            return;
        }

        // missing favicon / content-pack gaps 404 on the stock client too;
        // they are environment noise, not a bot-client regression
        if (msg.text().includes('Failed to load resource')) {
            resourceNoise.push(msg.location().url || msg.text());
        } else {
            pageErrors.push(msg.text());
        }
    });

    await page.goto(`${base}/bot.html`);

    // client booted and main loop running (maininit finished)
    await page.waitForFunction(
        () => {
            const lcb = (globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy;
            return lcb !== undefined && lcb.client.constructor.loopCycle > 10;
        },
        undefined,
        { timeout: 60000 }
    );
    console.log('client booted, title loop running');

    // log in through the client's own (unmangled) login path
    await page.evaluate(
        ([user, pass]) => {
            const { client } = (globalThis as never as { lcbuddy: { client: { loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> } } }).lcbuddy;
            client.loginUser = user;
            client.loginPass = pass;
            void client.login(user, pass, false);
        },
        [username, password]
    );

    try {
        await page.waitForFunction(
            () => {
                const { client } = (globalThis as never as { lcbuddy: { client: { ingame: boolean; sceneState: number } } }).lcbuddy;
                return client.ingame && client.sceneState === 2;
            },
            undefined,
            { timeout: 30000 }
        );
    } catch (err) {
        const mes = await page.evaluate(() => {
            const { client } = (globalThis as never as { lcbuddy: { client: { loginMes1: string; loginMes2: string } } }).lcbuddy;
            return `${client.loginMes1} / ${client.loginMes2}`;
        });
        fail(`login did not reach the game (server said: '${mes}'): ${err}`);
    }
    console.log(`logged in as '${username}', scene rendering`);

    // let a few server ticks flow
    await page.waitForTimeout(2500);

    const panel = await page.evaluate(() => {
        const text = (selector: string): string[] => [...document.querySelectorAll(selector)].map(n => n.textContent ?? '');
        return {
            banner: text('.lcb-banner')[0] ?? '',
            rows: text('.lcb-value'),
            stats: text('.lcb-stat-level'),
            chat: text('.lcb-chat-line'),
            tick: (globalThis as never as { lcbuddy: { host: { tickCount: number; tickMeanMs: number } } }).lcbuddy.host.tickCount
        };
    });

    if (panel.banner !== 'adapter self-test: ok') fail(`banner: '${panel.banner}'`);
    console.log(`banner: ${panel.banner}`);

    const [state, player, tile, energy, nearby, , tick] = panel.rows;
    if (state !== 'ingame') fail(`state row: '${state}'`);
    if (!/^\d+, \d+, \d+$/.test(tile)) fail(`tile row: '${tile}'`);
    if (!/^\d+% \/ \d+ kg$/.test(energy)) fail(`energy row: '${energy}'`);
    if (!/^\d+ players, \d+ npcs$/.test(nearby)) fail(`nearby row: '${nearby}'`);
    if (!/^[1-9]\d* \(\d+ms\)$/.test(tick)) fail(`tick row: '${tick}'`);
    console.log(`panel: player='${player}' tile=(${tile}) energy=${energy} nearby=${nearby} tick=${tick}`);

    if (panel.stats.some(s => !/^\d+\/\d+$/.test(s))) fail(`stats not populated: ${panel.stats.join(' ')}`);
    console.log(`stats: ${panel.stats.length} skills populated (hp ${panel.stats[3]})`);
    console.log(`chat: ${panel.chat.join(' | ')}`);

    // tick counter must advance (~600ms cadence)
    const before = panel.tick;
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => (globalThis as never as { lcbuddy: { host: { tickCount: number } } }).lcbuddy.host.tickCount);
    if (after < before + 2) fail(`tick counter stalled: ${before} -> ${after}`);
    console.log(`ticks advanced ${before} -> ${after}`);

    await page.screenshot({ path: 'out/e2e-smoke.png' });
    console.log('screenshot: out/e2e-smoke.png');

    if (resourceNoise.length > 0) {
        console.log(`note: ${resourceNoise.length} resource-load failures (also present on the stock client): ${resourceNoise.join(', ')}`);
    }

    const fatal = pageErrors.filter(e => !e.includes('AudioContext') && !e.includes('autoplay'));
    if (fatal.length > 0) fail(`page errors:\n${fatal.join('\n')}`);

    console.log('PASS');
} finally {
    await browser.close();
}
