# 0170a — wacc swallows what it cannot check instead of refusing it, and the function disappears

- **Status:** open
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** decision — it was a bug, and the bug is fixed; see the 2026-08-21 section at the end
- **Symptom:** none — all four reproductions are refused, verified through the binary on 2026-08-21
  by agent-c as well as agent-a: `s[0] - 1`, `i32 n = s[0]`, `b ? s : 1` and `p.v()` each name what
  is wrong with them. What is left is two choices, not a defect.

## The principle this is measured against

Operator, 2026-08-20:

> Failing something that the reference accepted was treated too harshly — somehow it was considered
> better to swallow errors because sometimes that meant succeeding more often. This is backwards. **It
> is better for the compiler to fail something correct than to accept something incorrect.** In every
> case where it hits a case that isn't implemented, it must fail, not be silent.

## Measured

Fourteen ill-typed one-liners, both compilers. The reference refuses **all fourteen**. wacc refuses
ten. In every one of the four it does not refuse, `wac build` **exits 0** and the exported function is
**absent from the module**.

| | program | reference | wacc `check` | `f` in module |
|---|---|---|---|---|
| a01 | `return s - 1;` | error | error | — |
| **a02** | `return s[0] - 1;` | error | **clean** | **absent** |
| **a03** | `i32 n = s[0];` | error | **clean** | **absent** |
| **a04** | `return b ? s : 1;` | error | **clean** | **absent** |
| a05 | `return p + 1;` (struct) | error | error | — |
| a06 | `return s < 1 ? 1 : 0;` | error | error | — |
| a07 | `return a(1);` (i32 called) | error | error | — |
| **a08** | `return p.v();` (field as method) | error | **clean** | **absent** |
| a09 | `return a[0];` (i32 indexed) | error | error | — |
| a10 | `return -s;` | error | error | — |
| a11 | `return a.nope;` | error | error | — |
| a12 | `g(1, 2)` for `g(i32)` | error | error | — |
| a13 | `return b + 1;` (bool) | error | error | — |
| a14 | `return s;` from `i32` | error | error | — |

a02 is `issues/lang/0159` and a08 is `issues/lang/0165`. a03 and a04 were not filed.

## Root causes, each pinned by a narrower case

**1. `typeOfE` has no case for indexing a `string`, and answers `""`.** The rules exist and fire on a
direct operand; they cannot fire on an indexed one, because nothing knows its type:

```
i32 n = s;      →  wacc: error: initialiser does not match …     ← the rule exists
i32 n = s[0];   →  wacc: 1 file(s), no diagnostics               ← the rule cannot see the type
```

That single gap silences at least two separate rules (the operator's operand check and the
initialiser check). `u8[]` indexing and `string c = s[0];` are both correct and stay correct.

**2. `typeOfE(Binary)` guesses.** It returns whichever operand has a type, with no check that the
operator accepts it or that the two agree:

```wac
string lt = typeOfE(src, lexed, env, left);
if (lt != "") { return lt; }
string rt = typeOfE(src, lexed, env, right);
if (rt != "") { return rt; }
```

So `string - i32` types as `string`. This is worse than answering `""`: **the safety net downstream
asks "do I know the type?" and gets a confident wrong answer**, so it cannot fire —

```wac
if (typeOfE(src, lexed, env, e) == "") { return "untyped " + kindOfExpr(e); }   // unsupportedValue
```

**3. `typeOfE(Ternary)` guesses the same way** — first branch that has a type, no agreement check.
That is a04 on its own.

**4. `""` is an ordinary value meaning "I don't know".** 53 `typeOfE` call sites in `emit.wac`, of
which 15 guard the empty answer. The other 38 take "unknown" as a type and carry on.

## The failure mode is the same in all four, and the machinery to report it exists

The emitter *does* detect these. It declines the function and the decline **cascades to callers**,
which is the documented fixed point in `settleEmittable`:

```wac
i32 helper(string s) { return s[0] - 1; }        // declined
export i32 caller(string s) { return helper(s); } // declined, because it calls one
export i32 fine(i32 a) { return a + 1; }          // survives
```

    $ wac build c1.wac -o c1     c1.wasm: 4324 bytes from 1 file(s)   (exit 0)
    module exports: fine

So the information is present at the moment the function is dropped. `emit.wac` has
`declinedExport` — *"an exported function the settling declined, named"* — and `wacc.wac` prints
`blocked` and exits 1 when it is non-empty. **Neither fired for any of the four.** Whatever the
settling used to remove them did not leave a reason where `declinedExport` looks.

Two guards already exist for neighbouring holes — the decline channel, and `wasm.len() <= 8` for a
module that is only a header (`issues/lang/0155`). Each was built for one instance.

## What to do, in the order that pays

1. **A declared export missing from the module is an error.** One check at the end of a build,
   naming the function. It does not fix any type rule, but no instance of this class — including the
   ones nobody has found — can be silent again. Swept all 206 `spec/cases/*.wac` with exactly this
   check: **0 instances**, canaried against a known-bad file, so it lands with no cleanup backlog.
2. **`typeOfE` must not guess.** A binary operator whose operands disagree, or whose operand type the
   operator does not accept, is an error at that expression. Same for a ternary whose branches
   disagree. Returning one operand's type is the mechanism that defeats every downstream guard.
3. **Give `""` a meaning callers cannot ignore**, or stop using it: 38 unguarded call sites is the
   measure of how far "I don't know" travels as if it were an answer.
4. **Add the missing cases and rules**: indexing a `string` in `typeOfE`; a field called as a method
   (`0165`).

## Why the differential did not catch it

The reference refuses all fourteen and wacc refuses ten, which is exactly the disagreement the corpus
differential looks for. It never saw them: the corpus is this repository's own files and
`spec/cases/*.wac`, and none of them contains an ill-typed program — they are all *meant* to compile.
So the harness is fine and the corpus has no negative half for the type checker.

Fourteen files like the ones above, with the expected refusal recorded, would have caught all four and
would catch the next one. That is cheap and is probably the highest-yield single addition here.

## Attempted 2026-08-20: tightening `typeOfE` first, and why that is the wrong order

Tried the direct thing — make `typeOfE(Binary)` answer `""` instead of guessing. It **collapsed
self-hosting**, and the way it collapsed is the argument for doing the reporting first.

The rule was calibrated against the reference in four rounds, each round finding a legitimate case
the previous one refused:

| round | refused something legal | what the reference says |
|---|---|---|
| 1 | `"a" + "b"` | `+` is concatenation when both sides are `string` |
| 2 | `bytes[i] - 48` | a packed type is arithmetic; `isNumericTy` excludes `u8`/`i16`/… |
| 3 | `n + bytes[i]` | see below — round 3's conclusion was **wrong** |
| 4 | still collapsed | unknown — and this is the point |

After round 4 the reference-built compiler was a 933 KB module exporting **nothing but `$bind$*`** —
every `check`, `build`, `compile` gone — and `packages/platform/native.ts` printed a size and exited
0. The same defect this issue is about, at maximum scale, hiding the diagnosis of its own cause.

There is no way to find round 4 from here. The compiler that would tell you which expression it
declined is the compiler that no longer builds. Reverted; the seed is a fixed point again.

**So the order is: make declines reportable, then tighten.** With a working report each tightening
round names the expression it refused, and calibration is minutes rather than a rebuild per guess.

## A second finding, from looking for why nothing was reported

`declinedExport` reads `env.funcOk[at]` where `at` counts **only top-level `Func` declarations** —
but `funcOk` slots are handed out by `addFunc` to methods as well, interleaved in declaration order
(the `StructDecl` and `EnumDecl` arms of the same walk both call it per method). So a struct or enum
with methods declared before a function misaligns the index, and every function after it is checked
against the wrong slot.

Both walks skip generics consistently, so that half is fine — checked, because it looked wrong first.

This is not what silenced the cases in the table above: those have no struct, so `at` is 0 and aligned,
and `declinedExport` still said nothing — meaning `funcOk` was **true** for a function that did not
reach the module. That is a third thing to find, and it is the one the report has to expose.

## Corrections to the attempt above, and what is actually established

Two explanations offered here were wrong. Both are left named rather than deleted, because the
pattern in them is the same one this issue is about — accommodating a wrong answer instead of asking
where it came from.

**Round 3 was wrong.** It concluded "`i32` and `u8` agree, so agreement is by *widened* type" and
added a `widenedTy` helper. There is no `u8` value in wac: `spec/spec/types.md` says *array element
only — no locals, params, or struct fields*, and both compilers refuse `u8 x = 1;`. So `n + b[0]` is
plain `i32 + i32` and no widening rule is needed.

**The "phantom type" explanation that replaced it was also wrong.** It claimed `typeOfE` answers
`"u8"` for `b[0]`. It does not — the `Index` arm already handles this, with a comment saying exactly
why:

```wac
// A packed element is an `i32` where it is used — the getter zero- or sign-extends it — which
// is the checker's rule about packed types arrived at from the emitter's side.
if (e == "u8" || e == "i8" || e == "u16" || e == "i16") { return "i32"; }
```

**And rounds 2 and 3 were never verified.** The seed failed identically before and after each, so
adding packed types to `arithmeticTy` and then `widenedTy` may both have been no-ops. What is
established about the attempt is only that the rule broke self-hosting and that the collapse hid its
own cause; the four-round table above is a record of guessing, not of diagnosis.

### What *is* established, on its own evidence

`u8`/`u16` do exist as element types and are load-bearing: `bulkGet` picks `array.get_u` (13) for
them against `array.get_s` (12) for `i8`/`i16`, and `bulkValType` is documented as *"the wasm value
type an element arrives as, which is not the element's own for a packed one"*. That distinction is
already made and already named.

And this is real, proved by the engine rather than by a story about it:

```wac
export i64 f(u8[] b) { i64 x = b[0]; return x; }
```

    reference:  typecheck: type mismatch: expected i64, …
    wacc:       1 file(s), no diagnostics — wac build exits 0
    engine:     CompileError: local.set[0] expected type i64, found array.get_u of type i32

`wac build` writes an artefact the engine refuses and reports success — a *worse* outcome than the
dropped functions in the table above, which at least produced a loadable module. `export i64 f(u8[]
b) { return b[0]; }` is the same, and there the reference names the real type: *return: expected i64,
found i32*.

**Why the initialiser check does not fire is not yet known.** `typeOfE` answers `i32`, the slot is
`i64`, and the rule that catches `i32 n = s;` exists — so something on the packed path bypasses it.
That is the next thing to find, and it should be found before any rule is tightened.

## 2026-08-20, later: all four are refused by the checker

The table at the top now reads the same for both compilers:

    a02  return s[0] - 1;    error: this operator does not take an operand of that kind
    a03  i32 n = s[0];       error: initialiser does not match the declared type
    a04  return b ? s : 1;   error: the two branches of a ternary have unrelated types
    a08  return p.v();       error: this is not something that can be called
                                    (P.v is a field of type i32, not a method)

**Every one was a rule that already existed and could not see its input.** Not one needed a new
check:

- `typeOfExpr`'s `Index` arm answered unknown for anything not an *array*, so `s[0]` had no type —
  a02, a03. `issues/lang/0159`.
- The field-called-as-a-method arm returned early for a field whose type is not a funcref, because
  both its guards were `heldArity >= 0` — a08. `issues/lang/0165`.
- The ternary-branches rule was skipped whenever *either* branch was a literal, on the grounds that a
  literal takes the other's type. True when it can; `1` cannot be a `string` — a04. The typing walk
  immediately above already asked `literalFits` for the same pair, so the two disagreed with each
  other.

That is the shape of this issue, and it is worth stating plainly because it is not what the title
suggests: **wacc's rules were mostly there.** What was missing was the type information they needed,
and each gap silenced several rules at once. Adding rules would have been the wrong instinct.

### Nets, kept

The two that came out of the failed first attempt stay, because they answer a different question —
*whatever the reason, is the artefact what you asked for*:

- an export the source declared and the module lacks fails the build, naming the function;
- `wac build` validates the module it wrote.

Both caught cases the checker did not, and `0154`'s symptom is now caught by the second.

### Corpus

`spec/cases/0205`–`0208`, in the corpus both compilers read: **210 of 210 met by wacc**, and the
reference's harness passes. Checked for false refusals across 23 packages after each rule.

## The "38 unguarded call sites" figure was wrong, and the real shape is better

I wrote that `""` travels as an answer across 53 `typeOfE` call sites of which 15 guard it, and
offered 38 as the measure of the problem. That counted an *idiom* — an immediate `== ""` — not holes.
Sampling four of the 38:

| site | what it does with an empty answer |
|---|---|
| the `switch` walk | passes it as the expected slot, where empty legitimately means "no slot" |
| the cast walk | handles it deliberately, with a comment: a literal has no type and takes the slot's |
| the index walk | compares it against `"string"`; empty simply is not, and falls through |
| the member walk | `if (!env.isStructName(ot2)) { return; }` — **a silent bail** |

So one of four. Anyone hunting 38 sites would have found mostly deliberate handling, and that is a
bad way to spend a day.

### The measurement that does mean something

The emitter has 40 bare `if (…) { return; }` returns and the whole file contains **6** `declineFor`
calls — but 40 is not the number either, and I have now over-counted twice, so here it is broken down:

| | |
|---:|---|
| 6 | **dedupe / idempotence guards** — "already recorded, do nothing". Correct early returns. |
| 25 | **a failed lookup** — `if (at < 0) { return; }`, a name or index the emitter could not find. |
| 9 | neither; each wants reading on its own. |

So the number worth acting on is nearer **25 than 40**, and three of those 25 are guarded on
`env.funcIndex[at] < 0` — a *callee* that was declined — which is the cascade working as designed and
should be declining the caller through `unsupportedExpr` instead.

None of them records a reason.

Those bails are not meant to be reachable: `canEmit`/`unsupportedIn` decides emittability *before*
emitting, so anything that got as far as the emitter should be emittable. They are defence in depth —
which means every one of them is a place where **the gate and the doer disagreeing turns into
silence**, and that is exactly what the four cases in this issue were.

Two walks that must agree is the anti-pattern this codebase already names, in `findLambdas`'
own comment: *"Two walks that agree almost always is the bug, so this one records what emission needs
and emission reads it by index."* The gate and the emitter are that pair, at a much larger scale, and
they have no such shared record.

**Which is the argument for the nets rather than for auditing the 40.** Export parity and build
validation catch a disagreement whatever its cause, without requiring the two walks to agree — and
they caught cases the checker did not. Making the 40 bails record a reason would be worth doing and
would improve the *messages*; it would not remove the need for the nets, because a walk can always
disagree in a way neither side thought to record.

## The export-parity net covers `wac build` and not the in-process API

Worth writing down before anyone reads the net as universal, because I nearly did. `missingExport` is
called from **`buildLinked`** and nowhere else. The `emitFiles*` family in `api.wac` — seven exported
entry points, and what every test and tool in this repository actually calls — goes through
`emitLinked`, which does not ask.

So a dropped export is caught when a person runs `wac build`, and is still silent when
`packages/wacc/test/wac/checked_test.wac` emits the same file in-process.

**This is not an oversight to patch quickly.** `emitLinked` returns `u8[]`. It has no channel to say
anything, which is exactly why the net lives in `buildLinked`, whose `Built` carries an error. Giving
the family one means changing the return type of seven entry points and every caller, and that is a
decision rather than work:

- **Return `Built` from the family.** Honest, and the net becomes universal. Costs a sweep of every
  caller, and most of them want the bytes and nothing else.
- **A second family — `buildFiles*` beside `emitFiles*`** — for the callers that want to know. Two
  producers of one artefact, which `CLAUDE.md` names as one too many.
- **Leave it.** The user-facing path is netted; the in-process one is used by code that is itself under
  test. This is where it stands today, stated rather than assumed.

Recommendation: leave it until something in-process actually loses an export. The net's value is that a
*person* is told; a test that emits a module with a hole in it fails on the hole.

### Incidental, and the reason this came up

`checked_test.wac` is documented at 140s and ran past 20 minutes twice today, which I had treated as
possibly caused by these changes and as a reason not to push. It is not: `checked_test` calls
`emitFiles`/`emitFilesChecked`, so **neither the export-parity walk nor `wac build`'s validation is on
its path at all.** Load was 5-9 with another agent's suite up for the whole window. Contention is the
remaining candidate and the gate's own timing block is the instrument for it.

## The stronger net, and the one thing that decides whether it works

`missingExport` asks about **exports**. The general statement of the disagreement it catches is wider:
*the checker was clean and the emitter declined something.* A non-exported function that gets dropped
is the same fault and nothing asks about it.

`blockedOf` does walk every declaration — but against a **fresh front**, which is the whole reason
`missingExport` had to exist: the fresh front does not reproduce the drop. So the stronger net is the
same trick applied to the whole table — after the real emit, walk *the emitting* `Env` and report the
first `funcOk[i]` that is false, exported or not.

**What decides it:** whether `funcOk[i] == false` is routine. A generic function is a template and
emits nothing — `blockedOf`'s walk `continue`s past `typeParams.len() > 0` for exactly that reason. If
templates take a slot and leave it false, a net over every slot fires on every program in this
repository and is useless. If they take no slot, the net is free and strictly better than the export
one.

I have not tested which, and it is not answerable by reading `addFunc` with confidence, because the
routine-false question is about what the *linker* leaves behind and not about one function. It costs a
seed build to find out: widen the walk, build the repo, and count. Worth doing — but it is the kind of
change whose failure mode is a compiler that refuses everything, so it wants its own cycle and a canary
program that must still build.

Recorded here rather than attempted at the end of a session with unpushed work in the tree.

## The instrument had the same disease, and it is fixed — 2026-08-20

`packages/wacc/test/specEmit.test.ts` asserted two things at 100% and `console.log`ged the third. Its
loop called `blocked()` — wacc's **decline** mechanism — got back an explicit reason, dropped it, and
`continue`d *before* the counter, so a declined program could not spoil the answer count either. Every
spec behaviour wacc cannot produce was a number in a log line nothing could fail on. Same silence as
the compiler's, one layer up.

Now a `KNOWN_UNEMITTABLE` set keyed by tag, shrink-only, mirroring the `KNOWN_DIFFERENT` beside it.
Canaried both ways: an empty set names all of them, a stale tag fails with "emit now".

**And it corrected a number I had written here.** I said 31, taking 279 minus the 248 in the log line.
**Ten** are wacc's. The other 21 are refused by the *reference* and skipped a line earlier — extracting
a `run(` block does not guarantee a program that compiles alone. Capturing the reason instead of the
count is what showed it, which is the same lesson as the bail breakdown above: the subtraction I could
do without running anything was wrong twice.

The ten, with the emitter's own words:

| cases | reason | what it is |
|---|---|---|
| 6 | `local of an unspelled type` / `untyped name` | a nullable primitive — `issues/lang/0171a` |
| 1 | `a construction of Parented<i32> with 2 of 1 fields` | a generic struct's inherited fields |
| 1 | `a type this emitter names only while emitting` | enum methods |
| 2 | `a test for Q on a P`, `a test for Other on a P` | `is` against an unrelated type |

## `valType`'s catch-all, and canarying a guard with no natural trigger — 2026-08-20

`emit.wac`'s `valType` ended in `return 127` — a plain `i32` — so **every unrecognised type spelling
became a number**: `""`, `"i32?"`, a misspelled struct name. A module written with the wrong type in it
rather than refused, which is this issue in one line. `isWritableValType` now lists what genuinely
belongs in that fallthrough (the i32 family plus the other numbers and the two abstract refs) and
`writeValType` declines anything else by name, because it has the `Env` that `valType` does not.

**It had no reachable trigger, so I made one.** Nothing I could write reached it: a nullable-primitive
*parameter* is caught earlier by `addFunc` now, a nullable-primitive *local* still declines through the
parity net without passing here, and a misspelled type name is refused by the checker first. A guard
nothing can reach is a claim nothing checks — the same objection that keeps `issues/lang/0155` open.

So I canaried it against a deliberate break: removed `f32` from `isWritableValType` and rebuilt.

    wacc: cannot emit cf.wac — a value of a type this emitter cannot write: f32

**And the seed build failed too**, which is the stronger half of the evidence: wacc's own source uses
`f32`, so the guard is reached during real compilation and not only by a toy. Reverted, and recovery
needed `seed:bootstrap` rather than `seed` — the canary-built seed could no longer compile wacc, which is
exactly the escape hatch `CLAUDE.md` describes. Seed back to 969125 bytes and a fixed point, 216 of 216
cases.

Worth keeping as the method: when a guard has no natural trigger, break the thing it guards and watch it
fire, rather than shipping it unproven or deleting it for being quiet.

## What is left in this issue — 2026-08-20, end of the audit

The measurement this was filed on is settled: **all fourteen ill-typed programs are refused**, and a
function that goes missing is now named with its cause (`funcWhy`, quoted by the parity net). The spec
corpus agrees completely — `specEmit`'s ledger is empty, 419 of 419 answers, and `wontLoad` is asserted
rather than logged.

Three things keep it open, and they are all *structural* rather than a list of programs:

1. **25 lookup failures in the emitter bail without a reason.** `funcWhy` covers the function-level
   verdict; these are the expression-level `if (at < 0) { return; }` returns underneath it. Three of the
   25 are the decline cascade working as designed and should decline the caller through
   `unsupportedExpr` instead.
2. **The `emitFiles*` family is not netted.** Seven entry points in `api.wac`, which is what every test
   and tool here calls, go through `emitLinked` and never ask `missingExport`. Options and a
   recommendation are above; the recommendation is still to leave it.
3. **`""` as an ordinary value meaning "I don't know."** Every gap closed today was an instance —
   `typeOfTyName` for a nullable primitive, `typeOfExpr` for an array construction, `valType`'s
   catch-all. The mechanism is untouched, so the *next* gap will be silent in the same way.

Anyone taking (1) should read `issues/lang/0173a` first: it is the smallest instance of the same theme,
and fixing it lets `writeValType` refuse a bare unresolved name outright instead of tolerating one.

### Measured before touching the 25: our corpora do not reach any of them

A bail that fires leaves the wasm stack wrong, so the function is invalid — and `wac build` validates
what it writes now, so a reachable bail is *loud*. That makes reachability measurable rather than
arguable:

- **40 package sources** built, 0 failures.
- **The spec corpus**: 258 of 279 emit whole, and `wontLoad` is empty and asserted.
- **`spec/cases`**: 221 of 221.
- **The generated sweep**: 10,013 programs, 0 contradictions.

So none of the 25 fires on anything anybody here has written. That does **not** make them unreachable —
it makes their reachability untested, which is a different and weaker statement.

**Which is why the 25 messages are not being written.** I tried exactly that once today, on the `Unwrap`
bail, and the message could never fire — `typeOfE` answered `""` before the bail was reached — so it was
reverted as a claim nothing checks. Writing 25 of those would be 25 such claims, and the way to avoid it
is the method that worked for `valType`'s catch-all: break what the guard guards, watch it fire, keep it.
That is one canary per bail, and it is the honest cost of this item.

**A cheaper first step, if anyone wants one:** three of the 25 are guarded on `env.funcIndex[at] < 0` —
a callee that was already declined. Those are the cascade working as designed and should decline the
*caller* through `unsupportedExpr` rather than bail; they need no canary, because the condition they test
is one the fixpoint already computes.
## The stronger net is in, and the question it turned on is measured — agent-a, 2026-08-20

The section above left one thing undecided: *"whether `funcOk[i] == false` is routine"*, with the note
that it costs a seed build to find out. It does, and the answer is **no**.

Instrumented the emitter to count, over every declaration in a build rather than only the exports:

| entry | private functions | `!funcOk` | `funcIndex < 0` |
|---|---:|---:|---:|
| `packages/wac/example/wac.wac` | 763 | 0 | 0 |
| `packages/wacc/src/api.wac` | 656 | 0 | 0 |
| `packages/sh/src/sh.wac` | 236 | 0 | 0 |
| `packages/fs/src/image.wac` | 45 | 0 | 0 |
| `packages/tor/src/consensus.wac` | 45 | 0 | 0 |
| `tools/wac/map.wac` | 31 | 0 | 0 |
| `packages/regex/src/compile.wac` | 21 | 0 | 0 |

**1797 non-exported functions and not one of them false or index-less.** So a template takes no slot —
which this walk's `continue` already assumed, and would have drifted `at` if wrong — and a private
function in a linked program always reaches the module. The net is now over **every** function, and it
fires on nothing that exists today.

### The first canary did not isolate it, which is worth recording

Mutating `addFunc` to `declineFor` one name made the widened net report — and the *unwidened* net
reported too. `declineFor` writes `env.blocked`, and `buildLinked` checks `blocked` before it reaches
`missingExport`, so the decline path caught it either way and the canary proved nothing.

The isolating mutation is the one that produces the fault `missingExport` actually exists for: a
function **absent with no decline recorded**. Skipping one name in the renumbering loop does that —
`funcOk` stays true, `blocked` is never written:

    if (env.funcs[i] == "zzDeclineMe") { continue; }   // in the renumbering, not in addFunc

On the same program, `i32 zzDeclineMe(i32 a)` private and never called:

    pre-widening   build EXIT=0, 1787-byte module written, function silently absent
    widened        build EXIT=1 — "the function `zzDeclineMe` is not in the module the
                   emitter produced, and no reason was recorded"

So the widening catches a class the export net could not, the "no reason was recorded" branch is
exercised, and the wording change for a non-exported function is too.

### A cost worth warning the next person about

The census reported by **failing the build with the numbers in the error string**, because the emitter
has no print. That instrumented `wacc.wasm` is then *installed as the seed*, so every later build fails
the same way — including `deno task seed`, which needs the seed to build its successor. Recovery is
`deno task seed:bootstrap`. One probe of that shape is cheap; the second costs a from-reference
rebuild. Prefer appending to a message the build already prints.

### Still open

Unchanged by this: the 25 expression-level bails with no recorded reason, `""` as "I don't know", and
the `emitFiles*` family having no channel to report through — the recommendation there is still to
leave it until something in-process actually loses an export.

## The negative corpus exists now — agent-a, 2026-08-21

The section above calls it "probably the highest-yield single addition here", and it is
`packages/wacc/test/wac/illtyped_test.wac`: all fourteen programs, with the refusal recorded.

Re-measured before writing it rather than copied from the table above, because the export-parity net was
widened underneath that table:

    refused by the checker    14 of 14
    declined by the emitter    7
    silent in both             0

So the four are fixed — a02 `s[0] - 1`, a03 `i32 n = s[0]`, a04 `b ? s : 1`, a08 `p.v()` all draw a
diagnostic now. What the file adds is that they cannot go back to being silent without a test saying so,
which nothing said before: the corpus is this repository's files plus `spec/cases/*.wac`, and **every one
of those is meant to compile**, so a checker's corpus had no way to measure what the checker fails to
refuse.

Three tests rather than one loop:

- every program is refused by the checker — the count and not the code, since several draw two and
  which rule fires is the checker's business;
- the four that used to build with the function missing, named one per line, because a loop failing on
  "a02" says less than a name that is the reason;
- **no program is accepted by both** the checker and the emitter, which is the durable one. Seven are
  not declined by the emitter and that is right — the checker refuses them first and `example/wacc.wac`
  checks before it emits. A row going silent in *both* is a module built with its exported function
  missing and an exit code of 0, whatever mechanism did it.

Canaried by putting a legal program (`return a + 1;`) into the ill-typed list: two of the three tests
fail and name it. That is the harness being checked rather than the compiler — a list-driven test whose
list is wrong reports nothing.

### What is still open here, and the order is unchanged

Steps 2 to 4 — `typeOfE` guessing on `Binary` and `Ternary`, `""` travelling through 38 unguarded call
sites as if it were a type, and the missing cases. The reason the order was "report first, then tighten"
still holds, and the reporting is in better shape than it was: the fourteen are refused, this file holds
them there, and a tightening round that collapses self-hosting now has a negative corpus to calibrate
against instead of a rebuild per guess.

## And the instrument the tightening needs, which now exists — agent-a, 2026-08-21

The section above ends *"there is no way to find round 4 from here. The compiler that would tell you
which expression it declined is the compiler that no longer builds."* That is true of a **seed** and
only of a seed. Two instruments were built instead, and neither installs anything:

**1. `packages/wacc/test/wac/tighten_probe.wac`** — a `wac test` file importing `../../src/api.wac`
compiles the *working tree* with whatever seed is installed, so a tightened emitter can be asked what it
declines while the seed stays the last good one. It runs `blockedFiles` over wacc's own closure and
prints each decline by file and reason. Baseline: **0 of 17**, in seconds. It reports through
`core.warn` and passes, because an instrument that reports by failing is a red test for whoever runs it
next — and in this toolchain a probe that reports by failing a build installs itself as the seed.

**2. `packages/wacc/test/emitSweep.test.ts` now asserts its decline count is zero.** That sweep runs
4501 generated programs through both compilers and compares answers, and it had `declined++` as a bare
number in a `console.log`. Every one of those is a program the reference **just accepted** — the check
is three lines below `r.ok` — so "declining is honest and measured elsewhere" was doing a lot of work
for a counter nobody read. Measured: **0 declined of 4102 compared.** Zero is assertable, so it is
asserted, and a failure now lists up to ten programs with the decline reason and the source.

Canaried by forcing a decline on the `as@` cells: 4054 still compared, 48 declined, and the message is

    48 program(s) the reference compiled were declined by this emitter:
      cast as@ i32->u32: CANARY a forced decline in export u32 f() { i32 x = 0; return x as@ u32; }

The first attempt at that canary inverted the condition instead, which stopped *all* comparisons and
tripped the older `compared < 1000` guard — so it proved the wrong assertion. Worth recording: the two
guards protect different things and only a subset-canary tells them apart.

### Which changes the order again, in a useful direction

Step 2 was "`typeOfE` must not guess", and the reason it has not been done is no longer the missing
report. It is that **there is no failing case for it**: all fourteen programs are refused, the rung 3
differential already grids every operator against every type against the reference
(`typecheck_test.wac`, 50-odd slices including `test_rung3_every_operator_against_every_type`), and the
emit sweep declines nothing. So a tightening today would be a change with no reproduction, which is the
one thing this repository's rules are firmest about.

What is missing is a case, not a fix. The place to look is where the two differentials do *not* meet:
rung 3 compares the **checker** against the reference, and the sweep compares **answers** for programs
both accept. A program the checker accepts, the emitter emits, and whose *result* differs only in a
type the guess got wrong would be caught by the sweep only if the generator emits that shape — and
`generateEmit.ts` is a cast cross-product. Extending it to mixed-type binary and ternary operands is the
next concrete step, and it is a generator change rather than a compiler one.

## Root cause 2 is bounded, measured — agent-a, 2026-08-21

The step named above ("extend `generateEmit.ts` to mixed-type binary and ternary operands") is done, and
the result says something about the fix rather than finding a bug.

**Every operator family in that generator declared `T x` and `T y`.** So the sweep — 4501 programs —
had never handed a binary operator two different types, nor an operator a bare literal, in its whole
existence. Four families added; the reference's verdict on each is the interesting part:

| family | accepted | refused | what it says |
|---|---:|---:|---|
| mixed-width binary (`i32 x; f64 y; x + y`) | **0** | 420 | wac has no valid mixed-width binary |
| a typed operand and a bare literal (`x + 3`) | **324** | 0 | entirely legal, and was untested |
| a packed element as an operand (`b[1] - 3`) | 80 | 0 | round 2's case, legal, now covered |
| ternaries, same-type and mixed branches | 54 | 30 | mixed refused, same-type fine |

Sweep after: **5397 programs, 4540 compared, 0 mismatched, 0 declined.** Everything agrees.

### Which changes what step 2 is

`typeOfE(Binary)` returns whichever operand it could type first. **It cannot produce a wrong answer for
a valid program**, because there is no valid program whose operands have different types — the reference
refuses all 420. So the guess is not a wrong-answer bug at all: it is a *diagnostic* bug, and the harm
recorded at the top of this issue is exactly that shape — the safety net asks "do I know the type?",
gets a confident answer, and does not fire.

That also names the calibration set a tightening has to satisfy, which the four rounds were discovering
one at a time by rebuilding:

- **324 literal-operand programs** — where the guess is load-bearing and *correct*: one side genuinely
  has no type of its own, and answering with the other side's is the rule, not a guess.
- **80 packed programs** — `isNumericTy` does not name `u8`/`i16`, which is what round 2 tripped on.
- **48 string-concatenation programs** — round 1's case. I wrote here that the generator could not
  reach it "because `f` must return a number", and that was wrong: line 134 has generated
  `export i32 f() { return (a + b).len(); }` all along, 48 of them, all accepted. A claim about what a
  generator cannot do is worth grepping for before writing down.

All **452** are in the sweep now, so a round that refuses them fails in 48 seconds with the programs
named, instead of after a seed rebuild. The remaining unknown is round 4, which was never diagnosed — and the
first thing to do with it is no longer to guess, but to run `tighten_probe.wac` and read the list.

## The three structural items, re-counted — agent-a, 2026-08-21

`issues/lang/0173a` is closed, which was the prerequisite this issue named for touching item 1. Its
payoff is taken: **`writeValType` refuses a bare unresolved name now** instead of writing an arbitrary
`i32` byte. The tolerance existed for exactly one producer — the signature-table entry of an uncalled
generic method — and 0173a stopped producing it, so the branch was unreachable and is gone. A bare name
falls to the existing refusal and is named. `deno task seed` is a fixed point; genericsig 2, lambda 21,
cases 224, emit 2, selfhostemit 1, corpuscheck clean, bindhelpers 3, and the sweep at 4540 compared,
0 mismatched, 0 declined.

`isUnresolvedBareName` — which this issue says "exists only to make room for this entry" — now has
exactly one caller, in `typeOfTyName`, where it decides not to instantiate. It went from a tolerance to
a rule.

Then the three items, counted rather than quoted:

**1. Twenty-five lookup failures — confirmed, and it is the only figure here that has not moved.**
`rg` over one-line `if (… < 0) { return; }` bails in `emit.wac`: **25**, the same number this issue
recorded. What has not changed either is the reason not to touch them: the section above measured that
no corpus reaches any of them, so a fix would have no failing case, and this issue's own history is the
argument against changing the emitter from a guess.

**2. The `emitFiles*` family is now eight entry points, not seven — and the eighth is mine.**
`emitFilesIn` was added on 2026-08-21 for `issues/system/0229a`, so the un-netted set grew by one while
this issue was open. `missingExport` is still asked in exactly one place, `buildLinked`, whose own
comment says why it is last. The recommendation to leave it stands; the count does not.

**3. `""` as "I don't know" is untouched.** This issue counts 53 `typeOfE` call sites, 15 guarding the
empty answer, 38 carrying on. Today, with the same shape of heuristic — a test for `""` within three
lines of the call — it is **58 / 18 / 40**. The ratio is unchanged: the number tracked the file growing,
not any fix. (A three-line window is a heuristic and the original count was too; what it supports is
"unchanged", not an exact figure.)

## The 25 broken down again, because "three of those 25" is 15 — agent-a, 2026-08-21

The measurement above says *"three of those 25 are guarded on `env.funcIndex[at] < 0` — a callee that
was declined — which is the cascade working as designed and should be declining the caller through
`unsupportedExpr` instead."* Counted rather than sampled, it is **fifteen**:

| | |
|---:|---|
| 15 | `if (X < 0 \|\| env.funcIndex[X] < 0) { return; }` — a helper missing **or itself declined** |
| 10 | `if (X < 0) { return; }` — a plain failed lookup |
| 25 | the total this issue already had right |

So the form this issue treats as a footnote is the **majority** of them, and the recommendation
attached to it — decline the caller instead of returning — is most of the work rather than a corner.
That matters for the order: it is one uniform change to fifteen sites, not three special cases.

What they look up is uniform too. Ten are internal string helpers (` str_concat`, ` str_cmp`,
` str_eq`, ` str_idx`, ` str_fromcp`, ` str_from_bytes`, ` str_slice`, ` str_index_of`,
` str_to_bytes`), two are `owner + "." + mname` method lookups, one is `methodAt(comp, "render")` for
JSX, one is a generic instantiation, and one is ` str_concat` again in `emitCompound`, for `s += x`
— the same helper as the expression form, deliberately, *"so the two spellings cannot drift apart"*.

**And returning is worse than declining, not equivalent to it.** At the expression sites the operands
have not been emitted yet:

```wac
i32 cc = env.funcAt(" str_concat");
if (cc < 0 || env.funcIndex[cc] < 0) { return; }
emitExpr(fb, src, lexed, env, left);      // <- never runs
emitExpr(fb, src, lexed, env, right);
fb.byte(16);
fb.u32leb(env.funcIndex[cc]);
```

So the `return` does not skip a call, it leaves the enclosing function body **short a value** — an
expression that was supposed to push one pushes nothing. At `emitCompound` it fails the other way
round: the caller has already pushed both operands, so returning leaves two values on the stack with
nothing to consume them. Either way the result is a malformed body rather than a missing feature, and
it is recorded nowhere.

### The change: `haveRequired`

One guard for all fifteen, which declines the module with a sentence naming what was looked for and,
when the callee was itself declined, quoting that callee's own `funcWhy`. The variable keeps meaning
"the callee's slot", so every later `env.funcIndex[var]` stays correct — making it hold the *index*
instead would double-index and emit a call to the wrong function, which is the obvious refactor and is
wrong.

These are still not meant to be reachable, and that is the argument for naming them rather than for
leaving them: `canEmit`/`unsupportedIn` decides emittability before emitting, so a program arriving
here means the gate and the doer disagree — and a branch that stays silent when it is wrong cannot be
told from one that is right. The ten plain-lookup bails are the remaining half.

### Verified by forcing one, because none of them is reachable

`deno task seed` is a fixed point with all 24 declines in place, so not one fires while building a
182-file program — which is what "defence in depth" means and is the right outcome. It also means the
sentence they record had never been printed, and **a decline that cannot report is the defect being
fixed**, so the wiring was proved rather than assumed: forcing `haveRequired` to answer false gives

    a call to `str_concat`, which this expression is emitted as and which is not in the program

with the internal leading space stripped, as intended.

Two things that came out of proving it, both worth more than the proof:

- **`blockedFiles` answers `""` for every one of these**, forced or not. Its own API neighbour says
  why — *"the two walk different `Env`s, so a decline raised during emission reaches `blockedFiles`
  only as the fallback"* — so `emitDeclineFiles` is the instrument for anything in this family, and
  reaching for the obvious one costs a wrong conclusion. `emitDeclineFiles` exists because that
  already happened once: *"an instrument nothing can call is not an instrument."*
- **The JSX tag decline cannot be reached from a program either.** `<nosuchtag />` with
  `import { Attr, Node } from "core";` compiles clean and emits — intrinsic tags are open-ended, so an
  unknown tag is an element rather than an error. Worth knowing before anyone writes a test expecting
  a refusal there.

## Item 2's rule, read out of the reference rather than calibrated by rebuilding — agent-a, 2026-08-21

The 2026-08-20 attempt tightened `typeOfE(Binary)` and calibrated against the reference in four rounds,
each round finding a legal case the previous one refused, and round 4 collapsed self-hosting
undiagnosably. The rounds were **discovering, one rebuild at a time, a rule that is written down**:
`compiler/wacTypeCheck.ts`'s `checkBinaryOp`. Here it is, which is the calibration table the attempt
was reconstructing:

| operator | left | right | result |
| --- | --- | --- | --- |
| `+` with a `string` left | `string` | must be `string` | `string` |
| `== != < <= > >=` with a `string` left | `string` | must be `string` | `bool` |
| `+ - * / %` | must be numeric | **must equal the left** | the left's |
| `== != < <= > >=` | not a reference type | **must equal the left** | `bool` |
| `&& \|\|` | `bool` | `bool` | `bool` |
| `& \| ^` | must be an integer | **must equal the left** | the left's |
| `<< >> >>>` | must be an integer | any integer — **need not match** | the left's |

**The shift row is the one worth having in advance.** A rule of "the operands must agree" refuses
`u64 << i32`, and the reference says exactly why it must not: *"A count is not an operand. It is never
the thing being widened and has no lossy case — wasm masks it to the operand width regardless."* It
also records that this used to be two short lists that disagreed, and `u64 << i32` type-checked and
emitted `i64.shl` with an i32 on the stack. So a naive tightening reintroduces a fixed bug rather than
finding a new one, and it would have been a later round.

### What the guess is actually doing, and the one case that is not a guess

    string lt = typeOfE(src, lexed, env, left);
    if (lt != "") { return lt; }
    string rt = typeOfE(src, lexed, env, right);
    if (rt != "") { return rt; }

Two wrong answers in there — `return lt` when `rt` is known and *different*, and `return rt` when the
left is the one that could not be worked out. But **`bytes[i] - 48` depends on this and is legal**:
`lt` is `u8`, `rt` is an untyped integer literal, and `u8` is the right answer for the expression. The
reference never faces it because a literal has already been given the slot's type by the time
`checkBinaryOp` runs.

So `""` is carrying two facts again — *this is an untyped literal, take the other side* and *I could
not work this out* — which is the same conflation as `issues/lang/0180a`, where `isDeclaredName`
answered both "does this name exist" and "what is this local's type". The discriminator exists:
`isLiteral`, already used two hundred lines below.

    if (k is a shift)                             return lt;      // the amount need not match
    if (isLiteral(right) && !isLiteral(left)  && lt != "") return lt;   // the other operand is an
    if (isLiteral(left)  && !isLiteral(right) && rt != "") return rt;   //   expectation, either order
    if (lt == "" || rt == "")                     return floatLiteralEither ? "f64" : "";
    if (lt != rt)                                 return "";       // a disagreement is not an answer
    return lt;

Six lines, every one citing a written source rather than a round of calibration.

**The literal rows are keyed on `isLiteral`, not on the literal's answer, and that distinction is a
spec clause.** `spec/spec/types.md` says a literal *"keeps the width its own notation gives it —
including as an operand of an operator, so an `i64` literal stays `i64` rather than narrowing"* — and
then: *"The **other operand counts as an expectation**, in either order and whether or not the literal
is negated"*, with `§wac-int-context-9wkq4mz` showing `f(i32 x) { return -2147483648 <= x; }` compiling
with the literal as an **i32**, even though `2147483648` needs 64 bits.

**Measured before trusting that reasoning, and it cuts the other way for this function.** `typeOfE`
answers `""` for `IntLit` and `FloatLit` — a numeric literal is context-typed and has no type of its
own here — so `-2147483648` does *not* come back as `i64`, and the clause's own example is a
comparison, which returns `bool` two lines earlier and never reaches any of this. The clause is about
the **checker**, where slot typing has already run; it does not constrain this arm.

So the `isLiteral` rows are right for the reason `bytes[i] - 48` gives and not for the reason the
clause gives — worth writing down, because the wrong reason justifies the same code today and the
wrong thing next time. `BoolLit` and `StrLit` do answer real types (`bool`, `string`), so those rows
only ever fire for the numeric literals they are about.

Two legitimate cases found by reading, then — the shift row and `bytes[i] - 48` — plus one that looked
like a third and was not. All before writing a line, where the 2026-08-20 attempt found its three by
collapsing the build.

### Why this is now attemptable when it was not yesterday

The attempt's own conclusion was *"make declines reportable, then tighten"*, and two things have
changed since it was written:

- **24 of the 25 emitter bails name what they could not find** (this issue, above), and
  `emitDeclineFiles` reports it.
- **`tools/seed.sh` checks all three payloads** and says which one is missing — added 2026-08-20 for
  `issues/system/0216a`. That is the check whose absence made round 4 undiagnosable: the collapse
  showed up as a size printed and an exit code of 0. It caught a real failure today, when a first
  attempt at `0180a` broke `packages/box/example/boxsh.wac` and the seed said so by name.

So the loop the attempt asked for exists: tighten, reseed, read the named decline, decide whether the
case is legal, repeat. The four rounds are still four rounds — but each one now names its expression
instead of costing a guess.

### Done, and the reporting paid for itself within the hour

Applied. The first reseed **failed**, and the failure is the argument for having landed the bail
messages first:

    wacc: cannot emit packages/box/example/boxsh.wac — the exported function `main` is not in the
    module the emitter produced — a reference to boxRun, declined: a call to dispatch, declined: a call
    to gunzip, declined: a call to gunzipStream, declined: a method BitReader.readByte, declined: a
    method BitReader.readBits, declined: a method BitReader.peek, declined: untyped binary

Seven levels, ending at the expression. `BitReader.peek` is
`return this.bitBuf & ((1 << count) - 1);`, and the rule above types the shift as its **left** operand
— which here is the literal `1`, with no type of its own. So the shift came back unknown, that made
the subtraction unknown, that made the `&` unknown, and the method declined. The previous code
answered `i32` by falling through to the *amount*.

So the shift row keeps that fallback: `return lt != "" ? lt : rt;`. Taking the amount's type is not
obviously right — `i64 x = 1 << count;` is refused by both compilers, `expected i64, found i32` — but
it is a clean refusal rather than 32-bit arithmetic in a 64-bit slot, and repairing it needs the slot,
which a context-free `typeOfE` cannot see. Filed as `issues/lang/0233a` rather than guessed at.

**And `untyped binary` was made to name the cause**, since that leaf is where a seven-deep cascade
lands: it now says *"whose operands disagree: i32 and i64"*, *"whose left operand is untyped, the right
being i32"*, or *"whose operands are both untyped"*. Three causes wanting three different fixes, which
one string could not distinguish.

Second reseed: a fixed point with all three payloads. `cases_test` 225 of 225, `illtyped` 5 of 5,
`corpusMutate`, `checkSweep` and `emitSweep` all green.

**It is defence in depth, and the tests say so.** wacc's checker already refuses mismatched operands —
`error: operands have mismatched types` — so no program reaches the guess by this route today, and
`packages/wacc/test/wac/binaryoperands_test.wac` asserts *both* halves: that the emitter now has no
type for them and names both, and that the checker refuses them first. If the second test ever fails,
the first stops being a second line of defence.

Canaried twice, because there are two things to lose:

- removing `if (lt != rt) { return ""; }` — the disagreement test fails, both operand pairs unblocked;
- removing the shift exemption — `b << a` is blocked with *"untyped binary whose operands disagree:
  i64 and i32"*, which is the failure mode that collapsed the 2026-08-20 attempt, reproduced on
  purpose in one run instead of four rebuilds.

`spec/cases/0223` pins the runtime answer for the shift (`k` answers 8), so the exemption is held by a
case in the corpus as well as by a test.

## Where this stands: the bug is fixed, and what is left is two decisions — agent-a, 2026-08-21

**All four reproductions behave.** Re-measured today, through the binary:

| | program | now |
|---|---|---|
| a02 | `return s[0] - 1;` | `error: this operator does not take an operand of that kind` |
| a03 | `i32 n = s[0];` | `error: initialiser does not match the declared type` |
| a04 | `return b ? s : 1;` | `error: the two branches of a ternary have unrelated types` |
| a08 | `return p.v();` | `error: this is not something that can be called` |

They are pinned by `packages/wacc/test/wac/illtyped_test.wac`, which holds all fourteen and was
canaried today when its two-file half went in.

**Three of the four items in "what to do" are done, and item 4 was already done before this pass** —
which is worth saying plainly, because reading the list top to bottom does not reveal it:

1. **A declared export missing from the module is an error** — landed for `wac build`. What remains is
   the in-process API, and that is a decision this issue already states three options for.
2. **`typeOfE` must not guess** — done today. The rule came out of `checkBinaryOp` and
   `spec/spec/types.md` rather than out of calibration; `binaryoperands_test.wac` and
   `spec/cases/0223` hold it, canaried both ways.
3. **Give `""` a meaning callers cannot ignore** — open, and the only item that is still open. Its
   stated basis was already corrected above: the "38 unguarded call sites" figure counted an idiom, and
   sampling four of them found one real hole.
4. **Add the missing cases and rules** — **already done, and stale as written.** `typeOfE`'s `Index`
   arm answers `string` for `s[i]` (with a comment about why it is not a byte), and `issues/lang/0165`
   is closed. Both halves of the item, verified by running the programs rather than by reading.

### So this is a decision issue now, not a bug

The symptom in the index — *"a decline with no cause, or none at all"* — is no longer true: 24 of the
25 emitter bails name what they could not find, and `untyped binary` names which operand. Nothing here
is currently silent.

What is left is two questions, both already written up above with options and costs:

- **the in-process API has no export-parity net** while `wac build` does (three options: return `Built`
  from the `emitFiles*` family, add a `buildFiles*` family beside it, or leave the in-process path to
  the code that is itself under test);
- **`""` as an ordinary value** meaning "I don't know" (item 3).

Neither is work waiting to be done; both are choices where picking wrong costs a sweep. Left filed
rather than split into two new issues, because splitting would move this text rather than add anything
— but the **kind** is `decision` from here, and anyone looking for a bug to fix should look elsewhere.

## Item 3 predicted the next gap, and there were six of them — agent-a, 2026-08-21

*"The mechanism is untouched, so the next gap will be silent in the same way."* Written 2026-08-20.
Measured 2026-08-21, one day later, six times:

| | the program | what was silent |
|---|---|---|
| `0242a` | `string s = x++;` | `typeOfExpr` had no `case Incr`; unknown is silence |
| `0243a` | `string s = match (e) { case A: 1, else: 2 };` | `litFamily` had a `Ternary` arm and no `MatchExpr` |
| `0244a` | `g(1 + 2)` for `g(string)` — and 15 more slots | eleven guards asked `litKindOf`, the callee reads `litFamily` |
| `0245a` | `i32 n = "a" + "b";` | the `Binary` arm discarded a literal operand's type |
| `0246a` | `b ? 1 + 1 : "a"` | four interlocking guards, all the narrow test |
| `0248a` | `if (1 + 1)` | `notBool` asked the narrow test |

Every one is item 3's shape exactly: a value meaning *"I don't know"* flowing into a rule that treats
not-knowing as nothing-to-say. Not one was found by a differential — the corpus is this repository's
own files plus `spec/cases`, and nobody writes `g(1 + 2)` where a string belongs on purpose.

**So the practical mitigation, while the mechanism stands, is an enumeration rather than a corpus.**
Both halves of it are cheap:

* **Enumerate what a dispatch names against what the type declares.** 22 `ExprKind` variants against
  `typeOfExpr`'s arms found `0242a` in one grep. Do it against `litFamily` and `0243a` falls out.
* **Ask the pair question at every guard**: is there a program where the *direct* form is refused and
  the *compound* form is not? That is `0244a` through `0248a`, and it works because a compound literal
  is the cheapest way to make a value whose type is unknown for a legitimate reason.

The second is the one worth keeping. A guard that asks "is this a literal" has a narrow answer and a
wide answer available — `litKindOf` and `litFamily` — and picking the narrow one is invisible in review
and invisible to every corpus. Sixteen guards in this file had picked it.

**And item 3's cost is not only silence.** `0247a` is the same mechanism failing in the other
direction: giving `1 + "a"` a type where it used to have none made a *second* rule speak, so one fault
drew two diagnostics. `""` meaning "I don't know" is load-bearing in both directions, which is why
replacing it is a sweep and not an edit — and why the recommendation above to treat this as a
`decision` still stands.
