# 0180a — an imported function used as a value is not type-checked, and the module is invalid

- **Status:** closed — agent-a, 2026-08-21: `isDeclaredName` answered two questions with one bit; the
  names table gained `nameImportOnly` to tell them apart. Two simpler shapes were tried first and both
  false-alarmed on working code — see below, which is the useful part. The fourteen-row negative
  corpus grew a seven-row two-file half; b01, b02 and b07 are the canary
- **Fixed in:** `check.wac`'s import walk, with `packages/wacc/test/wac/illtyped_test.wac`
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** invalid wasm, with the checker reporting nothing

## Reproduction

Two files. `MESSAGE` is a function; it is passed where an `i32` is wanted.

```wac
// lib.wac
export i32 MESSAGE() { return 4; }
```

```wac
// imp.wac
import { MESSAGE } from "./lib.wac";
i32 take(i32 n) { return n; }
export i32 f() { return take(MESSAGE); }     // MESSAGE, not MESSAGE()
```

    $ wac check imp.wac
    imp.wac: 2 file(s), no diagnostics

    $ wac build imp.wac -o imp
    rejected imp.wasm
    wac: the build wrote imp.wasm and the engine will not load it, so the compiler emitted
         something invalid rather than refusing the program

The engine is specific about what happened:

    Compiling function #1:"f" failed: call[0] expected type i32, found struct.new of type (ref 29)

So the emitter built the funcref **pair** — a `fn[…]` value is a two-field struct in this emitter — and
passed it to a call that wants an `i32`.

**The reference refuses it, with the right message:**

    imp.wac:3:30 [typecheck] type mismatch: expected i32, got fn() -> i32

## What narrows it: the same program with a *local* function is refused

```wac
i32 g() { return 7; }
i32 take(i32 n) { return n; }
export i32 f() { return take(g); }
```

    error: argument does not match the parameter's type
      --> m.wac:3:30
       |
     3 | export i32 f() { return take(g); }
       |                              ^

Both compilers get that right, and wacc's message has a caret in the right place. So the rule exists and
fires; what it cannot see is an **imported** name. One import statement is the whole difference between a
diagnostic and an invalid module.

## Why this is `issues/lang/0170a` with the thing that issue is missing

`0170a`'s third item is *"`""` as an ordinary value meaning 'I don't know'"*, and its standing objection to
touching items 1 and 2 is that **no corpus reaches them, so there is no failing case**. This is one. The
shape is the same as everything closed under that issue this week: a name whose type the checker does not
know, a rule that therefore cannot be wrong about it, and an emitter that goes ahead.

It is also the shape of `issues/lang/0157` and `0175a` one layer over — a checker that resolves an import
to *something*, and then knows less about it than the emitter does.

## Narrowed: it is the name's type, not the argument check

The same split with an **assignment** instead of a call:

    i32 x = MESSAGE;   imported  ->  no diagnostics
    i32 x = MESSAGE;   local     ->  error: initialiser does not match the declared type, with a caret

So no argument-specific rule is involved. What differs is what the checker thinks `MESSAGE` *is*, and
the mechanism is in `typeOfExpr`'s `Ident` arm (`check.wac`):

```wac
string held = c.typeOfName(idName);
// **A local or parameter wins, as it does everywhere: it is nearer** — and it wins even when its own
// type cannot be named …  Unknown is the answer, and unknown is silence. `issues/lang/0145`.
if (c.isDeclaredName(idName)) { return held; }
// **A declared function used as a value is a funcref** — see `funcValueType`.
return funcValueType(c, c.funcAt(idName));
```

## Measured, because two readings of that arm fit and reasoning could not choose

The first filing guessed that `isDeclaredName` was true with no type. Reading `declareConst`'s call
sites then made that look wrong — none of them declares an import — and at that point there were two
stories and no evidence. So the arm was instrumented instead: a temporary `c.report(9999, …)` with the
state packed into the line and column fields, driven through `dumpTypeErrorsFiles` from a probe under
`test/wac/` (which compiles the working tree, so an instrumented `check.wac` answers without becoming
the seed).

| | `isDeclaredName` | `funcAt >= 0` | `held` unknown | diagnostic |
|---|---|---|---|---|
| imported `MESSAGE` | **yes** | yes | yes | none |
| local `MESSAGE` | no | yes | yes | code 5, at 3:30 |

**`funcAt` finds the function in both cases.** `funcValueType` would have answered `fn() -> i32`; the
name branch returned unknown first. The guess was right and the second reading was wrong, and neither
was worth more than the ten minutes the probe took.

## The cause: one bit answering two questions

`check.wac`'s import walk declares an imported name with no type, so that a *single-file* check calls
it unknown rather than undefined:

```wac
if (c.isDeclaredName(alias) || c.isStruct(alias) || c.isEnum(alias)) { continue; }
c.declare(alias, typeNone());
```

That entry is **not a binding**. It has no type to narrow, nothing assigns to it, and the declaration
it stands for is recorded properly elsewhere — `declareModule` gives an imported function its return
type, its parameters and its arity. But `isDeclaredName` is the only thing that distinguishes it from
a local, and two kinds of rule read it for two different questions:

- *does this name exist at all* — the undefined-type rule, and a dozen more;
- *what is this local's type* — `typeOfExpr`'s `Ident` arm, and `checkCallee`'s funcref-shadowing rule.

An imported function is a yes to the first and not a subject for the second. With one bit for both, the
`Ident` arm returned unknown and shadowed a signature that was already recorded.

**The fix is a second bit**, `nameImportOnly`, set by `markImportOnly` where the placeholder is
declared. The table's contents are otherwise unchanged, and one condition reads it:

```wac
if (c.isDeclaredName(idName) && !c.isImportOnlyName(idName)) { return held; }
```

## Two simpler shapes, and what measured them wrong

Both were tried before the flag, and each looked right until something ran.

**Shape 1 — skip the declaration when a function of that name exists** (`|| c.funcAt(alias) >= 0` on
the guard above). It passes the new test, the seed reaches a fixed point, and `deno task docs` is
clean. It also **false-alarms on working code**, which the corpus differential caught by pointing
somewhere other than the mutation:

    error: undefined type
       --> packages/quic/src/server.wac:144:12
        |
    144 |     return x25519(this.scalar, theirs);
        |            ^^^^^^ unknown type 'x25519'

A plain call to an imported function, reported as an unknown *type*, because taking the name out of
the table answered "does this name exist" with no.

**Shape 2 — declare it with its funcref type** rather than with unknown
(`c.declare(alias, fat >= 0 ? funcValueType(c, fat) : typeNone())`). This keeps the name in the table,
so the undefined-type rule is happy, and it passes the new test *and* the corpus differential. It
breaks the seed's `sh` payload:

    error: wrong number of arguments
      --> packages/box/src/applets/gunzip.wac:23:10
       |
    23 |   return gunzipStream(cli.readChunk, cli.write);
       |          ^

Because `checkCallee` implements `[§wac-param-shadows-func-5nkq2wp]` — *"a bare name in call position
resolves to a local or parameter of funcref type before any function"* — and a name with a funcref
type **is** such a local as far as that rule can tell. So every imported function became a funcref
local shadowing itself, and its calls were checked against `funcrefArity` of a spelling like
`fn(fn() -> Read, fn(u8[]) -> bool) -> i32` instead of against the declaration.

Both shapes are the same mistake as the original bug, one layer over: changing what one overloaded bit
says, instead of separating the two things it says.

**And note which instrument found each.** The generated sweep (`checkSweep.test.ts`) reported *0 false
alarms on 4,594 programs* for shape 1 — every one of them single-file, so it could not see an import
if it tried. `corpusMutate` found shape 1 because its corpus is this repository. Nothing found shape 2
but `deno task seed`, which builds a 182-file program.

## What the fix does and does not change

Verified through the rebuilt binary:

    take(MESSAGE)                   refused, `argument does not match the parameter's type`, caret at 3:30
    take(MESSAGE())                 clean — the well-typed twin, 2 file(s), no diagnostics
    apply(dbl, 21) for fn[i32(i32)] clean — an imported function used *as* a funcref still passes
    fn[i32(string)] g = dbl         refused: `expected fn(string) -> i32, found fn(i32) -> i32`

That last row is new behaviour rather than a restored diagnostic: an imported name had no type at all
before, so no funcref declaration could disagree with it. It is row b07 of the test.

**And the seed reached a fixed point**, which compiles the whole `packages/wacc` graph — the largest
body of imported functions here — with the new rule.

## Why nothing caught it

- The **corpus differential** compares this repository's own files, and no file here passes an
  imported function where a value of another type is wanted. It is a typo, not a construct anybody
  writes on purpose — I wrote it by passing `MESSAGE` instead of `MESSAGE()` while building a probe
  for `issues/lang/0156`.
- The **rung 3 generated sweep** grids operators and types against the reference, and its programs are
  single-file. Every one of its 4,594 cases has no imports at all — so it reported *0 false alarms* on
  this change while being structurally unable to see it.
- `packages/wacc/test/wac/illtyped_test.wac` — the negative corpus added for `issues/lang/0170a` — was
  also single-file, for the same reason: it was written from that issue's fourteen one-liners.

**That is the gap worth naming, and it is now half closed**: every negative differential wacc had was
single-file, and a whole class of its silence is about names that arrive through an import. The
two-file half added here is seven rows; five of them (b03–b07) were already refused, which is the
argument for the half rather than for the one row.

## Fixed

- `packages/wacc/src/check.wac` — `nameImportOnly` on the names table with `markImportOnly` and
  `isImportOnlyName` beside the `nameAliasOnly` pair it sits next to (a different question: that one
  is constness-by-aliasing), set where the import placeholder is declared, and read by one condition
  in `typeOfExpr`'s `Ident` arm.
- `packages/wacc/test/wac/illtyped_test.wac` — the two-file half: `names2`/`libs2`/`imps2`, the
  refused-by-the-checker claim, the accepted-by-both claim, and the well-typed twin of b01 as the
  control that stops the rule being "refuse every imported name".
- Canaried by reverting the arm: b01 and b02 fail in both tests, and the first attempt at that canary
  left the clause standing as its own `if` and reported five passes — the edit, not the test.
