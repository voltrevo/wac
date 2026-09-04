# 0324a — `null as T?` type-checks and cannot be emitted

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** bug
- **Symptom:** `cannot emit` — a program the checker accepted

## Reproduction

```wac
export i32 main() { i32? f = null as i32?; return f is null ? 1 : 0; }
```

    $ wac check c.wac
    c.wac: 1 file(s), no diagnostics

    $ wac build c.wac -o c
    wacc: cannot emit c.wac — the exported function `main` is not in the module the emitter
    produced — cast to an unsupported type

Both halves of the type matter and neither is the cause:

| | check | emit |
|---|---|---|
| `i32? f = null as i32?;` | ok | **fails** |
| `Node? e = null as Node?;` | ok | **fails** |
| `Node? g = null;` | ok | ok |

So it is the **cast on the `null` literal**, not nullability and not the type it is cast to.

## Not nested nullables, which was how it was found

Looking for it, everything else about a `T??` emits cleanly — measured:

```wac
Node?? a = null;               // ok
Node   n = Node(7);
Node?? c = n;                  // ok — widening two levels
if (c!! is n) { … }            // ok — double unwrap
```

Only the cast fails, and it fails at one level as readily as two.

## Why it is worth a number rather than a note

`as` on a `null` is how a program writes *the outer is present and the inner is absent* — there is no
other spelling, because a bare `null` takes the outermost absence and a typed value widens to
present. So the one construct that reaches the middle state of a `T??` is the one that cannot be
built, and the checker says nothing.

Same class as `0323a`, filed an hour earlier: the checker accepts and the emitter cannot. Whether
the fix is to emit it or to refuse it at check time is the decision — refusing would make
`null as T?` unwritable and the middle state unreachable, so emitting is likely what is wanted.
