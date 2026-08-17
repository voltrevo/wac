# 0147 — a `trap` message is discarded by wacc, and unread by every host that runs a program

- **Status:** closed — wacc emits the message and the V8 host reports it
- **Claimed by:** agent-c
- **Fixed in:** the commit this line arrived in
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer — a diagnostic the program wrote is silently dropped

## Reproduction

```wac
export i32 main() { trap "the ring is full"; }
```

    $ wac run p.wac
    wac: p.wac trapped
    wasm://wasm/000fb57a:61387: Uncaught RuntimeError: unreachable

Expected: the message. Actual: `unreachable`, and no mention that the program said anything.

## Two halves, and the second is the one that matters

**wacc drops it in the emitter.** The statement arm is

```wac
    case Trap: { fb.byte(0); }
```

— matching the variant without binding its payload, so the message expression is never emitted. The AST
has it (`ast.wac`: "`trap;` or `trap <expr>;` — the message the host is told, in place of a bare
unreachable") and the *checker* checks it: `'trap' takes a string message, got i32` is a real
diagnostic. So a program can be refused for getting the message's type wrong and then have the message
thrown away.

**And no host that runs a program reads the reference's either.** The reference does implement it:
`wacEmitFunc.ts` puts the string in a global before the `unreachable` — "the host reads it once the trap
has unwound" — `wasmBuildBin.ts` exports a reader and sets `trapMessages` in the manifest. The only
consumer is `wacBindgen.ts`, which wraps each exported call in `try { … } catch (e) { _wacTrap(e) }`. So
the message reaches a **JavaScript caller through generated bindings** and nothing else:
`packages/platform/host/*`, `native/v8` and `native/` never look at it, and those are what run programs.

So fixing wacc alone buys the compiler's own tests a better failure message — worth having, since
`wacBind` is how much of the suite calls wacc-compiled code — and fixing the hosts is what makes `trap
"…"` mean anything in a program.

## Where it was found

Writing a better failure for `Pending<T>.then` on a ticket that was never linked to a world, which is
the one mistake that API invites: `core.delay` hands back a linked ticket and every other capability
hands back an unlinked one. The trap is left bare with a comment pointing here, rather than carrying a
message that is silently discarded — a message that does not arrive reads as working code to the next
person.

## Notes

The manifest flag exists (`trapMessages`), so a host has a way to know whether to look. Suggested order:
wacc's emitter and manifest first, matching the reference's global-and-reader shape byte for byte, since
`fixpointEmit` and the corpus differentials will hold it to that; then one host, with a test that a
program's message reaches stderr.

## Closed — 2026-08-17

    $ wac run p.wac          # export i32 main() { trap "the ring is full"; }
    wac: p.wac trapped: the ring is full

The reference's shape, kept deliberately: the message goes into a global before the trap — after one
there is no code left to run — and an exported `$trap$message` hands it back once the trap has unwound.
A host that reads one compiler's reads the other's.

**Always emitted, not detected**, which is the decision worth recording. The first attempt set a flag when
the walk saw a message; that walk runs *after* `assignGlobals`, so the flag was false where the numbering
happens and the helper read global `-1` as `4294967295`. `__fmod` settled this argument already, a few
hundred lines up: "deciding which modules use it means a complete expression walk, and an incomplete one
names a function index that does not exist, which is silent and catastrophic". One global, one three-byte
function and one export in every module is the price.

Four mistakes on the way, each caught by something that already existed:

- `sigType` at emission time — *a type this emitter names only while emitting*. The types belong in the
  front end, where the comment on the coverage counter array says so.
- ...but **after** `needsStrings` is decided, or registering `i8[]` makes `hasStringType` true for every
  module and pulls nine string helpers into all of them.
- a section's vector count and its entries are two places that must agree: *section was shorter than
  expected, 35 bytes declared, 34 read*.
- and the globals section was skipped entirely when a module had no constants and no coverage, while the
  global had already been numbered 0 — *Invalid global index: 0*.

The fixpoint check caught the generation lag too: the old seed emits a compiler that lacks the helper, and
*that* compiler emits one which has it, so `X1 != X2` until `seed:bootstrap` crosses the gap. Which is the
sequence `CLAUDE.md` now describes, corrected earlier the same day.

### The hosts

**`native/` reports it too**, and it reads the `i8[]` element by element through wasmtime's GC API rather
than through `$bind$str_to_mem`: everything else on that boundary runs inside a host call and has a
`Caller`, while this runs after `main` has trapped, where there is only the store and the instance.

**The JavaScript hosts report it too, through the glue rather than the host** — which is the part I had
wrong when I called it "one call each". The reason: A wac `string` is a GC array
and opaque to JavaScript, so it has to come back through the module's staging buffer — `$bind$str_len`,
`$bind$mem_ensure`, `$bind$str_to_mem` — and the worker never sees those: it is handed `import * as app`
from the *generated glue*, whose `$exports` is a module-level const the glue does not export. So the fix is
not a host read at all: **the glue emits a `$trapped` guard** around each exported wrapper and rethrows with
the message, and the worker needs no change because `app.main(…)` throws an `Error` that already says it.

In *both* generators, because `bindgenWac.test.ts` holds them to byte-identical output —
`packages/wacc/src/bindgen.wac` and `packages/wacc/tools/waccBindgen.ts`. The app path uses the second,
which is what a first attempt in only the first taught me.

    about to fail
    error: wac trap: the ring is full

**One corner stays**, and it is the program I was testing with: a module whose exports cross no strings has
no staging buffer in its glue — `needsMem` decides that — so `export i32 main() { trap "…"; }` still shows
`unreachable` on the JavaScript hosts. Any program with capabilities crosses strings and is covered. Making
it universal means emitting the buffer for every module and guarding every helper it might not export, which
buys the empty case and risks the loaded one.

I wrote the host read first, and it could not reach the export: the worker is handed the *glue's* exports,
not the wasm's. Reverted rather than left as code that can never fire.

### Found while trying to use it

A program whose `main` declares no capabilities could not run on the JavaScript hosts either: `worldFor`
built a `Core` from the module's exported classes unconditionally, and such a program has no `Core` class
— *Cannot read properties of undefined (reading 'of')*, before `main` ran. The two Rust hosts learnt this
earlier the same day by reading `main`'s parameter list; here the absent class is the same signal. Fixed,
with a case in `tools/runCli.test.ts`, which now covers all three host families.
