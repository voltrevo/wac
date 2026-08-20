# 0165 — a field called as a method compiles clean and drops the whole function from the module

- **Status:** closed — the checker refuses it, and names the field and its type
- **Fixed in:** the commit this line arrived in
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** invalid wasm

Calling a struct *field* as if it were a method is accepted by both front ends with no diagnostic, and
the function containing the call is then **silently absent from the emitted module**. `wac build`
exits 0 and writes a module the engine accepts.

## Reproduction

```wac
struct P { i32 foo; }
export i32 main() { P p = P(7); return p.foo(); }
```

```
$ wac check p.wac
p.wac: 1 file(s), no diagnostics

$ wac build p.wac -o p --quiet ; echo $?
0

$ wac run p.wac
wac: p.wac exports no main, so name the function to run:
```

Expected: a diagnostic at `p.foo()` saying `foo` is a field and not a method — the same shape as the
one a genuinely missing name already gets.

Actual: no diagnostic, exit 0, and a module with no `main` in it. Counted in the bytes rather than
inferred from the message: the correct program (`return p.foo;`) has `main` three times in its 1,752
bytes and this one has it **zero** times in 1,611.

The name does not matter — `foo` behaves exactly as `len` does, so this is not the array/string
`len()` builtin leaking. A field that does not exist at all *is* caught:
`error: no such method` at the right column, from both `check` and `build`.

## Corrected 2026-08-20: it is wacc-only, and the differential *could* have caught it

This said "both front ends accept it, so the differential is blind to it". **That was wrong, and the
error was in how I asked.** `wacCompile` takes `(files: Map<string, string>, entry: string)` and
*returns* a `CompileResult` carrying `diagnostics`; it does not throw. My probe called
`wacCompile(src, { path })` — a string where a Map goes — and reported "no diagnostics" for
everything I gave it, including things the reference plainly refuses.

Asked properly, the reference refuses this at the checker:

    field called as a method      refused: struct 'P' has no method 'foo'
    correct field read            ACCEPTED

So this is a **wacc-only checker gap**, which makes it a worse bug and an easier one: the two
compilers disagree, and the checker differential that exists to notice exactly that did not, because
no file in its corpus calls a field as a method. That is a corpus gap rather than a shared blind spot,
and adding this three-line program to the differential's inputs is most of the fix for *finding* the
next one like it.

The reference's message is also the one to copy: `struct 'P' has no method 'foo'` names the struct and
the member, where wacc says nothing at check time and `cannot emit … no method Buf.len` at build time
in some paths and silently drops the function in others.

## Notes

**The emitter has the check; it just does not always reach it.** In a larger graph the same mistake is
a real error — porting `packages/fmt`'s coverage driver, `b.len()` on a `Buf` (which has a `len`
*field*) came back as `wacc: cannot emit … no method Buf.len`, with `wac check` clean beforehand. So
there are two bugs stacked here and they are worth separating:

1. **the checker is silent** where it should refuse — a field is not callable, and that is a type
   error, not an emit-time discovery;
2. **the emitter drops the function** instead of failing, in at least some cases. A path that cannot
   emit a function must be an error and not an omission, because an omission is indistinguishable
   from a program that never declared it.

The second is the dangerous half. `packages/wacc/test/wac/` has emit tests that assert a module's
*exports*; none asserts that every `export` in the source appears in the module, which is the
invariant this breaks and a cheap thing to check for the whole corpus.

Found while porting `packages/fmt/cov.ts` to wac (`issues/system/0161`), where the symptom was a
coverage report claiming the counter table and the counter dump described different modules.

## Fixed

```
$ wac check a08.wac
error: this is not something that can be called
  --> a08.wac:1:48
 1 | struct P { i32 v; } export i32 f(P p) { return p.v(); }
   |                                                ^ P.v is a field of type i32, not a method
```

**Where it was getting through.** The checker has an arm for a field *called* as a method, because a
field may legitimately hold a funcref — `sh.externalNames()`, and the whole of `Cli`. Both of its
guards are `heldArity >= 0`, and `funcrefArity` answers < 0 for an `i32` field, so a call on a
non-funcref field fell out of the bottom of that arm with nothing said. The emitter then declined the
function containing it, and until `wac build` learned to check its own exports that was silent too.

A generic's fields are not modelled, so an empty type there still means "not known" rather than "not
callable" — the same exemption the arms above take.

`spec/cases/0205-a-field-called-as-a-method.wac` is the case, in the corpus both compilers read:
**207 of 207 met by wacc**, and the reference's harness passes. The reference reports *struct 'P' has
no method 'v'*; wacc now names the field and its type, which is the more useful of the two.

Checked for false refusals across twelve packages — `sh`, `fs`, `http`, `json`, `tor`, `box`,
`crypto`, `quic`, `server`, `tty`, `git`, `wacc` — all clean, which matters because `Cli` is nothing
but funcref fields and `box` links 172 files.
