# HOOKS.md — every point where LCBuddy2 touches the upstream client

The architecture rule (docs/PLAN.md): bot code lives in `src/bot/`, the client is consumed by
subclassing, and every read of client internals goes through `src/bot/adapter/`. This file lists
the complete set of touch points. If an upstream merge breaks the bot, the break is in this list.

## Touch points

| # | Kind | What | Breaks if (upstream) |
|---|------|------|----------------------|
| H1 | subclass override | `BotClient.mainloop()` → `BotHost.onFrame()` after `super` | `GameShell.mainloop` renamed/resignatured, or `Client.mainloop` becomes private/final-ish |
| H2 | subclass override | `BotClient.mainredraw()` → `BotHost.onDraw()` after `super` | same as H1 for `mainredraw` |
| H3 | subclass override | `BotClient.mainquit()` → `BotHost.onShutdown()` before `super` | `mainquit` renamed or visibility tightened below `protected` |
| H4 | instance patch (in `ClientAdapter.attach()`) | wrap `tcpIn` to fire the packet listener with `ptype0` after each `true` return | `tcpIn` renamed, stops returning one-packet-per-`true`, or `ptype0` no longer set before dispatch (Client.ts ~5923 on 274) |
| H5 | new file | `src/bot/main.ts` bundle entrypoint (self-boots when `#canvas` exists) | — (ours) |
| H6 | new file | `public-bot/bot.html` — replicates the `client.ejs` DOM contract: `<canvas id="canvas" width="765" height="503">` must exist at module load | `client.ejs` adds DOM the client reads at load (compare on merge) |
| H7 | new file | `bot.bundle.ts` — entry `src/bot/main.ts`, **no terser property mangling**, console kept | `bundle.ts` changes its `define` map or output layout (keep in sync) |
| H8 | config edit | `eslint.config.ts`: appended `src/bot/` import/DOM fence blocks (marked) | trivial conflicts only |
| H9 | config edit | `package.json`: added `build:bot` / `build:bot:dev` scripts + `playwright-core` devDep | trivial conflicts only |
| H10 | doc replace | `README.md` rewritten as LCBuddy2's front door | trivial conflicts only (take ours, fold upstream notes in) |
| H11 | adapter call (Slice 6) | synthetic input calls the protected `GameShell` handlers `mouseDown(x,y,e)` / `mouseUp(x,y,e)` / `pointerMove(x,y,e)` directly (not DOM events) — they read only `e.button` and otherwise touch `mouseX/Y`, `nextMouseClick*`, `idleTimer` exactly as the real listeners | any of these handlers renamed, or `mouseDown` starts reading more of the event than `.button`, or the `mouseClick*` latch in `GameShell.run()` (~186) changes |
| H12 | adapter write (Slice 6) | synthetic keyboard writes `keyHeld[ch]` + the `keyQueue`/`keyQueueWritePos` ring directly, mirroring `GameShell.onkeydown` (arrows = ch 1-4 → camera; ch>4 → ring) | `keyHeld` indexing for arrows (1=left,2=right,3=up,4=down) changes, or the ring write math (`& 0x7f`) changes (GameShell ~471) |

The Slice 6 adapter also *reads* render-camera (`camX/Y/Z`, `camPitch`, `camYaw`, `getAvH`) and
minimap (`orbitCameraYaw`, `macroMinimapAngle`, `macroMinimapZoom`, `minimapState`) state to mirror
`getOverlayPos` (Client.ts ~5017) and `minimapLoop` (~2742) for world→screen / screen→tile projection,
and open-minimenu geometry (`isMenuOpen`, `menuArea/X/Y/Width/Height`) to hit-test menu rows
(`mouseLoop` ~8290). All are in `RawClient.ts` + `SELF_TEST`.

Every name the adapter reads is declared in `src/bot/adapter/RawClient.ts` and checked at runtime
by the **self-test** (`ClientAdapter.attach()` returns missing names; the panel shows a red banner).

## Deviations from PLAN.md (recorded decisions)

- **No visibility-widening commit (yet).** The plan tolerated one upstream commit widening ~15
  `Client` members `private`→`protected`. Slice 1 needs only *reads* plus the H4 instance patch,
  and a structural cast (`client as RawClient`, dot-access, mangle-safe in our unmangled bundle)
  covers that with **zero upstream edits** — so upstream merges can't conflict on it. Revisit only
  if a later slice needs something a cast can't express.
- **bot.html does not call `new BotClient(...)` inline**; `main.ts` self-boots (guarded on
  `#canvas` existing) reading connection args from the query string (`?nodeid=10&lowmem=0&members=1`,
  defaults match the dev server). Keeps all JS in the bundle.
- **Synthetic input mode (Slice 6) is opt-in.** A script picks it via `AbstractBot.inputMode`
  (default `'direct'`, so every existing soak/test is unchanged); the page query param
  `bot.html?inputmode=synthetic|direct` (read in `main.ts` → `ActionRouter.force`) overrides every
  run and is the additive hook `tools/synthetic-test.ts` uses. No silent fallback to direct on a
  synthetic failure (ADR-0003): it resolves false and logs `synthetic-fail: …`.

## Upstream-merge checklist

1. `git fetch upstream && git merge upstream/274` (or the new branch).
2. `git diff HEAD@{1} -- view/client.ejs bundle.ts` upstream-side — mirror anything relevant into
   `public-bot/bot.html` / `bot.bundle.ts` (H6/H7).
3. `bun run build && bun run build:bot` — both must succeed (prod build catches mangle/access
   regressions per PLAN.md).
4. `bun tools/login-probe.ts` against a running dev server — protocol still good.
5. Open `bot.html`, check the adapter self-test banner — any red names are fixed **only** in
   `src/bot/adapter/`.
6. Re-verify the H4 assumptions if `Client.tcpIn` changed (one packet per `true` return; `ptype0`
   set before dispatch).
