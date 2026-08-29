# 0235a — written type arguments parse as a comparison, and the diagnostic says `found bool`

- **Status:** closed — `design/lang/0011` fixed the reproduction; the diagnostic it left is done
- **Fixed in:** `packages/wacc/src/check.wac` — a per-site hint where the name resolves to a
  function. Guarded by `packages/wacc/test/wac/codes_test.wac`.
- **Claimed by:** agent-b (2026-08-28)
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** diagnostic
- **Symptom:** wrong answer — a message that names neither the rule nor the intent

## Reproduction

```wac
struct Box<T> {
  T v;
  Box<U> map<U>(const this, fn[U(T)] f) { return Box<U>(f(this.v)); }
}
export i32 main() {
  Box<i32> b = Box<i32>(2);
  Box<i32> c = b.map<i32>((i32 x) => x + 1);
  return c.v == 3 ? 0 : 1;
}
```

    error: initialiser does not match the declared type
      --> m.wac:7:25
       |
     7 |   Box<i32> c = b.map<i32>((i32 x) => x + 1);
       |                         ^ expected Box<i32>, found bool

**The message is not wrong.** `spec/spec/generics.md` is explicit that there is no `max<i32>(x, y)`:
*"Angle brackets are type syntax only — the same ambiguity with less-than — and a call is an
expression, so inference is the whole interface."* So `b.map<i32>(…)` is `(b.map < i32) > (…)`, a
comparison chain, and its type really is `bool`.

It is also useless to the person who wrote it. Nothing in it says that angle brackets are not call
syntax, and `found bool` invites the reader to look for a boolean they did not write.

## Why it will be hit

Every language a reader is likely to arrive from spells this `f<T>(x)`. `design/lang/0010` — a method's
own type parameter — has this as its option C and rejects it *for this ambiguity*, so the language is
deliberately keeping a syntax that reads as something else. A deliberate trap earns a diagnostic that
names it.

It is also the first thing anyone tries when the inference form fails, and the inference form fails
today for exactly the case `0010` is about:

    error: nothing here wants a function, so this lambda has no type

So the likely sequence is: write the inference form, get told the lambda has no type, add the type
arguments to help, and get told the initialiser is a `bool`.

## What would help

A comparison whose right operand is a **type name** — `isStructName`, `isEnumName` or a primitive —
and which is immediately followed by `>` and a parenthesised argument list, is not a comparison anyone
wrote on purpose. That shape is narrow enough to name without guessing:

    error: type arguments are not written at a call
      --> m.wac:7:22
       |
     7 |   Box<i32> c = b.map<i32>((i32 x) => x + 1);
       |                      ^^^^^ `<` here is less-than, so this parsed as a comparison
       = help: a type argument is inferred from the arguments and the slot; see generics.md

The two halves are separable, and the first is most of the value: **detect the shape and say `<` is
less-than here**. Whether to name the inference rule in a help line is a smaller question.

## Not to be confused with

- `design/lang/0010`, which is the *language* question of where a method's own type parameter may come
  from. This issue is about the message for a syntax that is already settled as illegal.
- `issues/lang/0088` — a generic enum's variant cannot name its type arguments — which is a missing
  feature rather than a diagnostic.

## The underlying defect, measured: only a *struct* name was refused

The `found bool` message above is a symptom. What lets the comparison type-check at all is that
**wacc does not object to a type name in value position** unless the type is a struct:

| program | wacc | the reference |
| --- | --- | --- |
| `x < P` (a struct) | `a struct name is not a value` | `'P' is a struct, not a variable` |
| `x < i32` | **no diagnostics** | `undefined variable 'i32'` |
| `x < string` | **no diagnostics** | `undefined variable 'string'` |
| `x < E` (an enum) | **no diagnostics** | `'E' is a enum, not a variable` |

So three of four shapes are a **differential disagreement** in which wacc is the looser one — and the
emitter is what eventually notices, without a position:

    $ wac build run.wac -o r      # export i32 main() { i32 x = 5; return x + i32; }
    wacc: cannot emit run.wac — the exported function `main` is not in the module the emitter
          produced — unresolved name i32 on line 1

`check` says nothing about that program at all.

The guard is one condition in `typeOfExpr`'s `Ident` arm, and its own comment gives the reason that
generalises: *"It reaches expression position legitimately as the receiver of a static call, and that
arrives through the `Call` and `Member` arms rather than here."* True of an enum, whose value form is
`E.Variant`, and of a primitive, whose value forms are a cast and a static — both through those same
two arms. The condition asked about structs only.

**Why no differential caught it.** The corpus is this repository's own files and `spec/cases/*.wac`,
every one of which is meant to compile, and a bare type name in value position is not something anybody
writes on purpose. The generated sweeps grid operators over *typed operands*; their menu has no entry
for "a type name where a value goes". Same shape as `issues/lang/0180a` and `0170a`: the differentials
are made of programs that work.

### Incidental: the reference says "a enum"

`'E' is a enum, not a variable` — compiler/wacTypeCheck.ts. One article, in a message a user reads;
noted here rather than filed separately because it is a one-word fix in a file this issue already
touches.

## Fixed: the silent half. What is left is narrower

`typeOfExpr`'s `Ident` arm asked `isStruct` alone; it asks about all three kinds now, and the code's
message names the rule rather than one of its cases — `a type name is not a value` instead of `a struct
name is not a value`. Nothing pinned the old wording; the code number is unchanged.

So the four shapes above are all refused, and the original reproduction reports **three** diagnostics
where it reported one:

    error: initialiser does not match the declared type
    error: a type name is not a value            <- names the actual mistake, at the `i32`
    error: nothing here wants a function, so this lambda has no type

**What is left** is the first line. `found bool` is still emitted, because the parse really is a
comparison and its type really is `bool` — and a reader now gets a sentence that explains it two lines
down rather than nothing at all. The targeted message this issue proposed, *"`<` here is less-than, so
this parsed as a comparison"*, would replace a true-but-unhelpful line with an explanatory one, and is
worth its own decision now that the silent half is gone. Left open for that, at a lower value than when
filed.

`packages/wacc/test/wac/illtyped_test.wac` grows four rows — `x < i32`, `x < E`, `x < string`,
`x < P` — canaried by narrowing the condition back to structs, which fails exactly the first three.

### Two things fixed on the way past

- **compiler/wacTypeCheck.ts said "is a enum"**, because the article was hardcoded beside an
  interpolated kind. It picks `an` before a vowel now. The only test on that message asserts the
  `not a variable` tail, so the wording was free to fix.
- **`nameExists` listed `string` and `bool` on top of `isPrimitiveName`**, which already covers both —
  two dead clauses, and the reason I stopped to check whether the fix would catch `x < string` at all.
  `anyref` is the only name that helper does not list.

## Superseded by `design/lang/0011` — agent-a, 2026-08-26

The last section left the targeted message *"worth its own decision now that the silent half is gone"*.
That decision has been made, and it goes further than this page proposed.

`design/lang/0011` — *a call may name its type arguments* — was accepted with the operator on
2026-08-26 and lists this issue under **Gathers**. Under it, `<` after a generic function or method
name is **not** less-than: it introduces call type arguments. So this page's reproduction

```wac
Box<i32> c = b.map<i32>((i32 x) => x + 1);
```

stops being a comparison chain and becomes the thing its author meant. The premise of this issue — that
the language deliberately keeps a syntax reading as something else — no longer holds.

**Both halves are in 0011's plan**, so neither is work for this page:

- item 4, name resolution: a generic function or method before `<` binds the letters and checks the
  call in that world — the feature;
- item 5, the diagnostic: *"when the instantiation reading fails, name the rule and the escape rather
  than reporting a type mismatch on a parse the author did not intend"* — which 0011 calls, in as many
  words, "the other half of `issues/lang/0235a`".

**What stays here.** The measured half already landed: `typeOfExpr`'s `Ident` arm refuses a type name in
value position for all three kinds rather than for structs alone, so `x < i32`, `x < E` and `x < string`
are diagnosed where they were silent, with four rows in `illtyped_test.wac`. That is independent of 0011
and does not move with it.

Left open rather than closed because `found bool` is still what the current compiler says; it closes
when 0011's items 4 and 5 land, and 0011 is where the work is scheduled.

## Not affected: `issues/lang/0241a`

Checked at the same time, since both are about generics and both were parked as decisions.
`design/lang/0010` was decided as option C on 0011's strength, but 0241a's blocker is untouched by
either: its own last section names it as *"`C` holds one file's tokens"* — a template's body can only
be re-walked while its own file is the one being checked, and the interesting instantiations are
usually in another. Written type arguments change which letters are known, not which tokens are
loaded. 0241a stands exactly as it was.

## Re-measured 2026-08-28: the reproduction is fixed and one case of item 5 is left

`design/lang/0011` landed, so the program at the top of this page **compiles and runs**. `main()`
exits 0, which is the program's own assertion that the mapped value is 3 — checked by running it,
not by reading the checker.

    Box<i32> c = b.map<i32>((i32 x) => x + 1);     // was `expected Box<i32>, found bool`

So the headline defect is gone, and what is left is item 5 — the diagnostic when the instantiation
reading *fails* rather than succeeds. Measured, one program per way it can fail:

| written | today |
|---|---|
| `id<i32, i32>(1)` where `id` takes one | **`the wrong number of type arguments — id takes 1 type argument, and 2 were written`** |
| `plain<i32>(1)` where `plain` is not generic | `undefined type — unknown type 'plain'` |

The first row is exactly what item 5 asks for: it names the rule and the count. **The second is
still this issue.** It tells the author that their *function* is an unknown *type*, which names
neither the rule — angle brackets after a name are type arguments — nor the escape. A reader who
arrived from a language where `f<T>(x)` is ordinary gets a message about a type they did not write.

The fix is the shape `issues/lang/0233a` used the same day: a hint written for the site rather than
for the code, since `undefined type` is a general diagnostic and its own hint has to stay general.
The site has the name in hand and knows it resolved to a non-generic function, which is the sentence
worth printing.

## Done, 2026-08-28

    error: undefined type
     2 | export i32 main() { return plain<i32>(1); }
       |                            ^^^^^ unknown type 'plain'
       = help: `plain` is a function, and `<...>` after a name is a type argument list —
               write the call without them, or make `plain` generic

**The annotation is untouched**, because it is a clause: `§wac-diag-parse-bad-type-n7qm3xf` pins
*"unknown type 'foo'"* for this code. The explanation goes in the hint, which is not pinned — and
per site rather than per code, since `undefined type` is a general diagnostic whose own hint has to
stay general, and only the site knows the name resolved to a function.

**Both escapes it names are compiled**, not asserted: dropping the brackets, and making `plain`
generic. A hint offering a way out that does not work is worse than one offering none.

One negative case holds the line — a genuinely unknown type that is not a function keeps the code's
own hint, so the sentence cannot claim a function exists wherever a name is misspelled.
