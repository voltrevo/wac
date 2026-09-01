# 0315a — a const reference is laundered through any non-const slot, and the write lands

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-01
- **Kind:** bug
- **Symptom:** wrong answer — a value reached through `const this` is mutated at runtime

## Reproduction

```wac
struct Inner {
  i32 val;
  void mutate(this) { this.val = 1; }
}

void poke(Inner i) { i.mutate(); }

struct Outer {
  Inner inner;
  void t(const this) { poke(this.inner); }
}

export i32 main() {
  Outer o = Outer(Inner(0));
  o.t();
  return o.inner.val;
}
```

    $ wac run r.wac ; echo $?
    1

Expected: a compile error at `poke(this.inner)`. Actual: it builds, it runs, and the field reached
through a const receiver holds 1.

## Four slots, one hole

The direct case is caught. Everything that puts the reference somewhere first is not:

| what | today |
|---|---|
| `this.inner.mutate()` | **refused** — `a non-const reference cannot be taken from a const one` |
| `poke(this.inner)` where `poke` takes `Inner` | accepted, and the write lands |
| `Inner[] a = Inner[](this.inner); a[0].mutate();` | accepted |
| `Box b = Box(this.inner); b.it.mutate();` | accepted |
| `hop<Inner>(this.inner)` for `void hop<T>(T x)` | accepted |

They are one missing rule rather than four bugs: **a const-tainted reference may flow into a
non-const slot.** Argument positions, array elements, struct fields, type arguments.

## Two of them contradict a written claim

`spec/spec/structs.md`, `[§wac-deep-const-alias-p6mk2wf]`, already says the reference "may not be
stored into a struct field or array element (which would make it reachable as mutable)". So the
array and field rows are gaps against the spec, not open questions. The argument rows are the same
rule at a position the spec does not enumerate.

## The escape hatch already exists, which is why this is worth fixing rather than weakening

`const` is already a real parameter qualifier and it is already enforced:

```wac
void poke(const Inner i) { i.mutate(); }
```

    error: a non-const reference cannot be taken from a const one

And a non-const argument already widens to a const parameter — `Inner m = Inner(7); peek(m)` builds
against `i32 peek(const Inner i)`. So when the checker starts refusing `poke(this.inner)`, the fix at
each site is to write `const` on the parameter, and **every existing caller keeps working**. No
function has to be written twice, and the change cannot strand a caller.

## Generics are the part to think about first

`hop<Inner>(this.inner)` is the row without an obvious spelling: there is no `const T` to write that
means "const if the argument was". But wac checks a template twice — once as a template and once per
instantiation — so the body is re-checked against the actual argument each time, and an instantiation
whose body mutates a const argument can simply fail there. That gives const-polymorphism without a
qualifier, which is the thing C++ needs `const T&` overloads for.

The cost is where the error appears: inside the instantiated body rather than at the call. That is a
diagnostic-quality problem rather than a design one, and it is the usual complaint about
template-instantiation errors.

## Why it matters beyond the rule

Deep const is one of the few things wac promises that most systems languages do not, and the promise
is currently checkable only in the shape the spec's own example uses. Anything a real program does
with a value — hand it to a helper, put it in a list, keep it in a struct — takes the constness off.
