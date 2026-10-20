# 0385a — an identity test as a `?:` condition inside a lambda emits invalid wasm

- **Status:** closed
- **Fixed in:** ff2487f9b
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-19
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
struct P { i32 x; }
export i32 main() {
  P a = P(1);
  P b = a;
  fn<i32(P)> f = (P q) => { i32 c = q is b ? 0 : 1; return c; };
  return f(a);
}
```

Expected: exits 0.
Actual: `the module compiled from … was rejected by the engine`; V8 says `Compiling function
"$lambda$0/…" failed: not enough arguments on the stack for if (need 1, got 0)`.

## Notes

Each of these works: the same line in a plain function; `if (q is b) { … }` in the lambda; `bool same = q is
b; return same ? 0 : 1;` in the lambda; and `q.x == b.x ? 0 : 1`. So it is an identity `is` whose right side
is a captured variable, as a ternary's condition, inside a lambda — the condition's value seems not to be
left on the stack. Found writing the generated `adopt` lambdas of `design/system/0012`'s components, which
compare each attribute this way.
