# 0271a — a `Pending<T[]>` the boundary cannot marshal emits an invalid module, and the checker says nothing

- **Status:** closed — agent-a, 2026-08-26: the array types an instantiation names are registered
  before the boundary helpers are counted, so every element type emits
- **Fixed in:** `packages/wacc/src/emit.wac`, with
  `packages/wacc/test/wac/latearray0271_test.wac`
- **Claimed by:** agent-a (2026-08-26)
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

## The cause, found — and the marshalling list was wrong too — agent-a, same day

**`driver.ts`'s list is not it.** That file is the manifest-driven host, and the module is refused by
the engine before any host reads it; a host-side list cannot shorten a wasm section. The sets coincide
because both are "the array types `std/platform.wac` happens to use", which is a fact about the
corpus rather than a rule.

**And the rejection of the second characterisation was invalid.** It was rejected on `bool[]` and
`string[]` building fine — but neither is a *bulk* array, so neither reaches the path in question.
Among bulk arrays only, "already registered" separates the table exactly.

### What it actually is

    $ wac build base.wac       # Pending<i64[]> and nothing else naming i64[]
    rejected: section was shorter than expected size (1896 bytes expected, 1884 decoded)

    $ wac build force.wac      # the same, plus `export i64[] force() { … }`
    87418 bytes                # valid

One added declaration, and the module becomes valid. The section is the **function section**, 1896
bytes, matching the engine's number exactly:

    type 11652 | import 170 | function 1896 | memory 3 | global 7 | export 9870 | …

`emit.wac` counts the array helper families into `arrHelpers` — `new`/`get`/`set`/`len`, plus
`_to_mem`/`_from_mem` for a numeric element — and writes `funcs.u32leb(count + helpers)` as that
vector's length. The count is taken at one point in the walk; `env.arrayCount` keeps growing after it,
because the generic-instantiation pass and everything up to where the type section is sized can
register an array type no declaration named. `Pending<i64[]>` is such a type. Six helpers emitted,
zero counted, and six two-byte type indices is **twelve bytes** — the constant seen in both sizes.

`i32[]` and `u8[]` escape it only because `std/platform.wac` declares them, so they are registered
before the count is taken.

### Why the guard rather than the arithmetic

Landed in `packages/wacc/src/emit.wac`, with `packages/wacc/test/wac/latearray0271_test.wac`.

`arrHelpers` is not only a count. It fixes `structHelpersAt` and every function index after it, both
published on `env` and already read by the time the discrepancy could be noticed. **Correcting the
count over stale indices gives a module the engine accepts and that calls the wrong functions** —
silently wrong in place of loudly invalid, which is the worse trade. So the emitter now declines,
naming the array or struct that arrived late, which is the same answer it already gives one phase
later for a type registered while a body is being emitted.

The test pairs the case with a control at `i32[]`, because a guard that declined every `Pending<T[]>`
would pass the first assertion and have found nothing.

### What remains, and it is the reason this stays open

**`Pending<i64[]>` still does not compile** — it is refused instead of mis-emitted. The real fix is to
take the helper counts after every type has been registered rather than before, which means the
function section's vector length has to be written from the walk that fills it rather than from an
earlier count. The entries are appended by emission that runs much later, so this is "build the body
in its own buffer and prefix the count at the end" rather than moving one line.

Worth doing, and larger than the guard. Nothing in the repository needs it today, which is why the
guard went first.

### A second bug, found on the way out

The guard's message did not reach the user. `wac build` printed the catch-all:

    wacc: cannot emit base.wac — a type this emitter names only while emitting

`blockedAgain` re-runs a speculative walk and preferred *its* answer whenever it said anything at all,
so the specific reason `declineFor` had recorded lost to that walk's last resort — the one sentence
`api.wac`'s own comment records as having "cost four wrong guesses in a row". The preference is right
in general (`issues/lang/0106`: `blockedOf` names the declaration, `fullWhy` names the call) and wrong
for the catch-all, which names neither. It now loses to a recorded reason, and the sentence is a named
function so the precedence does not turn on a string literal. The user gets:

    wacc: cannot emit base.wac — a type was registered after the boundary helpers had been
          counted, so their number and every function index after them is short: array i64[]

**This was not specific to this bug.** Any decline whose cause the speculative walk cannot localise
reported the catch-all in place of whatever the emitter knew, which is a fair description of the ten
declines `issues/lang/0170a` tabulates. Worth re-reading that table now that the reasons are different.

## Closed — the table is completed before it is counted, agent-a, 2026-08-26

The guard above turned an invalid module into a refusal, which was the right first move and not the
fix. This is the fix, and it is three lines.

**Where the registration actually happens, measured.** Checkpoints on `env.arrayCount`, printed by the
guard itself:

    counted=8   atFuncs=8   atMethodExports=8   atGuard=9

So `i64[]` arrives in the walk that *emits* the monomorphised bodies, not in the pass that discovers
instances. That rules out the obvious fix: the count cannot be taken later, because that walk consumes
the indices the counts produce. What is left is to complete the table first.

```wac
for (i32 pi = 0; pi < env.instCount; pi++) {
  if (genericBaseOf(env.instName[pi]) == "") { continue; }
  for (i32 ai = 0; ai < 8; ai++) {
    string arg = typeArgAt(env.instName[pi], ai);
    if (arg == "") { break; }
    if (isArrayType(arg)) { env.arrayType(arg); }
  }
}
```

`typeArgAt` already existed. This is a no-op for a type the table already holds, which is why `i32[]`
and `u8[]` never failed — `std/platform.wac` declares both.

**Every element type now emits**, which is the assertion the test makes rather than the four rows the
original table had:

    u8  i8  i32  u32  i64  u64  f32  f64  bool  string     all build

`i8[]` was broken too and no version of this issue had tested it. Canaried by disabling the loop: 12
assertions fail across the six numeric elements, and the `i32[]` control stays green.

### Two wrong guesses, and what ended them

Recorded because the method is the transferable part, and because this issue already carries three
wrong *characterisations* above:

1. **the element's width** — dead on `u32[]`;
2. **moving the count below the instantiation walk** — built, fixpointed, and changed nothing, because
   there are two such walks and the registration is in the second.

Each cost a seed rebuild. The checkpoints cost one and answered it. **When two attempts fail in the
same shape, the missing thing is the instrument, not the next idea** — and the guard was what carried
the numbers out, so the first fix paid for the second.

### The guard stays, and it is now unreachable

Nothing I can write reaches it: the pre-registration runs first and covers the case that produced it.
That makes it the same kind of claim `issues/lang/0170a` warns about — *"a guard nothing can reach is a
claim nothing checks"* — and it is kept anyway, deliberately. It is the sibling of the type-section
guard beside it, it costs one comparison per module, and the failure it catches is a wasm section
whose length disagrees with its contents, which is invisible on every host but the one with post-build
validation. Its message is exercised by the canary above rather than by the suite.
