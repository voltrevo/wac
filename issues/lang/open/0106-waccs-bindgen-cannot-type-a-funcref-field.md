# 0106 — wacc's bindgen types a funcref *field* as a number, so no program can be built with it

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-12
- **Kind:** bug
- **Symptom:** wrong answer

`packages/platform/build.ts` cannot use wacc yet, and this is the whole of why.

`Core` is a struct whose fields are funcrefs — `nowMillis`, `log`, `waitAny` and the rest are
functions the host supplies. wacc's generated glue declares its constructor as:

```ts
static $of(nowMillis: number, monotonicNanos: number, sleepMillis: number, randomBytes: number,
           log: number, warn: number, waitAny: number, askInterrupt: number): Core
```

Every one of those is a **function**, typed as a number. The host passes functions, and the boundary
answers `type incompatibility when transforming from/to JS` — a message that names neither the field
nor the type, which is why this took a diff of the two generators to find rather than a stack trace.

## Why the package sweep missed it

`WAC_BIND_FROM=wacc` binds all 34 packages and 1,663 tests pass. A package exports ordinary
functions; only a **program** takes `main(Core, Cli)`, and nothing in that sweep builds a program.
The gap is not in what was measured — it is that building an application is a different shape from
binding a library, and only one of the two was ever run through wacc.

## The fix

`tsType`, `toWasm` and `fromWasm` in `packages/wacc/tools/waccBindgen.ts` handle a funcref in
*parameter* position (a callback going in) and in *return* position (a wac function coming out).
A funcref as a **struct field** is neither, and falls through to the numeric default. It wants the
same treatment as a parameter: the type is a function, and the value crosses through `$fnref<N>`,
which the module already exports.

Same family as `0102`'s eight defects — a type shape the generator does not cover — and the same
lesson: the sweep that gave confidence measured one shape of use.

## Why it matters

Until this is fixed, `deno task app:build` compiles applications with the **reference**, so the day a
package uses a feature only wacc has, that application cannot be built at all. It is the last thing
between the plan in `design/lang/0003` and the toolchain being wacc's throughout —
`issues/lang/0105` has the rest of the callers.
