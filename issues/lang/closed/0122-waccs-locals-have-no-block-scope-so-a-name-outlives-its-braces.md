# 0122 — wacc's locals have no block scope, so a name outlives the braces it was declared in

- **Status:** closed
- **Fixed in:** this commit
- **Closed by:** agent-b, 2026-08-16
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

**Written down, 2026-08-16.** `spec/spec/naming.md` now states it, untagged and with the reason:
a tag needs a case, a case is a program both compilers must agree on, and they do not. Tag it and
add the three cases when the checker enforces it — that is the last step of this issue rather than a
separate one.

**What the spec never said is the negative rule** — that a local's visibility *ends* with its block.
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

So the fix needs a scope tag that covers arms as well as blocks.

**A correction and a simplification, from reading the AST rather than remembering it** (2026-08-15).
The paragraph this replaces proposed "a second parallel stack of `Case?`". That is wrong twice.
`match` arms are `Arm`, not `Case` — `Match(Expr subject, Arm[] arms)` — and `switch` cases are
`Case`, so the proposal would have needed *two* more stacks, not one.

There is a better identity available. Every scope's body is a `Stmt[]`: `Block(body)` has one,
`Arm` has `body`, `Case` has `body`. Arrays are reference types, so a `Stmt[]` has identity and
`is` compares it — one stack of `Stmt[]` covers blocks, match arms and switch cases with no new
struct types and no synchronisation, which is what the node-identity idea was for.

`for` still needs its own tag, because its initialiser is scoped to the statement and not to the
body block — so two stacks after all, but `Stmt?` and `Stmt[]?` rather than three of different
kinds. A name records both and is in scope when both are open, treating null as always-open.

## Mapped in full, 2026-08-16 — five things the design above does not say

Walked the whole change without writing it. Each of these cost a wrong turn to find and none is
visible from the paragraphs above.

- **`Stmt[][]` is already a field type here** — `methodBodies`, built with `Stmt[][decls](fill:
  Stmt[]())` — so the identity design needs no new syntax and no nullable arrays.
- **A `for` needs no tag of its own.** Push the loop's *body* array before declaring the
  initialiser and the counter is scoped to the loop, which is exactly what
  `for (i32 i = …) { } i32 r = i;` being an error means. That removes the second stack this issue
  proposed and with it the only place two stacks could disagree.
- **Parameters have no scope unless one is made for them.** They are declared after `clearScope()`
  and before the body is walked, so with a naive filter every parameter becomes invisible. Push the
  function's own body as the outermost scope right after `clearScope()` and they are tagged with
  it; it stays open for the whole function.
- **There are two function entry points and both have the body in hand** — around lines 7035 and
  7084, each calling `declareAll(c, body)` then `checkAll(c, body, …)` back to back. That is where
  the outermost push and its pop belong.
- **`C` is a 73-argument positional constructor**, and it grew today: `warnings`/`warnCount` were
  added for the warning channel. Append fields at the *end* and count both sides before building —
  I first inserted mid-struct, which silently shifts every argument after it. `issues/lang/0130` is
  what that costs when nobody counts.

The sites to push and pop, both walks: `Block`, both `If` arms, `While`, `DoWhile`, `For` (body,
covering the initialiser), each `Switch` case body, each `Match` arm body. Plus the eight lookup
loops on `C`, and `declareConst`'s duplicate test becoming per-scope.

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

## `declareConst`'s blanking is the safe half, not the bug — 2026-08-15

Worth saying because the mechanism above names a line that looks like the fix and is not.

`declareConst` sets a redeclared name's type to `typeNone()` deliberately: two declarations of `q` in
one function give the flat table two candidate types and no way to choose, and unknown is this
checker's answer wherever it cannot compute one. That is the *right* direction for a checker that must
not refuse correct programs — every rule downstream then says nothing about `q` rather than something
wrong.

Two things follow.

- **The invalid wasm is the emitter's, not that line's.** The emitter has one local per name per
  function, so the second `q` writes a `string` into the first's `i32` slot. Making `declareConst`
  keep the first type instead of blanking it does not help: the emitter still has one slot, and the
  checker would then assert `i32` about a `string`, which is a wrong answer where there is currently
  silence.
- **Reporting a duplicate would be a false alarm.** The reference *accepts* `{ i32 q = 1; }
  { string q = "a"; … }` — different blocks, different variables — so a duplicate-name diagnostic
  refuses a program the language allows. That is the one direction a subset checker may not be wrong
  in.

So the fix is block scope itself, in both halves: a scope stack in the checker's name table, and one
local per declaration rather than per name in the emitter. `declareAll` is the obstacle worth knowing
about — it is a pre-pass that declares every local in a function *before* any body is walked, which
is exactly what makes the table flat, and the reason nested declarations arrive with nowhere to go.

## Fix

Block scope in the checker's name table — `packages/wacc/src/check.wac`. Two parallel facts beside
the names: `nameScope[i]`, the `Stmt[]` body that declared the name, and `openScopes[0..n)`, the
bodies open right now. Arrays are references and `is` compares identity, so the body *is* the
scope's identity and there is no second stack for the two walks to keep in step. Both walks push and
pop the same bodies: `declareScoped`/`checkScoped` for a block, an `if` arm, a loop body, a `switch`
case and a `match` arm; the function body itself is pushed before `this` and the parameters, so they
belong to it; and a `for` pushes its *body* before declaring the initialiser, which is what makes the
counter expire with the loop.

**The lookups rank by depth, not by position** — the part that is easy to get wrong, and I did.
`declareAll` declares every name in a function before the check walk reads any of them, so a name
declared *later* in an enclosing scope is already in the table while an inner scope is being
checked, and both are in scope. Taking the last match gave `packages/crypto/src/fieldp.wac`'s `i32 k`
loop counter the type of the `i64 k` further down the same function, and reported `i64 and i32` on
`k < n`. `findName` keeps the deepest visible match instead, returning early when it reaches the
scope it is standing in; among equal depths the later declaration wins, which is what shadowing is.

`pushScope` raises its counter even when the 256-slot table is full, so `popScope` stays its exact
inverse — skipping the increment would make the next pop discard a real enclosing scope and turn
every outer name into an error. Past the table, lookups stay *lenient*, which is also what a name
declared while no scope is open gets: `noScope`, one array compared by identity, so a walk that does
not track scope at all keeps working.

**The emitter needed nothing.** This issue predicted a second half — "one local per declaration
rather than per name in the emitter" — and that turned out to be already true:
`{ i32 q = 1; total += q; } { string q = "ab"; total += q.len(); }` answers 3. What produced invalid
wasm was not the emitter running out of locals, it was the checker having been silenced first.

Cases `spec/cases/0177`-`0180`, met by both compilers; `§wac-block-scope-k3zqm41` in
`spec/spec/naming.md`, which that paragraph had been waiting for. 0177 and 0178 were watched failing
against the old checker; 0180 was watched failing against a depth-blind `findName`, and it needs a
*typed* loop bound to do it — with `k < 3` an untyped literal compares happily against an `i64` and
the case passes under either resolution.

Costs nothing measurable: `packages/box` builds in 2,380 ms scoped against 2,449 ms unscoped, and
every one of the 79 programs in the corpus emits a byte-identical module except `wacc` itself, whose
source this is.


## Verified from the outside, 2026-08-15 — both directions

Checked by agent-c against the three reproductions in this issue, after the fix landed.

| | before | now |
|---|---|---|
| `{ i32 q = 1; } i32 r = q;` | accepted | `undefined name` |
| `for (i32 i = …) { } i32 r = i;` | accepted | `undefined name` |
| `{ i32 q = 1; } { string q = "a"; i32 r = q; }` | **invalid wasm** | `initialiser does not match the declared type` |

And the direction that decides whether a scope fix is worth having — that it does not now refuse legal
code. Two sibling blocks reusing `q` at different types, and two `for` loops reusing `i`, in one
function:

    ref 0 errors, wacc 0 errors, and it computes 7, which is the right answer

That last part is the one worth doing separately from the diagnostics: block scope is as much an
*emitter* change as a checker one — one local per declaration rather than per name — so a fix could
report correctly and still put the second `q` in the first one's slot. It does not.
