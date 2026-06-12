// Death-recovery test: force 1 HP at the chicken pen, let a chicken kill us,
// and assert ChickenKiller detects the death, web-walks back from the
// respawn, and resumes the cycle.
//
// Usage: bun tools/death-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8888';
const username = process.argv[3] ?? `mort${Date.now().toString(36).slice(-7)}`;

const TELE = '::tele 0,50,51,32,34';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { level: string; msg: string }[] } | null };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    const boot = async () => {
        await page.waitForFunction(() => (globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy !== undefined && (globalThis as never as { lcbuddy: { client: { constructor: { loopCycle: number } } } }).lcbuddy.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });
    };

    const login = async () => {
        await page.evaluate(
            ([user, pass]) => {
                const { client } = (globalThis as never as Lcb).lcbuddy;
                client.loginUser = user;
                client.loginPass = pass;
                void client.login(user, pass, false);
            },
            [username, 'test']
        );
        return page
            .waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 })
            .then(() => true)
            .catch(() => false);
    };

    const type = async (text: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(text, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1200);
    };

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await login())) fail('first login failed');

    await type(TELE);
    await page.reload();
    await boot();
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('re-login failed');
    console.log(`'${username}' at the pen with tabs unlocked`);

    const snapshot = () =>
        page.evaluate(() => {
            const rows: Record<string, string> = {};
            for (const node of Array.from(document.querySelectorAll('.lcb-row'))) {
                rows[node.querySelector('.lcb-key')?.textContent ?? ''] = node.querySelector('.lcb-value')?.textContent ?? '';
            }
            const reader = (globalThis as never as { lcbuddy: { reader: { stat(i: number): { name: string; effective: number; base: number } } } }).lcbuddy.reader;
            const hp = reader.stat(3);
            return { tile: rows.tile ?? '?', status: rows.status ?? '?', hp: `${hp.effective}/${hp.base}` };
        });

    await page.selectOption('.lcb-select', 'ChickenKiller');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log('ChickenKiller started');

    // Let it settle into the cycle (proves it's running) and capture the
    // anchor it logged.
    await page.waitForTimeout(12000);
    let snap = await snapshot();
    console.log(`running at ${snap.tile}, status '${snap.status}'`);

    // Kill it deterministically: PAUSE so the player stops fleeing toward
    // chickens, floor HP to 1, then spawn aggressive flytraps
    // (huntmode=aggressive_melee, str 15) ON the now-stationary player's tile
    // via ::npcadd. One melee hit on 1 HP is a guaranteed kill — no teleport
    // (canAccess blocks it mid-combat) and no chicken-damage RNG.
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.waitForTimeout(6000); // let combat clear so the player stands still
    await type('::setstat hitpoints 1');
    for (let i = 0; i < 2; i++) {
        await type('::npcadd flytrap');
    }
    snap = await snapshot();
    console.log(`paused, flytraps spawned at ${snap.tile}, hp ${snap.hp} — waiting to die...`);

    // Death = respawn teleport to the Lumbridge respawn point (~3222,3218),
    // far from the pen. Poll the tile while paused.
    const diedAt = (tile: string) => {
        const m = /^(\d+), (\d+)/.exec(tile);
        if (!m) return false;
        const x = +m[1];
        const z = +m[2];
        return Math.abs(x - 3222) <= 6 && Math.abs(z - 3218) <= 6;
    };

    let died = false;
    for (let i = 0; i < 30 && !died; i++) {
        await page.waitForTimeout(3000);
        snap = await snapshot();
        died = diedAt(snap.tile);
    }
    if (!died) {
        await page.screenshot({ path: 'out/death-test.png' });
        fail(`player did not die — tile ${snap.tile}, hp ${snap.hp} (screenshot: out/death-test.png)`);
    }
    console.log(`>> died and respawned at ${snap.tile}`);

    // Resume: DeathRecovery should detect the death, walk back to the pen
    // anchor, and the cycle should resume.
    await page.getByRole('button', { name: 'Resume' }).click();
    console.log('resumed — expecting walk-back + cycle resume');

    const deadline = Date.now() + 6 * 60_000;
    let lastLogged = 0;
    let walkedBack = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(5000);
        const s = await page.evaluate(() => {
            const { runner } = (globalThis as never as Lcb).lcbuddy;
            return { state: runner.state, log: (runner.ctx?.log ?? []).map(l => l.msg) };
        });
        for (const line of s.log.slice(lastLogged)) {
            console.log(`  [bot] ${line}`);
        }
        lastLogged = s.log.length;

        if (s.state === 'crashed') fail('script crashed during recovery');

        if (!walkedBack && s.log.some(l => l.includes('died!'))) {
            console.log('>> bot detected the death');
        }
        if (!walkedBack && s.log.some(l => l.includes('back at the anchor'))) {
            walkedBack = true;
            console.log('>> walked back to the anchor from the respawn');
        }
        if (walkedBack) {
            const marker = lastLogged;
            const resumed = await page
                .waitForFunction(m => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).slice(m).some(l => /chicken killed|looted bones|buried bones/.test(l.msg)), marker, { timeout: 120000 })
                .then(() => true)
                .catch(() => false);
            await page.screenshot({ path: 'out/death-test.png' });
            if (!resumed) fail('walked back but cycle did not resume');
            console.log('>> cycle resumed after death — screenshot: out/death-test.png');
            console.log('PASS');
            process.exit(0);
        }
    }

    snap = await snapshot();
    await page.screenshot({ path: 'out/death-test.png' });
    fail(`recovery timed out — tile ${snap.tile}, status '${snap.status}' (screenshot: out/death-test.png)`);
} finally {
    await browser.close();
}
