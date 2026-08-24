# 0252a — a frame's output is capped on the JavaScript hosts and unbounded on the native one

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-24
- **Kind:** decision
- **Symptom:** wrong answer on two hosts, unbounded memory on the other — and one of them is documented

## The divergence

`Captured.truncated` says whether a frame's output is all of what the child wrote. The two answers
are produced by different mechanisms and neither host is doing anything by accident:

| | frame's buffer | at the limit | `truncated` |
|---|---|---|---|
| Deno, Node | capped at 8 MiB | `write` answers false | `true` |
| native (wasmtime, V8) | a `Vec` that grows | there is no limit | always `false` |

Both are written down where they are implemented. `native/src/main.rs` says *"Never truncated here,
and that is a difference rather than a simplification"*, and `packages/platform/test/wac/
conformance_test.wac` records it as the reason `PUSH_CHILD` and `POP_CHILD` are two-host gaps: nothing
compares them, because a comparison would fail.

## Why it is not simply "make them agree"

Each behaviour removes a real failure the other has.

**The cap exists because a short answer looks complete.** `std/platform.wac` spells this out: at the
cap `write` answers false, and from inside the child that is indistinguishable from the reader going
away — which is exactly what `box yes` is written to stop on (`while (cli.write(block)) {}`). So an
applet fills the buffer, exits **cleanly** believing its pipe closed, and hands back a number that is
wrong and looks right. Measured: `boxsh -c 'seq 1 1500000 | wc -c'` printed 8323568 where bash prints
10888896. `truncated` is what lets the caller turn that into a failed command instead.

**And growing without a limit is the other failure.** A frame is held in the *parent's* memory, and the
program deciding how much to produce is not the one holding it. On a box three agents share this is
the machine running out rather than one command answering wrongly — `issues/system/0142` is a page of
what memory pressure here costs, and a runaway `find /` inside a frame has nothing to stop it.

So it is bounded-and-honest against unbounded-and-complete, and the repository currently ships one of
each.

## What is wrong today regardless of the answer

**`std/platform.wac` stated the cap as a property of the language.** *"A frame's output is held in this
program's memory rather than draining anywhere, so it is capped"* — true of two hosts and false of the
other two, in the doc comment a caller reads to decide whether to trust the field. Corrected in the
commit that filed this: the sentence now says which hosts cap, keeps the whole argument for why, and
points here. That part needed no decision.

## Options

- **Cap the native runtime at 8 MiB too.** The hosts agree, `truncated` becomes meaningful everywhere,
  and the memory ceiling applies where it matters most. The cost is real: programs that today get a
  complete answer natively would start getting a short one, and `boxsh -c 'seq 1 1500000 | wc -c'` on
  the native host would go from right to truncated-and-reported.
- **Remove the cap from the JavaScript hosts.** They agree the other way and no answer is ever short.
  The cost is that a frame can exhaust the host, and the mechanism that makes a short answer *look*
  complete would be gone only because nothing is short any more — until the process dies instead.
- **Keep both and say so.** Cheapest, and it is what the code does now. `truncated` is then a
  host-dependent field, a program that must bound memory cannot do it through frames, and the two
  `PUSH_CHILD` gaps in the conformance ledger stay open by design rather than by omission.

**Recommendation: the first.** The cap is already the documented contract, it is the behaviour with a
name in the API — a field that is always `false` on half the hosts is a field that cannot be used — and
unbounded growth is the failure this particular machine is least able to absorb. The regression it
causes is a *reported* one, which is the trade this repository normally takes: `boxRun` turns a
truncated frame into a failed command with a message, and "we could not run this" beats a number that
is not the answer.

Filed rather than done because it changes what a correct program gets back on one host, and because
the number 8 MiB would then be a limit two runtimes share and neither owns.
