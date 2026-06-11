<div align="center">
    <h1>LCBuddy2</h1>
    <p>A RuneMate-style bot client for Lost City (2004scape), forked from
    <a href="https://github.com/LostCityRS/Client-TS">LostCityRS/Client-TS</a> @ revision 274.</p>
</div>

LCBuddy2 is the official Lost City web client plus a first-class, in-process TypeScript bot API.
Scripts run inside the client against a clean, RuneMate-shaped surface (`Npcs.query()...`,
`Execution.delayUntil(...)`, `Inventory`, `Bank`, an event bus) and act through the client's own
input dispatch, so the server sees exactly what a human click produces. Regular players on
`/rs2.cgi` are untouched; the bot client is a separate page (`/bot.html`) served from the same
engine.

The fork is built to survive upstream: bot code is quarantined in `src/bot/`, the client is
consumed by subclassing, and every read of client internals goes through one adapter file with a
runtime self-test. See [HOOKS.md](HOOKS.md) for the complete list of touch points.

## Quickstart

```sh
# 1. a local server (Node 24+; see docs/OPERATING.md for details)
git clone --branch 274 --single-branch https://github.com/LostCityRS/Engine-TS engine
git clone --branch 274 --single-branch https://github.com/LostCityRS/Content content
cd engine && npm install && npx tsx src/app.ts

# 2. build + deploy both clients into the engine (Bun)
cd LCBuddy2 && bun install
ENGINE_DIR=../engine ./tools/deploy-local.sh

# 3. play
open http://localhost:8888/bot.html
```

Log in with any username/password (dev servers auto-create accounts), pick a script in the right
panel, press Start. **Read [docs/OPERATING.md](docs/OPERATING.md)** — it covers the one big
gotcha (new accounts are tutorial-locked) and everything else an operator needs.

## Status

| Slice | What | State |
|---|---|---|
| 0 | Dev environment, login probe, RSA/tick verification | done |
| 1 | Bot skeleton, adapter + self-test, live state panel | done |
| 2 | Script runtime (Execution, abort/pause, base classes) | done |
| 3 | Direct interaction, queries, ChickenKiller | done |
| 4 | HUD readers, event bus, Woodcutter | done |
| 5 | Navigation / web-walking | in progress |
| 6 | Humanization / synthetic input | planned |
| 7 | External script authoring (`@lcbuddy/api`) | planned |

Built-in scripts so far: `DebugBot`, `ChickenKiller`, `Woodcutter` (plus `CrashTestBot` for the
error firewall). Until Slice 7 lands, custom scripts are added in-tree — see the operating manual.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/OPERATING.md](docs/OPERATING.md) | **The manual.** Run a server, build, deploy, play, write a bot, debug commands, troubleshooting |
| [docs/PLAN.md](docs/PLAN.md) | Full design: architecture, navigation, humanization, slice plan |
| [docs/DEV.md](docs/DEV.md) | Dev environment details + verified facts + headless test harnesses |
| [HOOKS.md](HOOKS.md) | Every upstream touch point + the upstream-merge checklist |
| [docs/adr/](docs/adr/) | Architecture decision records |

## Upstream

This repo tracks `LostCityRS/Client-TS` branch `274` via the `upstream` remote:
`git fetch upstream && git merge upstream/274`, then run the checklist in HOOKS.md. The upstream
project is the [Lost City](https://lostcity.rs/t/faq-what-is-lost-city/16) preservation effort —
this fork exists for sanctioned botting/automation research on private servers.

## License

MIT, same as upstream. See [LICENSE](LICENSE).
