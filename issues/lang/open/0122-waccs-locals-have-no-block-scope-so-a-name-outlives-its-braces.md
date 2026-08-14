# 0122 — wacc's locals have no block scope, so a name outlives the braces it was declared in

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** compile error (a missing one) and, in the second reproduction, invalid wasm

## Reproduction

```wac
export void f() { { i32 q = 1; } i32 r = q; }
export void g() { for (i32 i = 0; i < 3; i++) { } i32 r = i; }
```

Expected: `undefined variable 'q'` and `undefined variable 'i'`, which is what the reference answers,
at the use.
Actual: wacc accepts both.

Found by a grid of twenty-six statement-shaped programs against the reference; twenty-three agreed.

**And a second reproduction, worse than the first**, added 2026-08-14:

```wac
export i32 f() {
  { i32 q = 1; }
  { string q = "a"; i32 r = q; return r; }
}
```

Expected: `type mismatch: expected i32, got string`, which is what the reference answers.
Actual: wacc emits **invalid wasm** — `CompileError: local.set[0] expected type i32`.

The mechanism is in `declareConst`: a name already in the table is not redeclared, its type is set to
`typeNone()`, and it returns. So the *second* `q` does not get a type — it blanks the first one's.
Everything the checker would say about `q` in that block is then unsaid, because a name with no type
is a name no rule can be wrong about.

That widens this issue considerably. It is not only that a name outlives its braces; it is that
**reusing a name in sibling scopes blinds the checker to both of them**, and the failure arrives as
invalid wasm rather than as a diagnostic. Sibling blocks reusing a counter or an index are ordinary
code — `{ i32 q = 1; } { i32 q = 2; }` compiles and runs correctly today, silently unchecked.

## Why the ladder does not see this, and what the spec does not say

Rung 3 reads **spec 83 of 83** and this bug is not among them, which is worth explaining rather than
treating as a contradiction.

`spec/spec/naming.md` states two rules about scope and wacc obeys the one it states positively:

> All name collisions at the same scope level are compile errors. **Block-scope shadowing is
> allowed.**

with `§wac-shadow-8u8qh2j` — `i32 x = 1; { i32 x = 2; x = 3; } return x;` returns 1. Both compilers
answer 1. `emit.wac` scopes locals correctly; it is `check.wac`'s name table that does not, and the
spec's case exercises the emitter's half.

**What the spec never says is the negative rule** — that a local's visibility *ends* with its block.
`{ i32 q = 1; } i32 r = q;` has no case because there is no sentence to write one against. So the
coverage number is honest and the gap is real at the same time, which is the shape
`a corpus cannot state what its format lacks` describes.

That makes this partly spec work. `design/lang/0003` puts the spec on wacc rather than on the
reference, so "the reference refuses it" is evidence about intent and not authority: somebody has to
write the sentence down. The obvious one — a name declared in a block is not in scope after it,
alongside the shadowing rule it is the other half of — is what both compilers' *emitters* already
implement and what the reference's checker enforces, so writing it costs nothing but the decision to
write it.

## Why it is not a two-line fix

`check.wac`'s locals come from **`declareAll`**, a pre-pass that walks the whole function body and
declares every local before any of it is checked — a `Block` recurses into it, an `If` declares both
arms, a `For` declares its init and its body. There is no scope stack: `clearScope` resets
`nameCount` to `globalCount` between *functions* and nothing narrows it within one.

The pre-pass is why the checker can answer a name's type wherever it appears without ordering the
walk, so removing it is not the fix either. Two shapes that would work:

1. **A high-water mark per block.** Record `nameCount` on entering a block and restore it on leaving.
   Cheap, and wrong with the pre-pass in place, because the pre-pass has already declared the inner
   names by the time the checking walk reaches the outer block — the mark would be taken after they
   exist.
2. **A scope tag per declared name**, written by `declareAll` (which knows the nesting it is
   recursing through) and compared at each use against the path the checking walk is currently on.
   Additive: the name table keeps answering types exactly as it does, and one more array answers "is
   it in scope here".

   **And the tag should be the block's own node, not a counter.** A counter has to be incremented
   identically by two independent walks — `declareAll` and the checking walk — and a numbering that
   drifts between them is a bug with no symptom until some program nests differently. Recording the
   `Stmt` of the enclosing block instead, and comparing with `is` against the stack of blocks the
   checking walk is inside, needs no synchronisation at all: a name is in scope exactly when the
   block that declared it is one of the blocks currently open. wac has reference identity for this.

   Note also that `declareConst`'s duplicate handling has to change with it — "already declared"
   must become "already declared *in this scope*", or the blinding above survives the fix.

## An attempt, how far it got, and the obstacle

Built and reverted on 2026-08-14. Recording it because the obstacle is structural and is not visible
until you are most of the way in.

**What worked.** Two arrays on `C` — `Stmt?[] nameBlock` recording the block each name was declared
in, and `Stmt?[] openBlocks` as a stack — plus `pushBlock`/`popBlock` at `case Block(body)` in both
`declareStmt` and `checkStmt`, and a scope filter inside `C`'s eight name-lookup loops. The lookups
are all methods on `C`, so the thirty-three call sites need no changes at all; scope-filtering inside
them makes every caller scope-aware at once. The loops also have to run **innermost-first**, since
two entries can now share a name and the nearest one answers.

That much is correct and was measured: `{ i32 q = 1; } i32 r = q;` becomes `undefined name`, the
sibling-reuse program above becomes a proper diagnostic instead of invalid wasm, and
`{ i32 q = 1; } { i32 q = 2; }` still compiles and still answers 3.

**The obstacle.** wacc then fails to compile its own source, at
`case Arr(elem): { string inner = typeOfTy(c, elem); … }` — because `case Nullable(inner)` a few
lines below binds `inner` as a pattern variable, and the two collide.

They collide because **a match arm is a scope with no `Stmt` to name it**. An arm is a `Case` struct
whose `body` is a `Stmt[]`, so both walks recurse into it with no block node to push, and everything
an arm declares is tagged with the enclosing block instead. Reference identity is the right idea and
there is nothing to take the identity *of*.

So the fix needs a scope tag that covers arms as well as blocks. A second parallel stack of `Case?`
with `blockOpen` consulting both is the least invasive shape, since `Case` is a struct and has
identity of its own; falling back to a counter for the arms would reintroduce exactly the
synchronisation problem the node identity was chosen to avoid. A name would then record both tags
and be in scope when **both** are open — leaving the case closes it, and so does leaving the block.

**The remaining constructs, settled by reading rather than left as a worry:**

- **`for` needs nothing new.** `case For(init, cond, update, body)` matches on the statement itself,
  so `s` is available as the tag and pushing it covers the initialiser — which is what makes the
  second reproduction at the top of this issue, `for (i32 i = 0; …) { } i32 r = i;`, report the
  undefined name it should.
- **`switch` is the same gap as `match`.** Its arms are `cases[k].body`, the same `Case`-with-a-
  `Stmt[]` shape, so whatever tags a match arm tags a switch arm too.

That is the whole of the design. What is left is writing it and running the suite in batches, which
is the part that wants a session with room: this changes the checker that compiles every package
here.

(2) looks right and is why this is an issue rather than a patch — it is a change to the shape of the
name table, and picking wrong is a rewrite rather than an edit.

## What it costs today

Only diagnostics: a program that relies on the leak is one the reference refuses, so nothing in this
repository can depend on it — the corpus sweep is clean. What is missing is the *error*, on a rule
every C-family programmer expects and a whole class of typos hits (using a loop variable after the
loop). `errUndefinedName` exists and fires; it just cannot see that a name has gone out of scope.

## Adjacent, and deliberately not fixed here

The same grid found wacc **stricter** than the reference in one place: two structs of the same name
in one file is `duplicate name at file scope` here and accepted there. That looks like wacc being
right and is left alone; it is noted so the next person running this grid does not read it as a
regression.
