# ADR-0006: One active script per client (v1)

**Status**: accepted (Slice 2) · **Date**: 2026-06-11

## Context

`Execution.delay()` is called as a bare static (RuneMate shape) — the runtime must know *which*
script is sleeping. Browsers have no `AsyncLocalStorage`, so per-script async context tracking
would require fragile continuation bookkeeping around every pump resolution, with edge cases
whenever a script composes promises.

## Decision

v1 runs **one script at a time**. `Scheduler.active` is the single run's context; `Execution.*`
binds to it implicitly and rejects when nothing is running. The panel reflects this (one
selector, one Start). The `ScriptContext`/waiter model already keeps per-run state, so a later
multi-script scheduler is an extension (explicit context handles or worker isolation), not a
rewrite.

## Consequences

- Zero async-context machinery; stop/pause semantics are trivially correct.
- One character = one behavior at a time — matching how the product is actually used. Multi-account
  is "more browser tabs", which this design already supports (each tab is its own client+runtime).
- Background "always-on" helpers (auto-relogin in Slice 7) hook BotHost directly rather than
  running as scripts, so the constraint doesn't block them.
