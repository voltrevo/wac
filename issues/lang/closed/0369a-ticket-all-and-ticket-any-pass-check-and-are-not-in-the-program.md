# 0369a — `Ticket.all` and `Ticket.any` pass `wac check` and are not in the program the emitter builds

- **Status:** closed
- **Fixed in:** a82df655c
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** missing feature
- **Symptom:** check clean, build exit 1

## Reproduction

```wac
import { Ticket } from "core";
async i32 one() { return 1; }
export i32 f() {
  Ticket<i32> a = one();
  Ticket<i32> b = one();
  Ticket<i32> w = Ticket.any(a, b);
  return w.wait()!;
}
```

Expected: Builds — spec ch35 defines both.
Actual: `wac check` is clean; the build says *no static Ticket<i32>.any* — `core/ticket.wac` declares neither `any` nor `all`, and the checker does not notice the static is missing. Through a larger program, *a call to `Ticket<i32>.any` … which is not in the program*. Spec ch35's own `allSettled` example fails with *unresolved name Ticket*.

## Notes

From `vision/IDIOMS.md`'s `Ticket.all` idiom and `vision/TECHNICAL.md`'s *`Ticket.any`'s losers keep running*.

Why check is clean: any missing method named through a generic's template passes the checker — 0371a.

## Design (agreed with the operator, 2026-10-14)

`Ticket.all` is ordinary wac in `core`, not a compiler built-in: a variadic parameter (ch14), a tuple filled
member by member under `static_for` (ch14, ch31), and `core`'s computed type `Values<Ts>` (ch30), which maps
each `Ticket<A>` to `A` through `typeof(hypothetical<type(t)>().value())`. Spec ch30 and ch35 carry the code.

What that needs, in order:

- `typeref.tuple(ts)` and the rename of `members()` to `tupleMembers()` — done.
- `typeof(e)` (ch30 `§wac-typeof-cxgjqjz`) — not started. The evaluator spells types but cannot type an
  expression, so it needs the checker's typing inside static evaluation.
- `hypothetical<T>()` in `core` (ch37) — a one-line function; trivial once `typeof` exists.
- Bugs found probing the pieces, each its own failing case first: a tuple local filled member by member and
  returned (`Ts out; static_for … out.[i] = ts.[i];`) gives a module the engine rejects; so does
  `async Ts all<Ts>(Ts ...ts) { return ts; }`.
- Where `all` lives: `Ticket<T>` is generic, so `Ticket.all(a, b)` names a method of the template with `T`
  bound by nothing. Undecided between a method on `Ticket` that ignores `T`, one on `TicketBase`, or a free
  function.

`Ticket.any`'s type is open: ch35 says it settles with the first; `vision/vibes/QUESTIONS.md` has it answer
`(i32, union<A, B>)`, the winner's index and value.

## Progress, 2026-10-14

Done: `typeref.tuple`, `tupleMembers`, `typeof`, `hypothetical`, `Values` (c41cbed20, 6d0bb8e79), and the tuple
and async faults the body hit (136eb8e0f, b72d76f05). `all`'s body runs as a function in a program, awaiting
`TicketBase`s rather than awaiting inside a `static_for` (0372a). Left: where `all` lives in `core`, and
`Ticket.any`'s type — both the operator's call.

## Decided, 2026-10-14

- **Where `all` lives:** a method with no receiver on `Ticket<T>` that does not use `T`. The rule is a
  loosening of inference: a type parameter that nothing uses needs no binding, so `Ticket.all(a, b)` works for
  the reason `Map.create(hashString, stringEq)` does. Using `T` means the signature, `T` written in the body
  (`Ticket<T>.x()` included), `typeref(T)`/`typeof`, or a `static` local. wac has no unqualified sibling calls,
  so there is no hidden use.
- **`any`** answers `union<A, B, …>` of the tickets' answer types, the value of the first to settle.
  **`anyWithIndex`** answers `(i32, union<…>)`, the winner's index and value, since a union of two equal
  types cannot say which won. Both need `typeref.union(ts)` beside `typeref.tuple(ts)`.

Order: 0371a (done, 4eea044cd), the unused-`T` rule, `typeref.union`, then `all`, `any`, `anyWithIndex` in `core`.

## Done, 2026-10-14

`Ticket.all`, `Ticket.any` and `Ticket.anyWithIndex` are static methods of `Ticket<T>` in `core/ticket.wac`
that write no `T`, called on the bare template (ch19 `§wac-generic-unused-param-unbound-k4p2xqz`, d71c39dab).
`any` answers `AnyValue<Ts>`, the union of what the tickets answer, built with `typeref.union` (08ac7843c).

They are **driven rather than `async`**: each answers a ticket whose `drive` steps the tickets not yet
settled, so a `wait` refuses exactly when none can move. `any` learns which settled first from a
`whenSettled` hook on `TicketBase`, called by `settleWith`; driving later cannot tell the order. An `async`
static is not lowered at all (0375a), which is what prompted the change. Cases 0524–0526; ch35's `allSettled`
example is met.
