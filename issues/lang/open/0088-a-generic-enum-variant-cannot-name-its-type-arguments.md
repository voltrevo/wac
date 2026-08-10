# 0088 — a generic enum's variant cannot name its type arguments, and a generic struct can

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
