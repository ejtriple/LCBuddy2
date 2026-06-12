# LCBuddy2 operating manual

How to run, play, and extend LCBuddy2 as a human at a keyboard. No headless tooling required —
everything here is a terminal command or a browser click. The headless test harnesses have their
own section in [DEV.md](DEV.md).

- [1. Prerequisites](#1-prerequisites)
- [2. Run a local server](#2-run-a-local-server)
- [3. Build and deploy the client](#3-build-and-deploy-the-client)
- [4. Play](#4-play)
- [5. The bot panel](#5-the-bot-panel)
- [6. The built-in scripts](#6-the-built-in-scripts)
- [7. Server debug commands](#7-server-debug-commands)
- [8. Writing your own bot](#8-writing-your-own-bot)
- [9. Upstream merges](#9-upstream-merges)
- [10. Troubleshooting](#10-troubleshooting)

## 1. Prerequisites

| Tool | Why | Install (macOS) |
|---|---|---|
| [Bun](https://bun.sh) | builds the client bundles | `brew install oven-sh/bun/bun` |
| Node.js **24+** | runs the game server (uses `node:sqlite`) | `brew install node@24` (keg-only) |
| git | everything | — |

`node@24` is keg-only on Homebrew: either put `/opt/homebrew/opt/node@24/bin` on PATH or prefix
engine commands with `PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.

## 2. Run a local server

The engine and its game data are separate repos that must sit in the **same parent directory**
and on **matching branches** (we use `274`, November 2004):

```sh
mkdir lostcity-dev && cd lostcity-dev
git clone --branch 274 --single-branch https://github.com/LostCityRS/Engine-TS engine
git clone --branch 274 --single-branch https://github.com/LostCityRS/Content content
```

On macOS the engine defaults its web port to **80** (requires nothing extra on modern macOS, but
8888 is saner). Pin it before first boot:

```sh
cat > engine/data/config/world.json <<'EOF'
{ "web": { "port": 8888 } }
EOF
```

Boot:

```sh
cd engine && npm install && npx tsx src/app.ts
```

First boot packs the game cache (~10s). You're up when you see:

```
World ready: Visit http://localhost:8888/rs2.cgi
```

Worth knowing:

- **Accounts**: with the default config (`login.enabled=false`) any username/password combination
  logs in. New names get a fresh save; passwords are not checked. Saves are flat files in
  `engine/data/players/main/<username>.sav` — delete one to reset that character, delete the
  directory to reset the world's players.
- **Stop/start**: Ctrl-C saves and exits; just rerun `npx tsx src/app.ts`. Use `npm run dev`
  instead if you're editing engine code (auto-restart).
- The setup UI at `http://localhost:8898/setup` edits `world.json` (members, XP rate, ports).
  Defaults: members world, node id 10, XP rate 1, sqlite, debug commands on.

## 3. Build and deploy the client

From the LCBuddy2 repo:

```sh
bun install          # once
./tools/deploy-local.sh
```

The script builds **both** bundles and copies them into the engine:

| Build | Command it runs | Lands at | Who uses it |
|---|---|---|---|
| stock client | `bun run build` | `engine/public/client/` | regular players via `/rs2.cgi` |
| bot client | `bun run build:bot` | `engine/public/bot/` + `engine/public/bot.html` | you, via `/bot.html` |

If your engine clone is elsewhere: `ENGINE_DIR=/path/to/engine ./tools/deploy-local.sh`.

Redeploy after every code change — the page loads whatever was last copied. There is no watch
mode yet; rerun the script and hard-refresh the browser (Cmd-Shift-R). Use
`bun run build:bot:dev` for an unminified bundle when you want readable stack traces.

If your server uses a regenerated RSA key (stock Lost City servers don't), build with
`LOGIN_RSAN=<modulus> LOGIN_RSAE=<exponent> ./tools/deploy-local.sh`.

## 3a. Desktop client (no background throttling)

Running the client in a **browser tab** that you switch away from triggers
Chromium's background throttling: the 50fps game loop drops to ~1fps, the bot
starves, and the game replays at 2–5× when you refocus. To run it unattended,
use the Electron desktop shell instead — it disables that throttling
(`backgroundThrottling: false`) and holds full speed while hidden/minimized:

```sh
cd desktop && bun install      # once
bun run start                  # window against http://localhost:8888
bun run start -- --server=https://your-host   # or LCB_SERVER=…
```

It loads the same `bot.html` your engine serves (same-origin WS intact) — the
panel, scripts, settings, saved credentials, cursor trail are all identical.
`bun run package` builds a distributable. See [../desktop/README.md](../desktop/README.md).

Independently, the bot itself is hardened against any frame stall (system
sleep, throttling that slips through): the scheduler shifts pending waits
across a large frame gap so they never falsely expire.

## 4. Play

Browse **`http://localhost:8888/bot.html`**. The game canvas is on the left, the bot panel on the
right. `/rs2.cgi` remains the untouched stock client.

Connection arguments default to the dev server's (`nodeid=10`, members, high detail) and can be
overridden with query params: `bot.html?nodeid=10&members=0&lowmem=1`.

Log in with any username and password.

### The tutorial-island gotcha

**New accounts spawn on Tutorial Island with the sidebar locked** — no backpack, no stats tab.
Bots that need the inventory (ChickenKiller, Woodcutter) cannot work there. Two ways out:

1. **Play through the tutorial** (~10 minutes, fully functional). This is what real players on a
   real server do.
2. **Dev shortcut**: teleport off the island and re-log. In the chat box type
   `::tele 0,50,50,20,20` (Lumbridge), press Enter, then log out and back in. The login script
   only re-enters the tutorial while you're standing on the island, so you come back with the
   full sidebar. Give yourself gear with `::give` (section 7).

If you re-log immediately after a disconnect the server may answer "already online" — wait ~10
seconds and try again.

## 5. The bot panel

Top to bottom:

- **Adapter banner** — green `adapter self-test: ok` means every client internal the bot reads
  exists. **Red** lists missing names: an upstream merge moved something; fix it in
  `src/bot/adapter/` (see HOOKS.md) and rebuild. Don't run scripts under a red banner.
- **Script** — selector + `Start` / `Pause`(`Resume`) / `Stop`, and a status row
  (`name: state — N loops`, or the crash message). One script runs at a time. `Stop` aborts the
  script's pending waits and runs its `onStop` — it can take a moment if an action is mid-flight.
- **Status** — live `ingame`, character name, world tile (`x, z, level`), run energy/weight,
  nearby player/NPC counts, open interface ids, and the server-tick counter with its measured
  cadence (~600ms when healthy).
- **Stats** — effective/base per skill; hover for XP.
- **Chat** — last lines of game chat, newest first.
- **Log** — the running script's log (500-line ring). Crashes land here in red with a stack.

Scripts may also draw on a transparent overlay on top of the canvas (the built-ins show a small
status box top-left).

The browser console has a `lcbuddy` global (`client`, `host`, `runner`, `registry`, `reader`) for
poking at live state — possible because the bot bundle never mangles names.

## 6. The built-in scripts

| Script | Needs | What it does |
|---|---|---|
| `DebugBot` | nothing | logs nearest NPCs every couple of ticks, paints an overlay box |
| `ChickenKiller` | stand among chickens | kills chickens, loots and buries bones; leashed ~12 tiles around its start tile |
| `Woodcutter` | an axe (inventory or wielded), trees nearby | chops, drops logs when full; leashed ~15 tiles |
| `CrashTestBot` | nothing | throws on purpose to demo crash isolation |

ChickenKiller and Woodcutter **anchor where you start them** — position your character first.
Convenient dev spots: chickens at the east Lumbridge pen (`::tele 0,50,51,32,34`), trees NE of
Lumbridge (`::tele 0,50,50,30,50`, then `::give bronze_axe`).

## 7. Server debug commands

Typed into normal chat on a dev server (default `world.json` has them enabled):

| Command | Meaning |
|---|---|
| `::tele level,mx,mz,lx,lz` | teleport, jagex map-square format: world x = `mx*64+lx`, z = `mz*64+lz`. Reverse: for world (3232, 3298) → `0,50,51,32,34` |
| `::getcoord` | print your current coordinate in that format |
| `::give <debugname> [count]` | spawn items, e.g. `::give bronze_axe`, `::give coins 1000` (names are config debug names: lowercase, underscores) |
| `::setvar <varp> <value>` | set a player variable |

These exist on the live wire as cheat packets; the engine gates them by staff level (dev servers
grant it).

## 8. Writing your own bot

Two ways: **out-of-tree** against the typed `@lcbuddy/api` package (recommended — no client
rebuild), or in-tree as a built-in.

### Out-of-tree (recommended)

```sh
cp -r templates/script-template ~/my-bot && cd ~/my-bot
# edit package.json's @lcbuddy/api path to point at <repo>/packages/lcbuddy-api, then:
bun install && bun run build        # -> dist/bot.js
```

In the panel: **Load file…** → `dist/bot.js` (or serve it and use **Load URL**). The script shows
up in the selector marked `⇪`. Hot reload: `bun run watch` + re-click Load after each change
(stop the script first; the loader refuses to swap a running one). Your entry module must
`export default defineBot({ name, create, ... })`. Full rules and a working example:
[templates/script-template/README.md](../templates/script-template/README.md); the complete
typed surface is `packages/lcbuddy-api/index.d.ts`.

Loaded scripts are **trusted code** — no sandbox. Load only what you wrote or read.

Auto-relogin is on by default on `bot.html` (disable with `?autorelogin=0`): if the session drops
to the title screen while a script is running, the client pauses the script, logs back in with
the captured credentials (retrying past the ~10s already-online window), and resumes.

### In-tree (built-ins)

1. Create `src/bot/scripts/MyBot.ts`:

```ts
import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Npcs } from '../api/queries/Npcs.js';

export default class MyBot extends LoopingBot {
    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame(), 0);
        this.on('skill.level', e => this.log(`grats: ${e.name} ${e.level}`));
    }

    async loop(): Promise<void> {
        const goblin = Npcs.query().name('Goblin').action('Attack').within(10).nearest();
        if (goblin && !Game.inCombat()) {
            goblin.interact('Attack');
            await Execution.delayUntil(() => Game.inCombat(), 5000);
        }
        await Execution.delayTicks(2);
    }
}
```

2. Register it in `src/bot/scripts/index.ts`:

```ts
ScriptRegistry.register({ name: 'MyBot', description: '...', create: () => new MyBot() });
```

3. `./tools/deploy-local.sh`, refresh the browser, select it, Start.

### The API in one breath

- **Sleep only through `Execution`**: `delay(ms)`, `delayTicks(n)` (1 tick ≈ 600ms),
  `delayUntil(cond, timeoutMs)` → resolves `false` on timeout. Awaiting anything else (fetch,
  setTimeout) escapes the runtime — Stop can't unwind it and the watchdog will warn.
- **World**: `Game.tile()/ingame()/inCombat()/energy()/tick()`;
  `Npcs/Locs/GroundItems/Players.query().name(...).action(...).within(n).where(fn).nearest()`.
  Entities expose `tile()`, `distance()`, `actions()`, and `interact('Action name')` — action
  names match the right-click menu, case-insensitive.
- **HUD**: `Inventory.items()/first(name)/contains/isFull()` and `item.interact('Bury')`;
  `Equipment`, `Skills.level('woodcutting')`, `Bank` (open detection, withdraw/deposit),
  `ChatDialog.canContinue()/continue()`.
- **Movement**: `DirectNavigator.walkTo(tile, radius, timeoutMs)` — same-scene walking only until
  web-walking (Slice 5) lands.
- **Events** (`this.on(...)` in a bot, auto-cleaned on stop): `tick`, `chat.message`, `skill.xp`,
  `skill.level`, `inventory.changed`, `varp.changed`. Callbacks run mid-frame — set flags, log;
  do real work in `loop()`.
- **Base classes**: `LoopingBot` (one `loop()`, return a number to override the delay),
  `TaskBot` (`add(...tasks)`, first task whose `validate()` passes runs), `TreeBot`
  (branch/leaf walk). Lifecycle hooks: `onStart/onStop/onPause/onResume/onPaint(ctx)`.
- A thrown exception crashes only your script (state `crashed`, stack in the log); the client
  keeps running. `onStop` still runs after stop *and* crash — clean up there.

### Ground rules

- Don't touch `document`/`window` or client internals from a script — eslint fences enforce this
  (`bunx eslint src/bot`).
- Everything the bot does goes through the client's own action dispatch (byte-identical packets,
  anticheat counters intact). Don't add raw packet writes outside the adapter.

## 9. Upstream merges

```sh
git fetch upstream && git merge upstream/274
```

Then follow the checklist in [HOOKS.md](HOOKS.md): rebuild both bundles, run the login probe,
open `bot.html` and check the adapter banner. Anything red gets fixed only in
`src/bot/adapter/RawClient.ts` / `ClientAdapter.ts`.

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Red adapter banner listing names | upstream rename — update `src/bot/adapter/`, rebuild (HOOKS.md) |
| Blank canvas / stuck on "Loading..." | bundle not deployed or stale: rerun `tools/deploy-local.sh`, hard-refresh; check browser console |
| Login hangs at "Connecting to server" | engine not running, or you're on the wrong port — the client connects to the page's own origin |
| "already online" right after a disconnect | server-side logout takes a few seconds; wait ~10s |
| Bot starts but inventory/stat features do nothing | tutorial-locked account (no sidebar tabs) — see §4 |
| `Inventory`/`Bank` empty but the game shows items | open the relevant interface at least once isn't needed, but tabs must exist; on weird interfaces check `lcbuddy.reader.inventory()` in the console |
| Script status `stopping` forever + watchdog warning in log | the script is awaiting a non-`Execution` promise or hard-looping; it cannot be killed in-thread — refresh the page |
| Tick counter frozen | connection dropped; the panel state row will also stop updating — re-login |
| `::give`/`::tele` ignored | not a dev server (`node.debug=false` / production mode), or insufficient staff level |
| Engine prints `missing model ...` at boot, favicon 404s in console | known content-pack noise, harmless |
