# LCBuddy2 script template

Author bots out-of-tree against the typed `@lcbuddy/api` surface and load them into the running
bot client — no client rebuild needed.

## Workflow

```sh
bun install          # once (links @lcbuddy/api from this repo's packages/)
bun run build        # -> dist/bot.js (single-file ESM, shim bundled in)
```

Then in the bot panel (`bot.html`): **Load file…** → pick `dist/bot.js`, or serve `dist/` over
HTTP and paste the URL into **Load URL**. The script appears in the selector (marked `⇪`);
Start it like any built-in.

**Hot reload**: `bun run watch` in one terminal, then just click *Load URL* again after each
change — the loader cache-busts every load and replaces the previous registration (the script
must be stopped first; the panel refuses otherwise).

## Authoring rules

- Your entry module must `export default defineBot({ name, create, ... })`.
- Sleep **only** via `Execution.delay/delayTicks/delayUntil` — anything else escapes stop/pause
  control and trips the watchdog.
- `interact()` returns `boolean | Promise<boolean>` (synthetic mode gestures span frames); gate
  progress on game state with `delayUntil`, not on the click result alone.
- Event callbacks (`this.on(...)`) run mid-frame: set flags and log only; do work in `loop()`.
- Set `inputMode = 'synthetic'` on your bot for humanized mouse input (default `'direct'`).
- Trusted code, no sandbox: a loaded script has full page access. Load only what you wrote.

See `src/ExampleBot.ts` for a complete working example and
`node_modules/@lcbuddy/api/index.d.ts` for the full typed surface.
