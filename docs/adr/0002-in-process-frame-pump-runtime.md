# ADR-0002: In-process frame-pump script runtime

**Status**: accepted (Slice 2) · **Date**: 2026-06-11

## Context

RuneMate-style APIs assume blocking calls on a bot thread. JavaScript in a browser has one
thread; scripts must be async, but uncontrolled async (setTimeout, raw promises) gives scripts
torn reads mid-frame and gives the runner no way to implement stop/pause.

## Decision

Scripts make progress **only** through the scheduler's frame pump, which runs once per client
frame from `BotHost.onFrame()`:

- The only legal sleeps are `Execution.delay(ms)` / `delayTicks(n)` / `delayUntil(cond, timeout)`
  — promises that the pump alone resolves. Between awaits a script therefore observes frozen,
  consistent game state (RuneMate's guarantee minus preemption).
- **Stop = abort**: every pending waiter rejects `ScriptAborted`, the await chain unwinds through
  the script's own `finally` blocks, then `onStop()` runs. **Pause** = the pump stops resolving
  that script's waiters; wall-clock deadlines are shifted on resume so paused time never counts.
  Tick-based waits keep counting real server ticks.
- Crashes are isolated: the loop promise's rejection marks the run `crashed`, logs the stack to
  the panel ring, and still runs `onStop()`. The client cannot be taken down by a script — every
  callback runs inside try/catch firewalls.
- A synchronous infinite loop (or an await on a promise the pump doesn't own) cannot be killed
  in-thread. This is a documented contract; a watchdog warns after 10s without scheduler
  progress. A Worker-hosted runtime that *can* be terminated is a future, additive option.
- The **server tick** is counted by observing PLAYER_INFO (opcode 167) packets via the H4 hook —
  measured at a 600ms mean cadence in Phase 0.

## Consequences

- `delayUntil` conditions are evaluated at most once per frame — scripts can't busy-spin.
- Scripts that await `fetch`/`setTimeout` escape stop/pause control; the watchdog makes this
  visible rather than silent.
- Event callbacks (ADR-0005) run synchronously mid-frame and must stay light; loop() is where
  work happens.
