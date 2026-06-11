# LCBuddy2 dev environment

## Local Engine@274 dev server

```sh
mkdir -p ~/code/lostcity-dev && cd ~/code/lostcity-dev
git clone --branch 274 --single-branch https://github.com/LostCityRS/Engine-TS engine
git clone --branch 274 --single-branch https://github.com/LostCityRS/Content content
```

The engine requires **Node 24+** (uses `node:sqlite`). With Homebrew: `brew install node@24`
(keg-only; prefix engine commands with `PATH="/opt/homebrew/opt/node@24/bin:$PATH"`).

On macOS the default web port is **80** — pin it before first boot:

```sh
# engine/data/config/world.json
{ "web": { "port": 8888 } }
```

Boot: `cd engine && npm install && npx tsx src/app.ts`. First run packs the cache (~10s),
then: `World ready: Visit http://localhost:8888/rs2.cgi`.

- Game WS is served on the **same origin** (HTTP upgrade in `src/web.ts`), exactly what
  `ClientStream.openSocket(window.location.host, ...)` expects.
- `login.enabled=false` (default): **any username/password logs in**; saves are flat files in
  `engine/data/players/main/<username>.sav`. No registration needed.
- Default world config: `nodeid=10`, `members=true`, `xpRate=1`, sqlite backend, debug on.
  `/rs2.cgi` renders `new Client(10, 0, true)`.

## Build & deploy the client

```sh
bun install
bun run build          # prod: terser + property mangling — what players get
cp out/client.js out/client.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/tinymidipcm.wasm ~/code/lostcity-dev/engine/public/client/
```

`bun run build:dev` skips minification and keeps console.

## Login probe (headless smoke test)

```sh
bun tools/login-probe.ts [host:port] [username] [password]   # defaults: localhost:8888 lcbuddy test
```

Drives the real `ClientStream`/`Packet`/`Isaac` modules through the full login handshake, then
samples the packet stream for 5s. PASS requires: login response 2, every ISAAC-decoded opcode
valid, and ≥2 `PLAYER_INFO` packets. Run it after any upstream merge or protocol-adjacent change.

## Phase 0 verified facts (2026-06-11, Engine-TS@274 + Content@274 + Client-TS@274)

- **RSA**: engine ships the stock 2003–2010 keypair in `data/config/*.pem`; moduli match the
  client's built-in `LOGIN_RSAE/LOGIN_RSAN` defaults exactly. **No env override needed** unless
  the target server regenerated its key.
- **Build parity**: our `bun run build` output is byte-identical in size to the prebuilt
  `public/client/client.js` the engine ships; served bytes verified equal with `cmp`.
- **Tick cadence**: `PLAYER_INFO` (opcode 167) arrived 10× in 5s, mean interval **600ms** —
  confirms the PLAYER_INFO-as-tick assumption used by the scheduler design.
- **Login reply**: `staffmodlevel=2`, `mouseTracked=1` on a dev server. Note `mouseTracked=1`:
  the 274 engine already asks clients for mouse telemetry at login — relevant to the Phase 2
  detection-research pipeline.
- **`view/client.ejs` requirements** (what `bot.html` must replicate): `<canvas id="canvas"
  width="765" height="503">` must exist at module load; page calls
  `new Client(nodeid, lowmem, members)` from a `type="module"` script.
