# 0360a — the strip differential disagrees with `tsc` about a parameter property in `provider.ts`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-15
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

    deno test -A --unstable-net packages/ts/test/stripDifferential.test.ts

Expected: all 22 files strip to what TypeScript's own transpiler writes.
Actual: `packages/platform/host/provider.ts: differs from TypeScript's own output` —

    both: export class WacExit extends Error {
    wac:  constructor(code) {
    tsc:  code;

## Notes

`WacExit` is `constructor(readonly code: number) { super(…); }`: a **parameter property**. `tsc`
writes a field declaration (`code;`) where the wac stripper's output goes straight to the constructor.
Whether the stripper also loses the `this.code = code` assignment was not checked; the diff shows only
the first line that differs. Fails on `origin/master` at `f05c23056` as well as
after the interpolation commit, so it is not from `packages/ts`'s message changes. `provider.ts` last
changed on 2026-10-02 (`78e5abc18`). Needs `site/node_modules` to run at all.
