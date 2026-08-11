# 0060 — a value returned from a `const this` method stays const

- **Status:** open
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
