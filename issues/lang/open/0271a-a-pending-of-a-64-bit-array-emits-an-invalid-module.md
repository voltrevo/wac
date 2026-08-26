# 0271a — a `Pending<T[]>` the boundary cannot marshal emits an invalid module, and the checker says nothing

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-26
- **Kind:** bug
- **Symptom:** invalid wasm — accepted by the checker, written by the emitter, refused by the engine

## Reproduction

Three lines:

```wac
import { Pending } from "std/platform.wac";
export struct C { fn[Pending<i64[]>(string)] f0; }
export i32 main(C c) { return 0; }
```

    $ wac check m.wac
    m.wac: 3 file(s), no diagnostics

    $ wac build m.wac -o m --allow-read
    m.wasm: 86951 bytes from 3 file(s)
    rejected m.wasm
    wac: the build wrote m.wasm and the engine will not load it, so the compiler emitted
         something invalid rather than refusing the program

    $ deno run -A packages/platform/native.ts m.wac -o n --allow-read
    WebAssembly.Module(): section was shorter than expected size (1896 bytes expected, 1884 decoded)

**Twelve bytes short**, and the same twelve in a larger program — `packages/platform/size/cap20.wac`
gave `3454 expected, 3442 decoded`. A section length written that does not match what follows it.

## What triggers it, narrowed

The 64-bit element is the whole of it. Parameters are irrelevant.

| signature | result |
| --- | --- |
| `fn[Pending<i64[]>(string)]` | **invalid module** |
| `fn[Pending<i64[]>()]` | **invalid module** |
| `fn[Pending<i64[]>(i32)]` | **invalid module** |
| `fn[Pending<u64[]>(string)]` | **invalid module** |
| `fn[Pending<f64[]>(string)]` | **invalid module** |
| `fn[Pending<i32[]>(string)]` | ok |

And it is the *combination* with `Pending`, not 64-bit arrays at the boundary in general:

| | result |
| --- | --- |
| `fn[i64[](string)]` — a funcref field, no `Pending` | ok |
| `export i64[] main()` — returned directly | ok |
| `fn[Pending<i64>()]` — `Pending` of a 64-bit *scalar* | ok |
| `fn[Pending<i64[]>(…)]` | **invalid module** |

So: a `Pending<T>` monomorphised at an array of a 64-bit element, reached through a capability
struct's funcref field.

## Why nothing caught it

**The reference cannot compile the program**, so no differential exists for this shape:

    error: `std/platform.wac` is a built-in this compiler does not carry: it uses lambdas,
    which this compiler's frontend does not have

That is documented in `compiler/README.md` and is not a defect. It does mean the whole
`Pending`-at-the-boundary surface is wacc's alone, and rung 3 has no opinion about it.

**What did catch it is `native/v8/src/main.rs`'s post-build validation** — the check
`issues/lang/0170a` asked for, which runs the engine over what `build` wrote and refuses to exit 0 on a
module it will not load. Without that, `wac build` reports 86,951 bytes and success. Worth recording
as the guard earning its place: this is exactly the case its comment describes, *"the function present
and the types not agreeing … with the build printing a size and exiting 0 over a file the engine
refuses"*.

## Where to look

The failure is a section whose declared length exceeds what was written, by twelve bytes, in both
sizes measured. That points at a length prefix computed from one set of entries and emitted over
another — most likely in the bind/boundary emission where a `Pending<T>` monomorphisation is written
for a capability field, since removing `Pending` or narrowing the element to 32 bits both make it go
away.

## How it was found

Fixing `packages/platform/size/cap20.wac`, which was `cap10` duplicated — `issues/system/0147`. Ten
new distinct signatures were needed and one of them was `fn[Pending<i64[]>(string)]`. So a broken
measurement fixture was hiding a compiler bug: the shapes it should have contained and did not include
one the compiler cannot emit.

## Corrected: it is not width, it is the boundary's marshalling list — agent-a, same day

The narrowing above says "64-bit element". Wrong — `Pending<u32[]>` fails too, and `u32` is 32 bits.
Every element type, measured:

| element | result |
| --- | --- |
| `u8[]`, `i32[]`, `bool[]`, `string[]` | ok |
| `u32[]`, `i64[]`, `u64[]`, `f32[]`, `f64[]` | **invalid module** |

The set that works is not about width and not about whether `std/platform.wac` already instantiates it
— `i32[]`, `bool[]` and `string[]` appear zero times there and build fine. It is the boundary's own
supported list, written down in `packages/platform/host/driver.ts:16`:

> what needs conversion is: the scalars, `string`, `u8[]`, `string[]`, `i32[]`, and `u8[][]`.

**Those are exactly the array shapes that build.** So the rule is: an array element the host boundary
has no marshalling for produces an invalid module instead of a diagnostic. The supported set is
documented, in the file that implements it, and the emitter does not consult it.

That makes the fix clearer than the original framing did. It is not arithmetic in a length prefix — or
not only that. It is a missing refusal: `bindgenDeclined` already exists for shapes the boundary cannot
bind, and this is a shape the boundary cannot bind that does not reach it.

**Third characterisation of this bug in one sitting** — "64-bit", then "not already instantiated", then
the marshalling list. Each was a pattern fitted to four or five data points; the one that held came
from testing all nine element types and finding a list already written down. Worth recording as the
method rather than the conclusion: the answer was in a comment in the file that does the work.
