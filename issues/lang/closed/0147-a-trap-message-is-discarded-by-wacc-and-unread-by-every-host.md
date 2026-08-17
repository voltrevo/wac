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

What is left is the other hosts: `native/` (wasmtime) and `packages/platform/host/*` still print nothing.
The manifest flag the reference sets is not needed for this — a host can simply ask whether the export is
there — so the remaining work is one function call per host.
