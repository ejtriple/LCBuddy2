# ADR-0005: Events are produced by frame diffing, not packet decoding

**Status**: accepted (Slice 4) · **Date**: 2026-06-11

## Context

Scripts want events (`skill.xp`, `inventory.changed`, `chat.message`, ...). Two candidate
sources: decode server packets in the H4 hook, or diff client state between frames. Packet
decoding duplicates the client's protocol handling (the exact sprawl ADR-0001 exists to prevent)
and breaks on every protocol change; state diffing reads the same adapter fields everything else
uses.

## Decision

Producers run once per frame from `BotHost.onFrame()`, *before* the scheduler pump, comparing
cheap snapshots against the previous frame: stats (xp/levels), inventory slots, first ~300
varps, the chat ring head, and the tick counter. Diffs emit through a typed `EventBus`. Scripts
subscribe via `AbstractBot.on(...)`, auto-unsubscribed at teardown; callbacks run inside the
frame firewall.

The lone packet-derived signal stays the tick counter (PLAYER_INFO via H4), because ticks have
no state representation to diff.

## Consequences

- Events arrive with at-most-one-frame latency (~20ms) — indistinguishable from packet timing for
  bot purposes, since scripts only wake between frames anyway (ADR-0002).
- Sub-frame churn collapses (a slot changing twice in one frame emits once) and identical
  adjacent chat lines within one frame can collapse — accepted for v1, noted in the producer.
- Producer cost is a few hundred comparisons per frame — unmeasurable against the renderer.
