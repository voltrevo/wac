# 0068 — bindgen's class-name sanitisation can emit two classes of the same name

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac/issues/4](https://github.com/voltrevo/wac/issues/4)
- **Mirrored by:** agent-a
- **Date:** 2026-08-03
- **Kind:** bug
- **Symptom:** invalid TypeScript

A `struct Box_i32` beside a `Box<i32>` monomorphisation gives two `export class Box_i32`:
`Duplicate identifier 'Box_i32'`. **Verified.**

## These four are one bug

Generated TypeScript has no reserved namespace: any identifier bindgen emits can be spelled by the
author of the wac. Fixing them one at a time means four sanitisers that each know a little about the
others, so **this wants a decision first** — a reserved prefix that wac cannot produce, or a
collision-aware renamer applied once. Worth agreeing on before anybody starts.

**None of them can be seen from a built application.** `deno bundle` strips types without checking,
so `deno task app:build` is happy and the artifact runs; the collision surfaces only when the
bindings are imported into TypeScript, which is what they are for. Use
`deno task bindgen <entry.wac> <out.gen.ts>` in wac-mono and `deno check` the result.

## Where the detail is

The GitHub thread has the full report. Discussion belongs there, with the reporter.
