# LCBuddy2 — a RuneMate-style bot client for Lost City (2004scape)

## Context

You run a private Lost City server (Engine-TS @ branch **274**, Nov-2004 revision) and want a
client where players write TypeScript automations against a clean, RuneMate-like API. Secondary
goal: the realistic input this client emits feeds a labeled dataset for bot-detection research on
your live (non-botting) server.

Lost City is open source (MIT), so unlike RuneMate/OSBot we do **not** inject into a hostile
client — we fork the official web client (`LostCityRS/Client-TS`) and add a first-class bot API
inside it. Your past attempt at this died from **API sprawl and breakage against upstream
changes**. The whole architecture below is organized to prevent that: bot code is quarantined in a
new `src/bot/` tree, the client is consumed by *subclassing* rather than editing, and every read of
client internals goes through **one** adapter file so an upstream rename is a one-file fix.

All work happens in `github.com/ejtriple/LCBuddy2` (currently an empty repo).

### Key facts established during research (trust these; re-verify only where flagged)

- **Client-TS@274** — `export class Client extends GameShell` (`src/client/Client.ts`, ~10.6k lines).
  Game loop in `GameShell.run()` → `mainloop()` (N× per redraw, catch-up) → `mainredraw()`, 50fps.
  The **page** (`view/client.ejs` served at `/rs2.cgi`) does `new Client(...)`, not the bundle — so a
  subclass can replace it with zero edits to game code.
- **Connection**: `ClientStream.openSocket(window.location.host, ...)` — the client WebSockets to
  *its own origin*. So the bot client must be **served from your Engine server** (drop built files
  into Engine's `public/`; any non-`/rs2.cgi` GET is served statically). No Engine code change to host it.
- **State/menu/dispatch** (names verified on 274): `ingame`, `players`+`playerCount`+`playerIds`,
  `npc`+`npcCount`+`npcIds`, `localPlayer`, `statBaseLevel/statEffectiveLevel/statXP` (Int32Array,
  Skill.count=25), `var` (varps), `chatType/chatUsername/chatText` (ring of 100),
  `menuOption/menuAction/menuParamA/B/C`+`menuNumEntries`, modal ids `mainModalId/sideModalId/chatModalId`,
  scene base `mapBuildBaseX/mapBuildBaseZ` + plane `minusedlevel`. Menu dispatch: `doAction(optionId)`
  (private) → big switch → `this.out.p1Enc(ClientProt.X)` (note: **`p1Enc`**, not 225's `pIsaac`).
  Walk/approach primitive: `tryMove(...)`. Inventory = items on a `TYPE_INV` interface component
  (`linkObjType/linkObjNumber`). Picking is render-coupled (`Model.pickedEntityTypecode`), menu
  rebuilt each redraw by `buildMinimenu()`.
- **Build reality**: prod build (`bundle.ts`, Bun) runs terser with **property mangling**. In-bundle
  access via real dot-syntax survives (mangled consistently); **string-keyed access
  (`(c as any)['menuOption']`) breaks**. Our bot bundle will **disable property mangling** so the
  public API global keeps stable names for externally-compiled scripts.
- **Engine-TS@274** ships the server side of input telemetry (`EventMouseMove/Click/CameraPosition`
  decoders → `InputTracking` → logger → SQL `input_report`). This is the detection-research data
  source; it's gated by `player.input.active` (default off) — a one-line research-fork change later.
- **Prior art**: `dginovker/LostCityClientBot` (Client-TS fork exposing `window.bot` for external
  DevTools/MCP control). Good reference for *field-access patterns*; targets 225-era names. We want an
  in-process script platform, not external poking — port ideas, not code.

---

## Architecture (the three load-bearing decisions)

### 1. Near-zero-diff fork via subclass + new entrypoint
- `LCBuddy2` is initialized from Client-TS@274 history with `upstream = LostCityRS/Client-TS` so
  `git merge upstream/274` works forever.
- **No edits to existing game-logic files.** We add:
  - `src/bot/BotClient.ts` — `class BotClient extends Client`, overriding `mainloop`/`mainredraw`/
    `mainquit` with one-line calls into `BotHost`.
  - `bot.bundle.ts` — clone of `bundle.ts` with entrypoint `src/bot/main.ts`, **no property mangling**,
    console kept.
  - `public-bot/bot.html` — replicates the DOM `client.ejs` needs (`<canvas id="canvas">` must exist
    at module load), plus the bot panel + overlay canvas; `new BotClient(...)`.
- **The one tolerated upstream change**: a single, reviewable commit widening ~15 `Client` members
  from `private`→`protected` so `BotClient`/adapter compile cleanly. (Fallback if we want literally
  zero edits: confine `(this as any).field` casts to the adapter — dot-access, so mangle-safe. The
  visibility commit is cleaner and rarely conflicts; documented in `HOOKS.md`.)
- **Touch points** (all in `HOOKS.md` with a "breaks if" note + rebase checklist):
  | # | Kind | What |
  |---|---|---|
  | H1–H3 | subclass overrides | `mainloop`→`BotHost.onFrame()`, `mainredraw`→`onDraw()`, `mainquit`→`onShutdown()` |
  | H4 | instance patch (in adapter `attach()`) | wrap `tcpIn` to fire `BotHost.onPacket(ptype)` after each processed packet |
  | H5–H7 | new files | `src/bot/main.ts` entry, `bot.html`, `bot.bundle.ts` |
- **Adapter self-test**: `ClientAdapter.attach()` returns the list of expected internal names that are
  `undefined` → shown as a red banner in the panel. After any upstream merge this instantly says
  whether names moved, and the fix is confined to `adapter/`.

### 2. In-process async script runtime
JS is single-threaded; RuneMate blocks bot threads but we can't. Model:
- **Scripts run only from the scheduler's frame pump and only sleep via `Execution.*`** — between
  awaits a script sees frozen, consistent state (RuneMate's guarantee minus preemption).
- `BotHost.onFrame()` (wrapped in try/catch so a bot bug can never crash the client): run event
  producers (diff state → `EventBus`), then `Scheduler.pump()` — resolve due waiters, advance the
  **tick counter** (count `PLAYER_INFO` packets ≈ one per 600ms server tick), launch the next
  `loop()` iteration if the prior settled and `loopDelay` elapsed.
- `Execution.delay(ms)` / `delayTicks(n)` / `delayUntil(cond, timeout)` return promises the pump
  resolves. **Stop** = `AbortController.abort()` → all pending waiters reject `ScriptAborted`, the
  await-chain unwinds through the script's `finally`, runner runs `onStop()`. **Pause** = pump stops
  resolving that script's waiters. Synchronous infinite loops can't be killed in-thread (documented
  contract + watchdog warning; Worker-hosted runtime is a future, additive option).
- Bot base classes: `LoopingBot` (abstract `loop()`), `TaskBot` (first valid `Task.validate()` runs),
  `TreeBot` (branch/leaf walk) — TaskBot/TreeBot are pure layering over LoopingBot.

### 3. Connection & distribution
- Built files (`out/botclient.js` + map, `public-bot/bot.html`) are copied into your Engine's
  `public/`; players browse `https://your-host/bot.html`. Same origin → WS + all `/crc`,`/title`,…
  OnDemand fetches just work. Regular players on `/rs2.cgi` are untouched.
- **RSA login key**: if your server regenerated `data/config/public.pem` from the stock key, the bot
  build needs the matching modulus via `LOGIN_RSAN`/`LOGIN_RSAE` env at build time. *(Verify in Phase 0.)*

---

## Module layout (`src/bot/`)

```
main.ts                 entrypoint (exports BotClient)
BotClient.ts            subclass; ONLY place that extends/instantiates upstream
BotHost.ts              singleton: attach(client); onFrame/onDraw/onPacket fan-out + try/catch firewall
adapter/
  ClientAdapter.ts      THE ONLY file reading/writing client internals  ← upstream-rename chokepoint
  RawClient.ts          structural type of every internal we touch + SELF_TEST manifest
api/                    RuneMate-shaped public surface (imports adapter ONLY)
  Execution.ts  Tile.ts  Area.ts
  entities/  queries/  hud/  ids.ts
runtime/  ScriptRunner Scheduler ScriptContext ScriptRegistry loader
events/   EventBus producers
input/    InputDriver(iface)  DirectInputDriver  ActionRouter  + humanize/ (Slice 6)
nav/      Navigator(iface)  DirectNavigator  + pack/ path/ transport/ exec/ (Slice 5)
ui/       BotPanel Overlay        ← the ONLY DOM-dependent dir (keeps headless viable later)
scripts/  built-in example bots
```
Enforced import rule (eslint `no-restricted-imports`): only `adapter/` may import `src/client|io|
config|dash3d/*` (protocol const-enums like `ClientProt`/`MiniMenuAction` exempt). Only `ui/` and
`BotClient`/`main` may touch `document`/`window`.

Adapter shape:
```ts
export function attach(client: Client): string[];           // returns missing internal names (self-test)
export const reader  = { ingame, localPlayer, npcs(), toWorldTile(lx,lz), stat(i), varp(i), component(id), ... };
export const actions = { menuAction(action,a,b,c), walkTo(lx,lz), writePacket(build) };  // only Direct drivers call these
```
Going through `doAction`/`tryMove` (not raw packets) keeps the client's own anticheat counters and
approach logic consistent — the server sees exactly what a human click produces.

API surface (RuneMate shape, TS): `Npcs.query().name('Goblin').within(area).reachable().nearest()`;
entity ifaces `Interactable.interact(action)`/`Locatable`/`Validatable`/`Animable`; HUD `Inventory`/
`Bank`/`Equipment`/`Skills`/`ChatDialog`/`Camera`; `Execution.delayUntil(...)`; events
`bus.on('skill.xp'|'inventory.changed'|'chat.message'|'tick'|'varp.changed', …)`.

---

## Navigation / web-walking (`src/bot/nav/` + offline tool) — Slice 5

- **Offline collision pack** (`tools/nav/build-collision.ts`, Bun): ports Engine-TS@274
  `GameMap.loadGround/loadLocations` + rsmod collision (vendored from `src/engine/routefinder/`, MIT)
  to bake the **whole 2004 world** (483 mapsquares; x∈[1856,3647], z∈[1280,10367], 4 planes) into a
  packed grid — per tile an 8-bit **exit mask** (precomputed wall/corner step legality) + 1-bit
  walkable. Output `collision.lcnav`: ~3.5–5 MB raw, **~0.5–1 MB gzipped**, served as one static
  asset, gunzipped with `fflate` (already a client dep) in a worker. Must mirror the server's
  members flag (F2P gating). *(Verify exact sizes at M0.)*
- **Global pathfinder**: flat **A\*** over the packed grid + transport edges, in a **Web Worker**
  (sparse per-region page allocation; packed 28-bit coord node ids). Estimates: Lumbridge↔Varrock
  ~5–20ms, ↔Falador ~15–60ms; off the frame thread. Targets p50<50ms / p95<150ms.
- **Local pathfinder**: direct port of the client's `tryMove` BFS over the live 104×104
  `CollisionMap` for `isReachable`, nearest-walkable snapping, waypoint validation (sync, <1ms).
- **Transport graph** (doors/gates/stairs/ladders/ships): TS/JSON edges `{from,to,type,locId,
  action,requirements?}`. Seed by (a) **auto-deriving** door/gate edges from cache loc defs with
  `Open` actions on wall-shape locs (`tools/nav/derive-doors.ts`), (b) a **hand-curated** core-routes
  file (Lumbridge–Varrock–Falador–Draynor–Al Kharid–Port Sarim: stairs, toll gate, ladders, ship),
  PR-able. Ships gated until dialog automation lands.
- **Walk executor**: tick-driven state machine (PLANNING→WALKING⇄TRANSPORT_INTERACT→WAIT→ARRIVED,
  STUCK_RECOVERY) — chunk path into ≤~20-tile minimap-click waypoints via the input layer, monitor
  progress, open doors (interact + wait for the wall collision flag to clear), re-path on stuck.
- API: `Coordinate`, `Area.rectangular/circular().getRandomCoordinate()`, `Traversal.walkTo(dest)`
  (awaits arrival, abortable) and `WebPath.step()` (one increment per bot loop, RuneMate style).

---

## Humanization / synthetic input (`src/bot/input/`) — Slice 6

- **VirtualInput**: injects synthetic input by calling the *same protected `GameShell` handlers* the
  real DOM handlers call (`mouseDown/Up`, `pointerMove`, key queue), **not** DOM events — telemetry is
  identical either way (it's sampled from `mouseX/Y`/`mouseClick*`), avoids `getBoundingClientRect`
  scaling hazards, and keeps a future headless build viable. Ticked once per `mainloop` (50Hz, finer
  than the 50ms telemetry sampler). Always touch `idleTimer` like the real handlers.
- **ActionRouter** (one entry point, per-bot mode):
  - **SYNTHETIC**: move virtual cursor (WindMouse) to target → wait for render-picking/menu to
    resolve (poll `menuOption`) → left-click if it's the default (last) entry, else right-click +
    move to the row (respect strict hit band + 10px auto-close) + click. Off-screen → rotate camera
    via arrow-key holds; still off-screen → error (no silent direct fallback — keeps the dataset
    cleanly labeled).
  - **DIRECT**: write `menuParamA/B/C`+action into a scratch menu slot and call `doAction` — byte-
    identical OP packet, **no** mouse/click telemetry. The deliberate "machine" class + future
    headless path.
- **Humanization profiles** (`humanize/`, data-driven `Profile` interface): **WindMouse** trajectories
  (gravity/wind/inertia; per-frame points), log-normal reaction/dwell, distance-scaled overshoot,
  Gaussian click jitter (never dead-center), idle fidgets + heavy-tail long pauses, arrow-key camera
  habits — all from a **seeded PRNG keyed on the account** so each bot has a stable personality.
  Profiles are JSON so a future recorded/learned model implements the same interface.
- **Why it matters for detection**: each knob maps to an observable server-side feature
  (move-delta magnitudes, inter-click intervals, run-lengths, camera cadence, overshoot) — that's the
  parameterized labeled data your detector trains on. v1 bar: synthetic distributions are continuous,
  qualitatively overlap a human envelope, and are visibly distinct from DIRECT — **not** beating a
  trained detector.

---

## Script authoring & loading — Slice 7

- npm package **`@lcbuddy/api`**: `.d.ts` for the full surface + a ~20-line runtime shim resolving
  `globalThis.__lcbuddy` (the client assigns this one global at `attach`; its property names are the
  ABI → why the bot bundle disables property mangling; `apiVersion` checked by the shim).
- Manifest: `export default defineBot({ name, version, description, settingsSchema?, create:()=>new MyBot() })`.
- Getting scripts in: **built-ins** compiled into the bundle; **dev** via a template repo
  (`bun build --watch` + static serve → panel "Load from URL" with cache-busting reload = hot reload);
  **players** via file picker (`URL.createObjectURL` → dynamic `import()`). Trusted code, no sandbox in v1.

## UI — Slice 1+
`bot.html`: game `<canvas>` + transparent overlay `<canvas>` (pointer-events:none) + right-docked
`#bot-panel`. `BotPanel` (plain DOM): script selector, Start/Pause/Stop, status row, log console
(500-ring), settings JSON, adapter self-test banner. `Overlay` owns the overlay 2D ctx, calls
`script.onPaint(ctx)` each redraw (try/catch) — bots draw stats without touching Pix2D.

---

## Build & deploy
`bot.bundle.ts`: entrypoints `src/bot/main.ts`→`out/botclient.js` (+ `OnDemandWorker`, nav worker,
`tinymidipcm.wasm`); same `define` map as upstream (set `LOGIN_RSAN/E` if your key differs);
`minify:true` but **no terser property mangle**; keep console. Deploy = copy `out/botclient.js`(+map)
and `bot.html` into `<engine>/public/`. Optional CI: GitHub Action builds → artifact zip → scp.

---

## Implementation order (vertical slices — each ends in a runnable demo to kill the sprawl failure mode)

- **Phase 0 — Bootstrap & GitHub**
  - GitHub: SSH already authenticates as `ejtriple` (verified). Set `git config --global user.name/email`,
    install `gh` CLI (optional, for PRs), confirm push to `LCBuddy2`.
  - Initialize `LCBuddy2` from **Client-TS@274** (import history; add `upstream` remote). Install Bun.
  - Stand up a local dev server: clone **Engine-TS@274** + **Content@274**, boot it, build the **stock**
    client, drop into Engine `public/`, log in. **Verify RSA key** + `members`/`nodeid` args.
  - *Exit: stock client builds and connects to a local Engine@274; you can log in.*
- **Slice 1 — Skeleton + live state panel**: `BotClient`, `BotHost`, `ClientAdapter` (readers +
  self-test), `bot.bundle.ts`, `bot.html`, minimal `BotPanel` showing live `ingame`, world tile,
  energy, stats, last chat lines, ticking tick-counter. *Exit: panel mirrors the game.*
- **Slice 2 — Runtime + first script**: `Scheduler`, `ScriptRunner`, `Execution.*`, abort/error
  isolation, log console, `LoopingBot/TaskBot/TreeBot`, built-in `DebugBot` (nearest-NPCs + overlay
  paint). *Exit: script runs/pauses/stops cleanly, survives a thrown exception.*
- **Slice 3 — Direct input + interaction + queries**: `InputDriver`+`DirectInputDriver`,
  `ActionRouter` (direct mode), `Npcs/Players/Locs/GroundItems` queries, `Interactable.interact`
  (OPNPC/OPLOC/OPOBJ), `ChatDialog.continue`, `DirectNavigator.walkTo` (tryMove). Built-in
  `ChickenKiller` (TaskBot). *Exit: kills chickens + buries bones unattended for 1 hour.*
- **Slice 4 — HUD + events**: Inventory/Skills/Equipment/Bank readers (resolve `TYPE_INV` ids in
  `ids.ts`), inventory/skill/chat/tick events, ground-item pickup, loc interact. Built-in
  `Woodcutter`. *Exit: overnight-stable woodcutter.*
- **Slice 5 — Navigation / web-walking** (per nav section). *Exit: unattended Lumbridge→Varrock→
  Falador crossing ≥1 door/gate and a staircase, with stuck-recovery.*
- **Slice 6 — Humanization / synthetic input** (per humanization section); switch example bots to
  synthetic mode. *Exit: synthetic bots run an hour; telemetry visibly human-shaped vs direct.*
- **Slice 7 — External authoring + hardening**: `@lcbuddy/api` + shim + loader + template + hot
  reload; finalize `HOOKS.md`; **upstream-rebase drill** proving the one-file-fix claim; auto-relogin.
  *Exit: a third example bot authored out-of-tree against the typed API; upstream merge is painless.*
- **Phase 2 (post-v1, north-star, noted not built)**: headless multi-account (farm/load-test);
  detection-data pipeline (flip `input.active` server-side, decode `input_report`, build labeled
  dataset); ship travel; bank PIN; settings UI polish.

---

## Risks / uncertainties to resolve during implementation
- `tryMove` `type` arg → which MOVE_* opcode; loc (scene-object) enumeration on 274 `World.ts` and
  the `menuParamA/B/C` encoding for `OPLOC*`.
- `TYPE_INV` component ids for the 274 cache (discover at runtime; `linkObjType` off-by-one).
- RSA key / `members`/`nodeid` mismatch vs your server (Phase 0).
- `PLAYER_INFO`-as-tick assumption (confirm 600ms cadence while ingame).
- Bun bundler worker-entrypoint support for the nav worker (fallback: budgeted main-thread A*).
- Server-side `InputTracking` 160-byte mouse-move drop vs 240-byte client emit; `input.active` default
  off — both one-line research-fork changes for Phase 2.
- terser property-mangle disabled correctly (a leftover string-keyed internal access would only fail
  in a prod bundle — Slice 1 builds prod to catch it early).

## Verification per slice
Each slice exit criterion above is the test. Cross-cutting: build the **production** bundle every
slice (catches mangle/access regressions); run the adapter self-test after every `upstream` merge;
the soak tests (chickens 1h, woodcutter overnight, nav 30min loop) are the real correctness bar —
v1 quality target is "three example bots run unattended for an hour", not a product launch.
