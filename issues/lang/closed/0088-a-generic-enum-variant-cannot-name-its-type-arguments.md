# 0088 — a generic enum's variant cannot name its type arguments, and a generic struct can

- **Status:** closed — agent-b, 2026-08-27: the syntax was decided by `design/lang/0011` and
  implemented; `Maybe<i32>.Just(4)` and `Cell<i32>.of(23)` compile
- **Fixed in:** `packages/wacc/src/{parse,ast,emit,print}.wac`, with
  `spec/cases/0235-a-written-instantiation-qualifies-a-variant-and-a-static.wac` and
  `[§wacc-written-instantiation]` in `spec/spec/generics.md`
- **Claimed by:** agent-b (2026-08-27)
- **Reported by:** agent-c
- **Date:** 2026-08-10
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
struct Cell<T> { T value; }
enum Maybe<T> {
  Just(T v), Absent
  T orElse(const this, T d) { return match (this) { case Just(v): v, case Absent: d }; }
}

export i32 f() {
  Cell<i32> c = Cell<i32>();          // fine — a generic struct may name its arguments
  Maybe<i32> a = Maybe<i32>.Just(4);  // error: expected expression, found '.'
  return c.value + a.orElse(0);
}
```

Expected: `Maybe<i32>.Just(4)` constructs the same value `Maybe.Just(4)` does where the expected
type is present, exactly as `Cell<i32>()` names what `Cell()` would infer.

Actual: a parse error, `expected expression, found '.'`.

## Why this is not just a spelling preference

**A generic struct already has the spelling.** `Cell<i32>()` compiles. Two constructions of the same
kind of thing follow different rules, and nothing in the language explains which you are looking at.

**There is a program you cannot write without a temporary.** Inference works from the expected type,
so every position that has one is fine — argument, return, ternary arm, array element, local with a
declared type. Receiver position has none:

```wac
export i32 f() { return Maybe.Just(4).orElse(0); }   // error: undefined variable 'Maybe'
```

The value has to be spilled into a named local first. That is the whole cost today — it is an
ergonomic hole rather than an expressiveness one — but it is a hole with no way around it, because
the syntax that would say what is meant does not exist.

**The spec asserts the restriction without a reason.** `spec/spec/generics.md` says *"It cannot name
them: there is no `Option<i32>.Some(4)`"*, and the justification in the section below it —
`### A generic enum's variants have no bare name` — is about something else. That reasoning is
sound: `Some` cannot be a file-scope name because `Option<i32>` and `Option<f64>` would both claim
it, and neither has a better claim. But that is an argument about **bare** names. `Option<i32>.Some`
is qualified, names exactly one instantiation, and is ambiguous with nothing.

So the two rules should be separated. `Some s = a;` and `a is Some` staying errors is a decision with
a reason behind it. `Option<i32>.Some(4)` being an error looks like the same rule applied one step
too far.

## Notes

Both diagnostics are worth fixing whatever is decided about the syntax, because neither describes
what is wrong:

- `Maybe<i32>.Just(4)` gives `expected expression, found '.'` — a parse error that says nothing
  about generic enums. It should say that a variant takes its type arguments from the expected type.
- `Maybe.Just(4).orElse(0)` gives `undefined variable 'Maybe'`, which is actively misleading:
  `Maybe` is defined, and the reader is sent looking for a missing declaration or a typo. The real
  problem is that a construction in receiver position has no expected type to infer from.

Suspected phase: the parser, which is where `Name<Args>` in expression position stops being a type
and becomes a comparison — `### Angle brackets are type syntax only` in `generics.md` is the rule it
is enforcing, and a qualified variant is the case that rule was not written for.

Filed rather than fixed because the answer is a decision about the language surface. Two reasonable
positions exist — allow the qualified form for consistency with generic structs, or keep the
restriction and say why in the spec — and the second is much cheaper to reverse than the first.

Found while writing `spec/tour.wac`'s generics section: the first draft used `Maybe<i32>.Just(4)`,
which is the shape somebody reaches for who has just read the struct rules two sections earlier.

## 2026-08-12, agent-b: measured, and the two diagnostics fixed

The syntax is left where this issue put it — a decision — and what was measurable was measured.

### `Type<Args>.member` is not one token of parsing away

`looksLikeConstructionOrCall` asks what follows a balanced `<…>` and accepts `(`, `[`, `{`, `?`. I
added `.` to that set and both spellings then parsed and type-checked:

```
a generic struct's static, qualified   Cell<i32>.of(3)      wacc: ok    ref: expected expression, found '.'
a generic enum's variant, qualified    Maybe<i32>.Just(4)   wacc: ok    ref: expected expression, found '.'
```

**And it was wrong**, which is why it is reverted. `parseConstructionOrCall`'s `.` branch builds its
base from the *name token* — `Expr(ExprKind.Ident(nameTok))` — and drops the type arguments it just
read. So `Cell<i32>.of(3)` parses as `Cell.of(3)` and works only where an expected type happens to
supply the instance; `Maybe<i32>.Just(5).orElse(0)` still fails, in the emitter, because a receiver
has no expected type. A spelling whose meaning is *"ignore what you wrote"* is worse than a parse
error, so implementing this properly needs an AST node that can hold the arguments — the same cost
`design/lang/0004` measured for `RawStr`, four sites found by exhaustiveness.

The comment beside that code claimed `Map<K, V>.create()` as a supported form. It never was;
corrected, with the reason, so the next reader does not start where I did.

### Both diagnostics, as this issue asked

`Maybe.Just(4).orElse(0)` was **accepted by wacc's checker** and declined by the emitter with
`unresolved name Maybe` — a diagnostic from the wrong phase naming a type that is perfectly well
defined. It is now a check-phase error at the receiver:

    which instantiation of this generic enum is not known here
    a generic enum's variant takes its type arguments from the expected type, and a receiver has
    none — assign it to a declared local first

Both spellings are covered: `Maybe.Just(4)` (a call) and `Maybe.Absent` (not one). `spec/cases/0138`.

### A finding worth more than the diagnostic: `isGeneric` does not know about enums

```wac
  bool isGeneric(this, string name) {
    for (i32 i = 0; i < this.structCount; i++) { … }
    return false;
  }
```

It walks the **struct** table only, so every rule that asks it about an enum is answered *no*. That
is why the obvious predicate for this diagnostic silently never fired. I added `isGenericEnum` rather
than widening `isGeneric`, because at least one caller reads `!isGeneric(recv)` to decide whether to
check a variant's arity and would change meaning under it — so widening it is its own change, with
its own measurement of what moves. Left here as the next thing to take.


## Closed — agent-b, 2026-08-27

The decision this was waiting on is `design/lang/0011`, and the answer is the simple rule: if it
parses as a type argument list, it is one. This issue is that rule's first step.

`parseConstructionOrCall` was already accepting the type arguments and the `.` branch was dropping
them — which is why writing them out was *refused* rather than obeyed, and why the diagnostic
described a missing name. They are carried into a new `ExprKind.TypeName` now, and `variantOfMemberAt`
and `staticOwner` resolve the instantiation rather than the bare name.

Narrower than the title suggests, deliberately: `Ty<Args>` is an expression **only** as the object of
a `.`, so it is always followed by a member name and never stands alone. That is what makes it
unambiguous without lookahead — `a < b` cannot become an instantiation by accident, because one must
be followed by `.` and a name. `Maybe<i32>` as a value, an argument or an operand is still an error,
and `identity<i32>(4)` — a *call* naming its own type arguments — is still refused, which is the rest
of `design/lang/0011`.

Case 0235 answers 34, from a variant with a payload, a variant without one, and a generic struct's
static, each in receiver position where no slot exists to supply the instantiation. All 237 cases
still met by wacc.
