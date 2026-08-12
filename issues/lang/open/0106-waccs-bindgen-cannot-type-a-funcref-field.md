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

## Progress: the dispatchers are collected now, and two gaps are left

`collectCallbackSigs` in `packages/wacc/src/emit.wac` walked exported *parameters* only. It now also
walks the fields of every struct that crosses the boundary, read from the field table rather than
from the declarations — a generic instance has no declaration of its own, and `Pending<i64>` is
exactly the case that matters, since walking `prog` finds `Pending<T>` whose field type is `T`.
`Core` gets its eight, and `wc.wac` goes from **0 to 32** callback signatures.

**Only the crossing structs**, which the generated sweep taught: collecting from every struct made a
module import a dispatcher for a funcref it merely held internally, and
`struct H { fn[f64(f64)] cb; }` inside one function started failing to instantiate with
*"Import #0 wac"* on a program that had never needed a host.

What is still missing, found by diffing the two generators on `packages/platform/example/wc.wac`:

1. **No `static of`.** The host does not call bindgen's synthesized `$of` — it calls the *wac* static
   `Core.of(...)`, which is `$bind$sm_Core_of`. The reference's glue exposes it; wacc's does not, so
   `cls.Core.of` is undefined in `packages/platform/host/provider.ts`.
2. **`Pending$i64` has no class at all.** It is reachable only through the *return type of a funcref
   field* (`nowMillis: fn[Pending<i64>()]`), and `collectBindStructs`'s transitive walk does not
   follow funcref types. `provider.ts` calls `cls.Pending$i64.of(...)` and finds nothing.

Both are the same shape as the first: a way for a type to be reachable that the collector does not
follow. `app:build` stays on the reference until they are done — the wiring is a five-line change to
`packages/platform/build.ts` and was reverted twice rather than left half-working.

## Where it stands: 55 of 55 emit, and one program still does not run

**Every program in this repository emits through wacc.** box's `wc`, `grep`, `sha256sum` and `cp`
built by wacc produce output identical to the same programs built by the reference, and `sha256sum`
agrees with GNU's hash of this README.

`WAC_APP_FROM` stays opt-in anyway, because emitting is not running and one program proves it.
Flipping the default turned `tools/frontpage.test.ts` red: `packages/box/example/boxsh.wac` builds,
loads, and then prints nothing for every command. The cause is in the metadata rather than the
module —

| entry | S lines | of them `Pending<T>` |
| --- | --- | --- |
| `packages/box/src/bin/wc.wac` | 49 | 15 |
| `packages/platform/example/wc.wac` | 26 | 15 |
| `packages/box/example/boxsh.wac` | 56 | **0** |

`Pending<T>` is what every capability returns, and the host builds one per call — `cls.Pending$i64.of(…)`
in `packages/platform/host/provider.ts`. With no `S` line for it, wacc's generator writes no class,
and the first capability call is `Cannot read properties of undefined (reading 'of')`. The same
walk finds all 15 for two smaller programs, so this is something boxsh has and they do not, not a
missing feature. **That is the next thing to find, and it is the last thing before the default flips.**

### `packages/box` — fixed, and it was two bugs wearing one message

**Closed.** All seven of box's programs emit now (`sh` is 564,577 bytes, and was 8), and box's `wc`
built by wacc agrees byte for byte with the same program built by the reference.

The visible symptom was *"a call to boxApplet, declined: … a call to formatTime"*, seven levels of
call chain describing none of it. Underneath were two independent defects that produce the same
empty module:

**One — the link dropped import edges without saying so.** `linkFiles` writes its edges into an
array the caller allocates, `i32[4096]`, which holds 2,047 of them; box has 2,236. The overflow was
a `continue`. A dropped edge is not a missing edge: `import { Host } from "./host.wac"` is the only
thing that says which file `Host` means, and without it the name falls through to the permissive
module-wide lookup, finds `Backing.Host` in `packages/fs/src/fs.wac` as well, and calls the name
ambiguous — which declines the *module*. The tables are now 32,767 edges, and an overflow fails the
link and says so rather than continuing, in a message kept distinct from a genuinely missing file.

**Two — a parameter's name was resolved as a global.** `collectArrayTypes` walks a function body
looking for the array types it names, and it ran with no locals loaded. So in

    export i32 pump(fn[bool(u8[])] write) { return write(u8[1]()) ? 1 : 0; }

the call `write(…)` was resolved against the whole module. `packages/fs/src/image.wac` and
`packages/http/src/response.wac` both declare a `write`, so the name was ambiguous and box stopped
compiling — over a name that is a parameter, shadowed at every use. `canEmit` had this right all
along, and `collectArrayTypesIn` now does the same thing: parameters as locals, walk, restore.
`packages/wacc/test/scoping.test.ts` is the four-file case, which emitted 8 bytes before the fix and
returns the reference's answer after it.

**What made this expensive** is worth more than either fix. Both defects were silent by
construction — a `continue` past a full table, a lookup with no locals — and both surfaced as the
same 8 bytes through a third mechanism (the ambiguity flag) that reported a fourth thing (a call
chain). Every capacity limit in the emitter now names its table, and the remaining gap is that
`blockedFiles` still cannot report an emit-time reason at all: it walks declarations instead of
emitting, so `env.ambiguous` is clear on the only path that has the phrasing for it
(`emit.wac:6647`). That is the next thing to fix, and it is what would have made this a
five-minute diagnosis.

### The nullable question, answered without touching the type system

`T` and `T?` are one type to the **emitter** — every reference it writes is the nullable wasm ref, so
this is right for emission — and the **checker** keeps them apart, which five probes and the spec's
304 refusals confirm: `Box<S?> a = …; Box<S> b = a;` is refused by both compilers. So the conflation
was never a soundness hole; it leaked because the *metadata* used the emitter's identity as the
**boundary** identity, and a host does need to tell `maybeBytes` from `bytes`.

Fixed at that layer: an instantiation records the spelling the author used beside the identity it
collapses onto, the wire carries `A <identity> <spelling>` lines, and the glue emits
`export const Pending$u8ArrOpt = Pending$u8Arr` — one class, two names, which is true here. Minting a
second struct with an identical layout would have been the lie.

With the name resolved, the *conversion* had the same assumption: a collapsed class converted its
payload as non-null, so a host answering "absent" produced `null.length`. Every reference conversion
carries a null through now, which is what the wasm type has always allowed.

## Where it stands, and the one thing left

An application built entirely by wacc now **runs and answers correctly** —
`wc README.md` prints `194 1474 9335 README.md` — and then fails on teardown at
`cls.Pending$u8ArrOpt.of`, a class wacc never mints.

That last one is not a collection bug like the others. **wacc erases nullability from a type's
identity**: `typeOfTyName`'s own comment says *"`T?` is `T`… every reference this emitter writes is
the nullable `0x63`, so a type that admits null and one that does not are already the same wasm type
and the difference is the checker's to keep."* True for emission, and it means `Pending<u8[]?>` and
`Pending<u8[]>` are one instance to wacc where the reference has two. The host asks for
`Pending$u8ArrOpt` by name — `packages/platform/host/provider.ts` — and there is nothing to answer.

Fixing it means the instance *identity* carrying `?`, which is the type system rather than bindgen,
and it wants its own issue and a decision: two instances that emit identically but bind separately.

### Four fixes landed on the way, each a different route a type can be reachable by

1. **A funcref field** — `Core`'s eight — now yields a dispatcher. `wc.wac`: 0 signatures to 35.
2. **A funcref's return type** — `Pending<i64>` is named nowhere else in the program.
3. **A method's parameters** — `Pending<i32>.of(id, resolve, settled, drop)` takes three funcrefs,
   and a host calls it to build one.
4. **The callback table was capped at 32** and dropped the rest in silence, which is why two of
   `Pending<i32>`'s three funcrefs crossed as numbers and the third as a function. It declines the
   module now (`env.full`), as the rest of this emitter does.

And one outside the compiler: **`buildApp`'s cache key did not include wacc**, so five rebuilds in a
row served the same artifact and every fix above looked like it had done nothing. The key covers the
reference compiler and the harness; neither changes when `packages/wacc` does.

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
