# 0174a — wacc's checker loses a method lookup when the receiver name is shadowed

- **Status:** closed
- **Fixed in:** this commit
- **Closed by:** agent-a, 2026-08-20
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** a missing compile error — the program is still refused, by the emitter, with a message
  that names the wrong thing

## Reproduction

```wac
struct S { i32 v; i32 m(this) { return this.v; } }
export i32 f(S a) { i32 a = a.m(); return a.m(); }
```

The second `a.m()` is a method call on an `i32`, because the local shadows the parameter from its
declaration onward. Both compilers refuse the program. They do not refuse it in the same place:

    reference   error: E.wac:2:43 [typecheck] type 'i32' has no method 'm'
    wacc        wacc: cannot emit E.wac — the exported function `f` is not in the module the
                emitter produced — a call to f, declined: no method i32.m

wacc's **checker** is clean. The emitter declines, and what the user sees is the export-parity net
reporting a missing export.

## Why it is worth fixing even though the program is refused either way

wacc has this rule and applies it correctly when the receiver is not shadowed:

```wac
export i32 f() { i32 x = 5; return x.upto(3); }
```

    error: no such method
      --> m1.wac:1:36
       |
     1 | export i32 f() { i32 x = 5; return x.upto(3); }
       |                                    ^ no i32.upto

Line, column, caret, and the type and method named. So this is not a missing rule — it is a rule
whose input has been blanked. **Corrected below:** the first reading of this was that the checker
resolves the later `a` to the parameter while the emitter resolves it to the local. It does not
resolve it to anything — a same-scope redeclaration is deliberately poisoned to `typeNone()`, and
unknown means silent. The distinction matters because it changes where the fix goes and what it
costs.

**The cost is the message.** Found while replacing thirty-three copies of `struct Rng` with one
shared struct (`issues/system/0220`): converting a method to a free function meant rewriting `this.`
to `r.`, and one body already had a local called `r`. What came back was

    wacc: cannot emit packages/json/test/wac/utf8_test.wac — the exported function
    `test_utf8_random_byte_sequences_agree_with_a_strict_decoder` is not in the module the emitter
    produced — a call to pick, declined: no method i32.upto

which is a good message — the `funcWhy` half of `issues/lang/0172a` is doing exactly its job, and
"no method i32.upto" is the true cause. It still names a test function, an export and a call rather
than the line the mistake is on, because it is a *parity* report about a module rather than a
diagnostic about a program. The checker's version of the same sentence would have pointed at the
character.

## What nobody should read into it

**wacc's resolution is right, and there is now a case for it.**
`spec/cases/0221-a-local-shadowing-a-parameter-of-another-type.wac` — two structs with a method of
the same name, the local shadowing the parameter, `answers f = 2` — is met by wacc. A compiler that
resolved the *use* to the parameter, as the checker does, would answer 1. So the checker's opinion is
wrong and does not reach codegen; the two halves of wacc disagree and the right one wins.

Same-scope shadowing is itself accepted by both compilers and is not the bug:

```wac
export i32 f(i32 a) { i32 a = 2; return a; }        // both accept
export i32 f() { i32 a = 1; i32 a = 2; return a; }  // both accept
```

Whether it *should* be — a redeclaration in the same scope with no intervening block, which
`spec/spec/naming.md` only ever illustrates with a block — is a separate question and a decision
rather than a bug. `issues/lang/0014` closed the parameter-against-parameter case as an error, which
is an argument that this one is too, and `spec/spec/naming.md` says nothing either way. Not filed as
part of this: fixing the checker's lookup does not depend on it.

## Attempted, reverted, and now diagnosed — agent-a, 2026-08-20

**The cause is not a lost lookup. The name has no type at all, on purpose.** `declareConst` poisons a
same-scope redeclaration to `typeNone()`, and unknown means silent everywhere in this checker, so no
rule can be wrong about the name — including the one that would have caught `i32.m`.

The obvious fix is to retype instead of poisoning:

```wac
if (this.names[i] == name && this.sameScope(i)) {
  this.types[i] = ty;
  this.nameConsts[i] = isConst;
  this.nameAliasOnly[i] = false;
  return;
}
```

It makes every reproduction here produce the diagnostic, and it is **wrong**, for the reason the
comment above it already gave and I dismissed as stale:

```
/main.wac:5:13  initialiser does not match the declared type  expected i32[], found i32
```

on

```wac
struct H { i32[] items; }
export i32 f() {
  H h = H(i32[0]());
  i32[] items = i32[0]();
  h.items = items;          // line 5 — legal: `items` is the array here
  i32 items = 3;            // line 6 — same scope, redeclared
  return items;
}
```

Line 5 is reported because of a declaration on line 6. **The name table is position-blind by
construction**: `declareStmt` walks the whole body declaring every local, and only then does
`checkStmt` walk it checking, so every declaration in a function is in the table before any statement
is checked. Poisoning is what makes that safe — an unknown type cannot be wrong about a use on either
side of the declaration, and a real type is wrong about half of them.

So `sameScope` is *not* the distinction that was missing. It answers "which scope", which is what
`issues/lang/0122` needed. What a fix needs is "where in the scope", which nothing here records.

### What a fix would take

A declaration position per name — the token index would do — and a comparison against the position of
the use. `findName` currently answers a name; it would have to answer *the declaration in effect
here*, which means every caller has a position to hand. There are around thirty callers of
`typeOfName` and the ones inside `typeOfExpr` have an expression, so the position is available; the
ones in the declaration walk do not need it.

Cheaper and probably better first: make the two passes one, or have `declareStmt` record the
declaration order it already walks in. The passes exist because a declaration has to be visible to a
*later* statement before that statement is checked, which a single forward walk gives for free — so it
is worth finding out what the split is actually for before threading positions through thirty callers.

### The corpus is now clean of the pattern, which is the part worth keeping

With the fix applied, rung 3 of `corpuscheck_test.wac` — the repository's own code, no false alarm —
reported exactly three, in two files, and both were genuinely confusing rather than false:

- `packages/fs/src/image.wac` declared `Vec<Mount> mounts` and then `i32 mounts` for the count, five
  lines apart, in one scope. It worked only because `fs.mounts = mounts` came first. Renamed to
  `mountCount`.
- `packages/platform/test/wac/waitany_test.wac` declared `Port quick`/`Port slow` and then
  `Daemon quick`/`Daemon slow`. Renamed the ports to `quickFree`/`slowFree`.

Both renames are in this commit, both packages green, and with them rung 3 is clean **with the fix
applied**. So whoever takes this has a corpus that does not fight them, and the position problem above
is the whole of the remaining work.

### A note on how this was measured, because it cost two wrong conclusions

`wac build` and `wac run` compile with the **prebuilt seed**, so every probe run through them was
measuring the checker *before* the edit and reporting clean. Two reductions were dismissed as "not
reproducing" on that basis. Only `wac test` on a file that imports `../../src/api.wac` compiles the
edited source. Anything measuring a `packages/wacc/src` change needs that route, or `deno task seed`
first.

## Fixed — agent-a, 2026-08-20

The plan above asked for a declaration *position* per name and a comparison against the position of
each use, "around thirty callers" of `typeOfName`, and floated merging the two passes as the cheaper
first move. Neither was needed. **Declare in both walks:**

- `declareConst`, on a same-scope clash, now **keeps the first type** instead of blanking it. That
  makes the collecting walk correct for every use *before* the redeclaration, which is the half the
  poisoning was protecting and the half the naive retype broke.
- `checkStmt`'s `Var` arm calls `setType` when it reaches the declaration. That makes it correct for
  every use *after*. `setType` already existed for exactly this — "retype an existing name, without
  the poisoning `declareConst` does" — and was written for narrowing.

Position-blindness is not solved so much as sidestepped: the checking walk *is* the position, and it
already visits the statements in order. Nothing needed a token index and no caller of `typeOfName`
changed.

`packages/wacc/test/wac/shadowtype_test.wac` — six tests, three of which fail without the fix. Two are
the controls that decide it is the right shape rather than merely a passing one:

    // before the redeclaration: must stay accepted
    i32[] items = i32[0](); h.items = items; i32 items = 3; return items;
    // after it: the new type is the live one
    export i32 f(i32 a) { S a = S(1); return a; }        // refused

### The const flags were the trap, and two spec cases found them

The first version also called `setConstFlags(name, isConst, false)` beside `setType`, which reads as
the obvious companion and is wrong: a local that aliases a const receiver is const **by alias**,
`markAliasOnly` records that separately, and resetting the flags unconditionally laundered it away.
`spec/cases/0006` and `spec/cases/0119` — both about exactly that laundering — went from refused to
accepted, which is the whole reason they exist.

So the fix sets the type and nothing else. A redeclared name keeps the first declaration's constness,
which is a residual inaccuracy in a program nothing writes (`const i32 a = 1; i32 a = 2; a = 3;` would
be refused where the reference allows it) and is recorded in the code rather than left to be found.

Rung 3 of `corpuscheck_test.wac` is clean, `spec/cases` is 223 of 223, and the spec answers are
419/419.

### Not fixed, and not part of this

Whether a same-scope redeclaration should be *legal* at all. Both compilers accept
`export i32 f(i32 a) { i32 a = 2; return a; }`, `spec/spec/naming.md` illustrates shadowing only with
a block, and `issues/lang/0014` closed the parameter-against-parameter case as an error — which is an
argument that this one is too. That is a language decision and this issue was about a missing
diagnostic, which is now present either way.
