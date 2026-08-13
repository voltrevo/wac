# 0120 — wacc cannot call a method on a payload-less enum variant, and it makes the site suite red

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-13
- **Kind:** missing feature
- **Symptom:** compile error

A method called on a payload-less variant used as a value compiles under the reference and is
refused by wacc. Nine lines:

```wac
enum Shape {
  Point,
  Circle(f64 r),

  bool isFlat(const this) {
    return match (this) { case Point: true, case Circle(_): false };
  }
}
export bool main() { return Shape.Point.isFlat(); }
```

```
$ deno task wacx  run x.wac main     →  true
$ deno task waccx run x.wac main     →  wacc cannot compile this yet — no method Point.isFlat
```

The refusal is honest and by name, which is the emitter behaving as designed — `Shape.Point` is a
value rather than a call, and wacc is not finding the enum's method surface from it.

## Why this is filed rather than fixed in place

**It makes `site/tools/site.test.ts` red for everyone**, which is the boundary
`issues/README.md` names. `2c9dd3d3` moved the playground to wacc, and the playground ships an
`enums.wac` example whose last line is `Shape.Point.isFlat()` — so:

```
site: every playground example compiles ... FAILED
  1 of 27:
    Enums and match (Enums) — examples/enums.wac:1:1 wacc cannot emit this yet: no method Point.isFlat
```

Two tests fail on the current tip. Verified pre-existing rather than assumed: the same two fail with
my own working-tree changes stashed.

## The second failure is a different thing wearing the same coat

`site: the two surface snippets emit byte-identical wasm, as the page says` also fails —
`1137 bytes from wac, 2493 from wapy`. That one is **not** drift in the snippets, and the page's
claim is not false. The test compiles `a.wac` and `a.wapy` through the site's own `compile()`, which
now prefers wacc; wacc has no wapy front end, so the pair is compiled by *two different compilers*
and the byte comparison measures the compilers rather than the surfaces.

The test's own comment says it goes red "if the pair ever drifts — someone edits one side, or the
printer changes". A third way in has appeared: the premise that one compiler answers both stopped
holding, silently. Whoever fixes it should decide which invariant is wanted — both surfaces through
the same compiler, which is what the sentence means, or the pair pinned per compiler — rather than
adjusting the byte count until it passes.

## What "done" would mean

1. `Shape.Point.isFlat()` emits under wacc, and a spec case covers a method reached through a
   payload-less variant.
2. `site/tools/site.test.ts` is green on a clean checkout, both tests.
3. The surface test compares like with like, with a comment saying which compiler it pinned and why.

The oracle is the reference, which accepts the program above.
