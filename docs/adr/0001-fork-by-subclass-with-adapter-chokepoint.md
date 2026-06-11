# ADR-0001: Fork by subclass, all internals behind one adapter

**Status**: accepted (Slice 1) · **Date**: 2026-06-11

## Context

The previous attempt at a Lost City bot client died from API sprawl and breakage against upstream
changes: bot code was woven through the client, so every upstream merge broke an unknowable set
of call sites. Client-TS is ~10k lines and moves; we must merge `upstream/274` indefinitely.

A key enabler: the game page (`view/client.ejs`) instantiates `new Client(nodeid, lowmem,
members)` itself — the entry point is *outside* the bundle, so a subclass can replace the client
with zero edits to game code.

## Decision

- Bot code lives only in `src/bot/`. The client is consumed by **subclassing**
  (`BotClient extends Client`) with three one-line lifecycle overrides plus one instance patch
  (wrapping `tcpIn` for a per-packet hook). Every touch point is enumerated in HOOKS.md.
- **Only `src/bot/adapter/` may name client internals.** `RawClient.ts` is a structural type of
  every internal we touch; `ClientAdapter.ts` exposes `reader`/`actions` to the rest of the bot.
  An eslint `no-restricted-imports` fence enforces the boundary (protocol const-enums exempt —
  they inline to numbers).
- `attach()` runs a **self-test**: every expected internal name is checked with `in` against the
  live instance; missing names render as a red panel banner. A `satisfies`-based exhaustiveness
  check makes the manifest impossible to drift from the type.
- We **rejected the plan's "one visibility-widening commit"** (private→protected on ~15 members).
  Reads and instance patches work through a structural cast (`client as unknown as RawClient`) —
  TypeScript `private` is compile-time only — which keeps the upstream diff at literally zero
  game-code lines and can never conflict on merge. Revisit only if something a cast can't express
  appears.

## Consequences

- An upstream rename is a one-file fix, and the self-test names it before any script misbehaves.
- The cast trades away compiler protection against upstream *type* changes for zero merge
  conflicts; the self-test + per-slice E2E runs are the compensating control.
- Subclass hooks depend on `mainloop`/`mainredraw` staying overridable (they are public/protected
  on 274); HOOKS.md tracks this as the break condition for H1–H3.
