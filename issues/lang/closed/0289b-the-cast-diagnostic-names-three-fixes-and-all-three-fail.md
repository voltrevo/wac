# 0289b — the cast diagnostic names three fixes for `i32` to `u8` and all three fail

- **Status:** closed — 2026-08-29, agent-b
- **Fixed in:** the commit closing this
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** diagnostic
- **Symptom:** compile error — the right one, with help that cannot be followed

## The reproduction

```wac
export i32 main() {
  i32 a = 65;
  u8[] one = u8[](a as u8);
  return one[0];
}
```

```
error: wrong cast operator for these types
    |                         ^^ from i32 to u8
    = help: `as` converts without loss, `as!` checks at runtime, `as~` takes the nearest value
```

The help names three operators. **All three are refused**, with the same message each time:

    u8[](a as u8)    error: wrong cast operator for these types
    u8[](a as! u8)   error: wrong cast operator for these types
    u8[](a as~ u8)   error: wrong cast operator for these types

## Why the advice cannot work

`u8` is not a value type. Asked to make one directly, the compiler says so and says it well:

```wac
u8 b = a as! u8;      // error: a packed type cannot be used in this position
```

So there is no `i32` → `u8` conversion for any operator to spell, and the message about *which
operator* is the wrong question. A reader following it tries all three, gets the same sentence three
times, and learns nothing about the actual rule — which is that `u8` exists as an array element and
not as a value.

**The code that provoked this was already correct.** The bare form is accepted and is the answer:

```wac
u8[] one = u8[](a);   // accepted; the element type does the narrowing
one[0] = a;           // so does an assignment
```

So the diagnostic fires on a program one character away from a working one and points away from it.

## What it should probably say

That `u8` is packed and a conversion to it is not something an operator spells — and that the value
is already accepted where a `u8` is wanted, which is the fix. The existing *"a packed type cannot be
used in this position"* is the sentence with the real rule in it; this position should reach it, or
say the same thing.

## Where

The cast check that emits `wrong cast operator for these types` in `packages/wacc/src/check.wac`,
which decides on the operator before asking whether the target is a type a value can have.

## How it was found

Writing a differential sweep for `string.isUtf8` — building a `u8[]` from a loop counter. Three
attempts at the cast, one per operator named in the help, before trying it without one. The cost was
small and the shape is the one worth recording: **unfollowable advice is worse than none**, because
it is read as authoritative and spends the reader's attention on the wrong question.

## Closed — it reports the rule now, 2026-08-29

The packed branch of the cast check reported `errWrongCastOp`, whose help lists the three operators.
It reports `errPackedPosition` instead — *a packed type cannot be used in this position* — which the
compiler already said when a packed type was asked for as a value, and which is the fact behind both:

    error: a packed type cannot be used in this position
     3 |   u8[] one = u8[](a as u8);
       |                     ^^ from i32 to u8
       = help: a packed type is an array's element type — a variable or parameter is `i32`

No new code and no new registry entry — the sentence with the rule in it already existed, and this
position now reaches it, which is what the section above asked for.

`packages/wacc/test/wac/typecheck_test.wac` holds it, asserting on the *codes* `dumpTypeErrors`
returns rather than on the words, so a rewording does not break it. **Both directions**: that the
packed code appears, and that the cast-operator one does not, because checking only the first would
pass if the old diagnostic appeared beside the new one. Canaried — with the report put back, it fails
with *codes were 16*.
