# 0323a — `await` on anything but a name is not refused, and fails to emit

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** bug
- **Symptom:** `cannot emit` — a program the checker accepted

## Reproduction

```wac
async i32 f() { return await 7; }
export i32 main() { return 0; }
```

    $ wac check l.wac
    l.wac: 1 file(s), no diagnostics

    $ wac build l.wac -o l
    wacc: cannot emit l.wac — a null in a Pending<i32> slot

The same for any operand that is not a name — `await (3 + 4)` behaves identically.

## The refusal exists and only fires on a name

```wac
async i32 f() { i32 n = 7; return await n; }
```

    error: this cannot be awaited

`[§wac-await-pending-9km2xtr]`, code 212, `errAwaitNotPending`. It is exactly right, and it is
reached only when the operand is an identifier — so `await n` is named and `await 7` is not,
although they have the same type.

## Why nothing caught it

`packages/wacc/test/wac/async_test.wac`'s
`test_awaiting_something_that_is_not_a_ticket_names_its_type` writes

```wac
async i32 f() {
  i32 n = 7;
  return await n;
}
```

— a variable, which is the shape that works. `design/lang/0014`'s A5 lists *"`await` applied to
something that is not a `Pending<T>` — named"* and records it as passing on 2026-08-30, and it does
pass: the test and the note are both about the case that is checked.

Same shape as `0319a` in this tree — the tagged example covers the half that works — and the fix is
likely one line, since the check appears to consult the operand's declared type through the name
table rather than the expression's own type.

## Not this

Not `await` outside an `async` function, which is code 211 and fires correctly. Not the emit
failure's wording, which is a symptom: the program should not reach the emitter.
