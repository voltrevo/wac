# 0060 — a value returned from a `const this` method stays const

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** 0cf90e66
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-c
- **Date:** 2026-08-02
- **Kind:** bug
- **Symptom:** compile error

A method with `const this` cannot hand back a freshly constructed value that the caller is
allowed to mutate. The constness of the receiver is applied to the return value, and it
survives being bound to a new local.

## Reproduction

```wac
struct Counter {
  i32 n;
  Counter create() { return Counter(0); }
  void bump(this) { this.n += 1; }
  Counter clone(const this) { return Counter(this.n); }
  i32 peek(const this) {
    Counter copy = this.clone();
    copy.bump();
    return copy.n;
  }
}
export i32 run() { Counter c = Counter.create(); return c.peek(); }
```

Expected: compiles. `clone` returns a new `Counter` built by the struct literal; nothing
about it aliases `this`, and `copy` is a fresh local.

Actual:

```
8:5 [typecheck] cannot call non-const method 'bump' through const reference
```

## Notes

The value is not a reference to the receiver — it is a struct literal over one `i32`. So
this is not the constness rule doing its job on an aliasing return; it is the return value
inheriting a property of the receiver it has no connection to.

Binding to a local does not clear it, which is what made it look like a propagation rule
rather than an expression-level one. I did not narrow down whether the taint is attached at
the call site or carried in the type.

Worth checking whether a non-struct return is affected too: `i32 size(const this)` used in
an arithmetic expression would show it, and if that is also tainted then the rule is on the
call rather than on struct returns specifically.

## Where it bit

`packages/crypto/src/sha1.wac` in wac-mono. SHA-1 there has a `peek(const this)` that has to
duplicate the state and finalise the duplicate, because Tor's relay digest must be readable
without ending the stream. The natural spelling is `clone` plus `peek` calling it; instead
`peek` open-codes the copy so that `finish` — which mutates — has an untainted value to work
on. The duplication is four lines and harmless, but the two now have to be kept in step by
hand.

Not urgent: the workaround is local and obvious once you know the rule. It is filed because
the error message points at the mutating call rather than at the `const this` that caused
it, so the next person meets it as "why can't I mutate my own local".

## Resolution

The taint was at the call: `exprIsConst` said a call through a const receiver yields a const result,
full stop, and its own comment admitted the approximation — *"a const accessor returning a fresh
object is also treated as const"*. The notes above asked whether a non-struct return is affected too;
it is not, because only a reference can carry constness, which is why `i32 size(const this)` never
showed it.

The rule asks what the method can hand back now. A construction is **fresh** when every field that
could hold a reference is built from something fresh in turn:

* `Counter(this.n)` — fresh. An `i32` field is a copy whatever built it.
* `Box(this.i)` — not fresh. Writing through that field writes through the receiver.
* `Box(Inner(this.i.x))` — fresh again, one level down.

A call through a const receiver is const unless every `return` in the method is fresh. Anything else
is not fresh, a nested call and a named construction included: a syntactic question with a
conservative default rather than an escape analysis.

Still refused, and checked as cases and probes: returning `this`, wrapping the receiver's array in a
fresh outer array, an accessor handing back a field, and a method with one fresh return and one leaky
one.

**Two things worth keeping from doing it twice.** `spec/cases/0119` — the half that must keep failing
— was written as `this.peek().x = 9` and passed for the wrong reason: a call is not an lvalue in wac,
so it was a *parse* error. It binds to a local now. And in wacc the answer cannot be computed where
the methods are declared: the field types it asks about are not all known yet, and doing it there
reported 38 working files at one position in the linked blob. The table holds each method's body and
answers at the call site instead.

`packages/crypto/src/sha1.wac` can have its `clone` back, which is where this was found.
