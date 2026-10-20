# 0384a — a `virtual` method returning `void` does not parse

- **Status:** closed
- **Fixed in:** ff2487f9b
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-19
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
struct B {
  virtual void a(this) {}
}
export i32 main() { B x = B(); x.a(); return 0; }
```

Expected: compiles; `a` is a virtual method returning nothing.
Actual: `error: a keyword cannot be used as a name`, at `void`.

## Notes

`virtual i32 a(this)` parses, and so does a plain `void a(this)`. Nothing in `spec/` or `packages/` writes
`virtual void`, which is presumably why it was never noticed; spec ch12's virtual-method examples all return
`i32`. A lifecycle hook — `virtual void unmounted(this)` in `design/system/0012`'s components — is the first
place that wants one.
