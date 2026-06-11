# ADR-0004: The bot bundle never mangles property names

**Status**: accepted (Slice 1) · **Date**: 2026-06-11

## Context

The stock production build (`bundle.ts`) runs terser with property mangling: every property name
is renamed consistently within the bundle, so in-bundle dot access works but any *string-keyed*
access and any *externally compiled* code breaks. Slice 7 ships externally-compiled player
scripts that bind to a `globalThis.__lcbuddy` API object — its property names are the ABI.

## Decision

`bot.bundle.ts` builds with Bun's minifier only (shortens locals, **never property names**) and
keeps `console`. The stock client build for `/rs2.cgi` is untouched. Direct consequences relied
on elsewhere:

- the adapter self-test can check internals by string name (ADR-0001);
- DevTools gets a usable `lcbuddy` debug global;
- external scripts compiled against `@lcbuddy/api` (Slice 7) will bind by stable names.

## Consequences

- The bot bundle is ~40% larger than the stock one (485KB vs 350KB) and easier to reverse —
  irrelevant for a tool whose source is public.
- The plan's mangle-regression risk inverts: it's the *stock* prod build that catches accidental
  string-keyed internal access, so both bundles are built on every deploy
  (`tools/deploy-local.sh`).
