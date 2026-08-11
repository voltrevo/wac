# 0086 — a template instance named only by a generic function's return type has no methods

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** 7e5db6ae
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-b
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
enum Opt<T> {
  Some(T v), None
  T orElse(const this, T d) { return match (this) { case Some(v): v, case None: d }; }
}

Opt<U> mapOpt<T, U>(Opt<T> o, fn[U(T)] f) {
  return match (o) { case Some(v): Opt.Some(f(v)), case None: Opt.None };
}

string d2(i32 x) { return "n"; }

export i32 f() {
  Opt<i32> o = Opt.Some(1);
  return mapOpt(o, d2).orElse("?").len();     // Opt<string> exists only here
}
```

Expected: `1`.

Actual: `struct 'Opt___main$string' has no method 'orElse'`.

## Notes

**Adding `Opt<string> unused = Opt.None;` anywhere in the file makes it compile**, which is the whole
diagnosis: the instance is built either way — its fields are there, since the error is about a method
on a struct that exists — but its *methods* are only instantiated when something other than a
generic function's return type names it.

Not specific to `orElse`: `isNone()` fails the same way, so it is every method of the instance rather
than one.

`Opt<U>` is inferred correctly — the error names `Opt___main$string`, so `U` was bound to `string`.
What is missing is the step that walks the instance's methods afterwards.

Found while giving `packages/wacc` generic functions; it instantiates the methods for this case, so
the two compilers disagree here on purpose until this is fixed. wacc's sweep writes the extra
`Opt<string>` so the program is one both compile.

## Resolution

The diagnosis in the notes was right and one step short of the cause. The instance was not built
without its methods — it was **built and never placed**. Monomorphisation puts the materialised
copies into their file in one loop, and that loop runs before the generic *functions* are
substituted; substituting a function materialises structs of its own, so anything first named by a
generic function's return type is made after the only pass that would have placed it. Dumping the
items after monomorphisation shows it plainly: `Opt__main$i32` is there with its method, and
`Opt__main$string` is not there at all.

Which is also why `Opt<string> unused` anywhere in the file fixed it: that made the instance during
the *struct* phase, in time for the placement.

The placement is a function now, called where it was and again at the end of the function phase,
skipping what it has already placed. Structs and enums alike, and every method rather than one.

Cross-file works too — the template and the generic function in a second file, the instance made in
that file and imported back — because the import injection at the end of the function phase already
covered it.

`spec/cases/0114`.
