# 0063 — a null test against a non-nullable type is not diagnosed

- **Status:** closed
- **Fixed by:** agent-a
- **Reported by:** agent-b
- **Date:** 2026-08-02
- **Kind:** diagnostic
- **Symptom:** no error

`x is null` and `x is not null` compile with no diagnostic when `x`'s type is not nullable. The
branch is then statically dead — always taken or never taken — and nothing says so.

## Reproduction

```wac
struct Box { i32 v; }

export i32 alwaysTrue(Box b) {
  if (b is not null) { return 1; }   // `Box`, not `Box?`
  return 0;
}

export i32 alwaysFalse(Box b) {
  if (b is null) { return 1; }
  return 0;
}
```

Expected: a diagnostic on both, in the spirit of `lossy cast not needed` — which already
refuses a cast the compiler can see is unnecessary.
Actual: `ok: true, diagnostics: 0`.

## Why it is worth a diagnostic rather than a note

This is not hypothetical tidiness. `packages/platform`'s capability world changed every
value-producing call from `T` to `Pending<T>` — `fn[string?(string)] env` became
`fn[Pending<string?>(string)] env`. That turns

```wac
return this.cli.env(name) is not null;      // meaningful before
```

into a tautology, because a `Pending<string?>` is a reference and is never null. The fix is
`.wait()`, and the compiler had no reason to ask for it.

**What makes it sharp is that the rest of that migration is compiler-guided.** Every other
misuse of a ticket is caught immediately and clearly:

```
struct 'Pending<string>' has no method 'len'
struct 'Pending<Stat>' has no field 'exists'
'+' requires numeric type, got Pending<i64>
condition must be bool
```

Field access, method calls, arithmetic and use as a condition all fail. `is null` is the single
hole in an otherwise well-signposted change, and it fails by inverting a boolean rather than by
stopping.

It found five instances in one package in one migration:

- `packages/sh/src/exec.wac` — `isSet` reported every name as set, so `${x-default}` stopped
  substituting. Two of 191 differential scripts caught it, and only because those two exist to
  tell *unset* from *empty*; the colon forms never consult it.
- `packages/sh/test/wac/probe.wac` — four more, in the function whose whole purpose is to
  exercise the capability stubs. It called fifteen and waited on none, so it had been reporting
  coverage it did not have.

## The obvious objection, and why I think it does not apply

Generic code that may be instantiated with a nullable `T` would be the reason to allow it. It
does not arise here: wac monomorphises, so nullability is known per instantiation, and every
legitimate null test in this repo is already on an explicitly nullable declaration. In
`packages/std/src/map.wac` the slot is declared `MapEntry<K, V>? e` and the check is honest. All
79 `is null` uses across wac-mono's `src` are of that shape.

If a case does exist, `T?` where `T` is already nullable would be the thing to define rather than
a reason to keep the test silent.

## Notes

An error rather than a warning would be my preference, on the same argument the spec makes for
`[§enum-variant-name-collision]`: a collision is a compile error rather than a silent surprise. A
statically-decided branch is the same kind of thing.

`is null` on a nullable type is of course unaffected, and so is `!` on one.

## Fixed, as a warning rather than an error

`§wac-nonnull-isnull-warn-2mkq7np`, in `spec/spec/types.md`.

```
warning: 'is not null' on Box, which is never null
   = help: drop the test, or make the type Box?
```

A warning, and the reason is worth recording because I started by making it an error and the
suite told me otherwise. `[§wac-nonnull-isnull-k8fn3wp]` already documented that a null test
on a non-null type is *allowed*, and it turns out to be load-bearing:

```wac
struct Slot<T> { T v; bool empty(const this) { return this.v is null; } }
```

That has to instantiate for nullable *and* non-nullable `T`. Erroring makes any such generic
uninstantiable for half its arguments — verified: `Slot<Point>` and `Slot<Point?>` both
compile today and only the second reports empty. The spec asserted the allowance without
saying why; it says why now.

A warning is also the shape the neighbouring case already has: `'X is Y' is always false —
the types share no ancestor` warns rather than refusing.

Zero warnings across `box`, `sh`, `ssh` and `std`, so no false positives on real code and no
tautologies left in the tree.

One thing that nearly went unnoticed: the first version of the check used
`nullableOf(lt) === null`, and `nullableOf` *makes* a type nullable rather than testing it —
it never answers null for a reference. So the diagnostic compiled, type-checked, and did
absolutely nothing. It needed `lt.kind !== "nullable"`.
