# 0331a — a fresh return loses its freshness when it is named

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** design question
- **Symptom:** compile error

`issues/lang/0060` replaced the blanket const taint on a call through a const receiver with a
freshness test: *"A call through a const receiver is const unless every `return` in the method is
fresh."* Freshness is decided by looking at the **return expression**, so the same value refuses to
be fresh once it has a name.

## Reproduction

```wac
struct C13 {
  i32 n;
  void bump(this) { this.n += 1; }
  C13 mk(const this) { C13 r = C13(this.n); return r; }     // 1 type error at the use below
  i32 use(const this) { C13 x = this.mk(); x.bump(); return x.n; }
}
export i32 probe13() { C13 c = C13(5); return c.use(); }
```

```wac
struct C14 {
  i32 n;
  void bump(this) { this.n += 1; }
  C14 mk(const this) { return C14(this.n); }                 // 0 type errors
  i32 use(const this) { C14 x = this.mk(); x.bump(); return x.n; }
}
export i32 probe14() { C14 c = C14(5); return c.use(); }
```

Expected: the same answer for both. `C13(this.n)` allocates a struct over one `i32` and nothing
about it aliases the receiver, whichever line it is written on.

Actual, through `deno run -A bootstrap/ts/ask_wacc.ts`:

```
p13.wac
  parse errors 0, type errors 1, module 1978 bytes
  probe13() = 6
p14.wac
  parse errors 0, type errors 0, module 1971 bytes
  probe14() = 6
```

Both run and both answer `6`. One is refused.

## Notes

**The rule is doing the job it was built for; the question is where it stops.** `0060`'s resolution
is explicit that this is *"a syntactic question with a conservative default rather than an escape
analysis"*, and lists what stays refused — returning `this`, wrapping the receiver's array in a
fresh outer array, an accessor handing back a field, a method with one fresh return and one leaky
one. A local is not on that list and behaves as though it were.

The conservative default is the right shape and the cheapest widening is probably: **a local whose
initialiser is fresh, that is never assigned again and never has a field written from anything
non-fresh, is fresh.** That is a use-def question inside one body rather than an escape analysis,
and the same table `0060` added to answer at the call site can carry it.

### Where it bit

`packages/bignum` is free functions — `add(a, b)`, never `a.add(b)` — for exactly this. Its README
and its file header both state the pre-`0060` rule as the reason:

> **Free functions, not methods.** … wac's deep-const rule makes the method form impossible to
> write. A `const this` method cannot use a value returned by another `const this` method — even one
> that was freshly allocated.

Every constructor in that package allocates a `u32[]` and fills it before it knows what it holds, so
it must bind a local — and binding a local is the one shape the fix did not reach. `0060`'s
resolution ends *"`packages/crypto/src/sha1.wac` can have its `clone` back, which is where this was
found"*: `sha1`'s clone returns a construction, so it was reached and `bignum` was not. Three weeks
later the package still says the language forbids what the language allows.

The escape is that a **static** has no receiver and so has nothing to taint: a static taking
`const Big` and returning a value built from a fresh `u32[]` checks clean. Which is to say the
supported way to write a method handing back a fresh value is to not make it a method.

### The spec still states the pre-`0060` rule

`spec/spec/structs.md` has not been updated. Its prose:

> Deep const cannot be laundered through intermediate values. A reference obtained *through* a const
> reference is itself const, **however it was obtained**

and the tagged clause:

> `[§wac-deep-const-accessor-w3kf8nq]` Calling a non-const method on the result of a method call
> made through a const receiver is a compile error.

The word *fresh* does not appear in that file. The tagged **example** is still correct — its
accessor returns `this.inner`, which is a leak — but the sentence generalises past it, and it is the
sentence `bignum`'s author quoted. `spec/cases/0119` pins the narrow half and nothing pins the
positive half, which is why the prose could drift without going red.

Two changes, and they are separable: the spec sentence should say what the compiler does whatever is
decided about the local, and the local is the design question.

### What is *not* this

`issues/lang/0052` and `0315a` — deep const escapable by passing the reference to a function with a
non-`const` parameter — reproduce from the same session's probes (`escape(this.inner)` from a
`const this` mutates, zero type errors, and the same for a `const` *parameter*). Both already open;
neither is what this asks about.
