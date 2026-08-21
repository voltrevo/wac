# 0239a — a duplicate `else` arm in a match traps the compiler

- **Status:** closed — agent-a, 2026-08-21: the loop asked *whether* there was an `else` rather than how
  many, so a second one reached an emitter that indexed past the end of an array. And walking the rest of
  the table found a second missing rule beside it
- **Fixed in:** `packages/wacc/src/check.wac`, with `packages/wacc/test/wac/matcharms_test.wac`
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** the compiler traps — `array element access out of bounds`, then a null dereference

## Reproduction

Two lines.

```wac
enum E { A, B }
export i32 f(E e) { match (e) { case A: { return 1; } else: { return 2; } else: { return 3; } } }
```

    $ wac check m3.wac
    m3.wac: 1 file(s), no diagnostics

    $ wac build m3.wac -o m3
    wac: packages/wacc/example/wacc.wac trapped
    wasm://wasm/003c4ec6:194528: Uncaught RuntimeError: array element access out of bounds
    wasm://wasm/003c4ec6:540335: Uncaught RuntimeError: dereferencing a null pointer

Delete one `else` and it builds: 2,351 bytes, exit 0. The reference refuses it —
`[typecheck] duplicate else arm` — which is where the rule is written down.

**This is the worst symptom in the tracker.** Not a wrong answer, not a silent acceptance: the compiler
itself faults, and the message names `packages/wacc/example/wacc.wac` rather than the program that
caused it, so the first impression is that the toolchain is broken rather than the input unusual.

## How it was found

Walking the reference's rule tables one program per row — the exercise that produced `issues/lang/0236a`
and `0237a`. `checkMatchArms` has nine rules; wacc enforces eight:

| rule | wacc |
| --- | --- |
| match on a nullable | `match requires a non-null value` |
| match on a non-enum | `match requires an enum value` |
| **duplicate else arm** | **nothing — and the build traps** |
| a case naming a non-variant | `no variant of that name` |
| duplicate case for one variant | `duplicate case for the same variant` |
| else unreachable, all variants covered | `else arm is unreachable — all variants are covered` |
| non-exhaustive match | `match does not cover every variant` |

The two not listed — a duplicate binding in a case, and a binding colliding with the subject — were not
tried and are the obvious next two rows.

## Why nothing caught it

The same reason as every other gap found this way: the corpus is programs that work. Nobody writes two
`else` arms on purpose, the generated sweeps grid types against contexts rather than malformed match
bodies, and `illtyped_test.wac`'s rows are all expression-level. A trap is also invisible to the
mutation sweep, which asks the reference whether a mutant is broken and then asks *us* — a mutation that
produced this would take the harness down with it rather than being counted.

## Where to look

`checkMatchArms` in `packages/wacc/src/check.wac` has the other eight rules; this is a missing ninth,
and the reference's wording is available. **Fixing the checker is necessary but may not be sufficient**:
something downstream indexes past the end of an array when a second `else` exists, and a checker rule
only stops the input reaching it through `wac build`. The in-process `emitFiles` family does not check
first — `issues/lang/0170a` — so a caller there would still trap. Worth finding the out-of-bounds read
as well as refusing the program.

## Fixed, and a second gap in the same cluster

**The trap.** `checkMatchArms` computed `hasElse` with a boolean, so a second `else` was invisible to it:

    bool hasElse = false;
    for (i32 i = 0; i < arms.len(); i++) { if (arms[i].variantTok < 0) { hasElse = true; } }

Counted rather than noticed now, with a code of its own — `errDuplicateCase`'s message names a *variant*
and an `else` is not one, which is how the reference keeps them apart too. `check` reports *"a match has
more than one else arm"* at the subject with a caret, `build` refuses instead of trapping, and one
`else` still builds.

**And `case A(n, n)`, found by finishing the table.** It compiled, and the second binding silently won:
`A(7, 9)` answered **9**. The reference refuses — *"duplicate binding 'n' in case 'A'"*. That is the same
fault the existing collision rule exists to prevent — two meanings on one name for the length of an arm —
with both names coming from the payload instead of one from the subject, so it is checked in the same
function, reported at the later binding, which is the one to rename.

The two loops are separate rather than one, because the subject check returns early when the subject has
no name and this must not: `match (f())` has nothing to collide with and can still bind twice.

### Nine of nine, pinned

`matcharms_test.wac` holds the whole table — the nine breaking programs, three ordinary matches as
controls, and the two-`else` case asserted as an exact count rather than a refusal, because a fix that
reported *and* still reached the emitter would satisfy "is it refused". Canaried by disabling each rule:
the two rows fail and the controls keep passing.

A cluster where two of nine rules were missing is one where the next omission is likelier than average,
which is the argument for pinning all nine rather than the two that were broken.

### What this says about the method

Neither gap was reachable by any differential here. The corpus is programs that work; nobody writes two
`else` arms on purpose; and a **trap** is invisible to the mutation sweep by construction — a mutant that
produced it would take the harness down rather than be counted. Both were found by reading the
reference's rule table and asking each row of wacc in turn, which is now four bugs from that one
exercise: `issues/lang/0236a`, `0237a`, `0238a`'s two shapes, and these.

### The fix false-alarmed, and four corpora said so

The duplicate-binding rule shipped counting `_` as a name, so `case Ok(_, _, _, _, _, _)` read as one
name six times. Nineteen places in working code — `packages/http`'s fuzz, oracle and response tests,
`nodeoracle.wac`, `responseoracle.wac` and `packages/json`'s tree test — and the gate went red before the
push. Four separate instruments named it in the same run: `corpuscheck_test.wac`'s
`test_rung_3_the_repositorys_own_code_checked_no_false_alarm`, `typecheck_test.wac`'s
`test_rung3_the_whole_repo_stays_silent`, and the spec corpus, which has a rule for it —
`§enum-match-ignore`, *"`_` discards a payload and may repeat"*. **The spec said so and the reference says
so** (`wacTypeCheck.ts:1584`, `if (name === "_") continue;   // a deliberate discard, and may repeat`);
this read neither before writing the loop.

The repair merged the two loops so the skip covers the subject check as well, which also reproduces the
reference's precedence: a binding that collides with the subject is not also reported as a duplicate.
Two controls added — two discards, and a discard beside a name — and the skip canaried by disabling it.

**The count test cannot see the `break`.** `A(n, n, n)` is two diagnostics with it and two without, because
the two reports it saves land at one position with one code and `report` collapses a repeat of the
diagnostic immediately before it. Measured by removing the `break` and watching the count hold, which is
worth recording as the reason the comment beside it no longer claims to be load-bearing.

**And it aged a test of its own.** `collide0234_test.wac`'s entry program asked the library for exactly
two diagnostics on `export i32 f(string s) { return s - 1; }` — the program `0238a` had made report once,
landed hours earlier in the same session. A linker test, red because of a checker fix. Its oracle is now
two-sided and countless: some diagnostics for a broken program, none for a clean one.
