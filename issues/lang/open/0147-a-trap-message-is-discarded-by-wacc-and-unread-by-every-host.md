# 0147 — a `trap` message is discarded by wacc, and unread by every host that runs a program

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
