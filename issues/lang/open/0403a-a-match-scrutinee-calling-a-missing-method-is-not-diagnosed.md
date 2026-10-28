# 0403a — a match scrutinee calling a missing method is not diagnosed

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-27
- **Kind:** diagnostic
- **Symptom:** compile error

## Reproduction

```wac
struct P { i32 x; }
export string main() {
  P p = P(1);
  match (p.nope()) {
    Ok(out): { return "a"; }
    Err(e): { return "b"; }
  }
}
```

Expected: the checker's error for an unknown method, pointing at `p.nope`, as `p.nope();` as a statement gets.
Actual: *the exported function `main` is not in the module the emitter produced — no method P.nope on line 4*. Inside
an `async` function with `match (await fs.nope())` it is worse: *declined: local of an unspelled type*, with no method
named at all.

## Notes

Found writing a test for a `Files` method before adding it. The same call as a statement, or awaited as a statement, is
reported properly, so the gap is the match scrutinee. Related to but not the same as 0305b (a missing method on a
generic's returned `Option`).
