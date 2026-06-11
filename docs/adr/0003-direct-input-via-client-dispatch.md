# ADR-0003: Direct input goes through the client's own action dispatch

**Status**: accepted (Slice 3) · **Date**: 2026-06-11

## Context

A bot could act by writing protocol packets directly. But the 274 client's `doAction` does more
than write an opcode: it runs `tryMove` approach logic, maintains anticheat counters
(`oplogic*`, `cyclelogic*` side-channels the server checks), and encodes parameters from menu
state. Hand-rolled packets would drift from that behavior and be trivially fingerprintable.

## Decision

- The DIRECT input driver dispatches through the client's own `doAction`: action id + params are
  written into **scratch minimenu slot 499** (arrays are length 500; the real menu builder never
  reaches it) and `doAction(499)` is invoked. Walking calls the client's `tryMove` (type 0 =
  MOVE_GAMECLICK, nearest-snap on blocked). Result: byte-identical packets, anticheat counters
  and approach behavior exactly as if a human clicked the same menu row.
- Parameter encodings (verified on 274): OPNPC `a=scene index`; OPLOC `a=typecode, b/c=scene-local
  tile`; OPOBJ `a=obj id, b/c=tile`; OPHELD and INV_BUTTON `a=obj id, b=slot, c=component id`;
  dialog continue = PAUSE_BUTTON with `c=BUTTON_CONTINUE child id`.
- Action *names* are resolved against the same op lists the menu uses, including the client's
  synthesized defaults (ground "Take" at op 3, held "Drop" at op 5 when unset).
- Scripts never see any of this: entities expose `interact('Attack')`; the `InputDriver`
  interface is semantic (npc/loc/obj/held/walk/continue) so the Slice 6 SYNTHETIC driver (virtual
  cursor + real menu) can implement the same contract. **No silent fallback between modes** — a
  synthetic failure errors rather than degrading to direct, keeping the detection dataset labels
  clean.

## Consequences

- DIRECT mode produces zero mouse telemetry by design — it is the labeled "machine" class for
  detection research and the future headless path.
- We inherit doAction's quirks deliberately (e.g. it fires anticheat packets on thresholds);
  this is correctness, not a bug.
- The scratch-slot trick depends on menu arrays staying length-500; HOOKS.md notes it.
