# 0180a — an imported function used as a value is not type-checked, and the module is invalid

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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

## Why nothing caught it

- The **corpus differential** compares this repository's own files, and no file here passes an imported
  function where a value of another type is wanted. It is a typo, not a construct anybody writes on
  purpose — I wrote it by passing `MESSAGE` instead of `MESSAGE()` while building a probe for
  `issues/lang/0156`.
- The **rung 3 generated sweep** grids operators and types against the reference, and its programs are
  single-file. Every one of its 10,013 cases has no imports at all.
- `packages/wacc/test/wac/illtyped_test.wac` — the negative corpus added for `0170a` — is also
  single-file, for the same reason: it was written from that issue's fourteen one-liners.

**That is the gap worth naming**: wacc's negative differentials are single-file, and a whole class of
its silence is about names that arrive through an import. `checkFilesWithIn` is the entry point that has
the map; `dumpTypeErrors` is the one the grids drive.

## Narrowed: it is the name's type, not the argument check

The same split with an **assignment** instead of a call:

    i32 x = MESSAGE;   imported  ->  no diagnostics
    i32 x = MESSAGE;   local     ->  error: initialiser does not match the declared type, with a caret

So no argument-specific rule is involved. What differs is what the checker thinks `MESSAGE` *is*, and
the mechanism is legible in `typeOfExpr`'s `Ident` arm (`check.wac`):

```wac
string held = c.typeOfName(idName);
// **A local or parameter wins, as it does everywhere: it is nearer** — and it wins even when its own
// type cannot be named …  Unknown is the answer, and unknown is silence. `issues/lang/0145`.
if (c.isDeclaredName(idName)) { return held; }
// **A declared function used as a value is a funcref** — see `funcValueType`.
return funcValueType(c, c.funcAt(idName));
```

An imported function appears to satisfy `isDeclaredName` with **no type**, so the first branch answers
unknown and the funcref branch is never reached. A local function is not a declared *name*, so it falls
through and gets its signature.

**And that makes the fix a decision rather than an edit**, which is why this is filed and not fixed: the
comment on that first branch is load-bearing. `issues/lang/0145` is a case where unknown *must* win — a
match binding from an unresolved variant, where answering with a module function of the same name
reported a working file as an error. So "prefer the funcref when `held` is unknown" would reopen that.

What is wanted instead is for an imported function not to be registered as a typeless *name* at all —
`declareModule` already registers it properly with `declareFunc`, including its return and parameter
types, so the funcref branch would answer correctly if the name branch did not shadow it. Finding what
puts the bare name in scope is the next step; `checkFilesWithIn` and `declareModule` are the two places
that touch it.

## Where to look

*(This section said the fix was probably in what `declareModule` records. The narrowing above supersedes
it: `declareModule`'s `Func` arm calls `declareFunc` with the return type, the parameter types and the
arity, so the signature **is** recorded. Kept as the first guess, because the corrected version is only
legible against it.)*

`packages/wacc/src/api.wac`'s `checkFilesWithIn` declares, for each import, the names the entry asked
for — `wantFrom`/`wantName`/`wantAlias`, `addRename`, `addLocalAlias`, then `declareModule`. One of those
is putting the bare name in scope as a *name*, which is what shadows the funcref lookup; `declareFunc`
is not the problem and neither is the argument check. The candidates are `addLocalAlias` (added for
`issues/lang/0161`, and only used when a spelling differs — which this reproduction does not, so probably
not) and whatever `declareModule` does for a name that is not one of the four declaration kinds it
matches on.

The test belongs beside `illtyped_test.wac` — with two files, which is the point.

## Worth fixing at the same time

Extend `illtyped_test.wac` with a **two-file** half. Its header already says why a single-file corpus
cannot measure what the checker fails to refuse; the same argument applies one dimension over, and this
issue is the case that proves it.
