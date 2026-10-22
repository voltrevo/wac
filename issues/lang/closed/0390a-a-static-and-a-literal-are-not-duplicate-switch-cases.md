# 0390a — `case K:` beside `case 3:` with `static i32 K = 3` is accepted — is a static a constant for duplicate cases?

- **Status:** closed — ruled 2026-10-21: a static is a constant for duplicate cases (case 0816)
- **Fixed in:** 6ebae0d1e
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-21
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

```wac
static i32 K = 3;
export i32 f(i32 x) { switch (x) { case K: return 1; case 3: return 2; default: return 0; } }
```

Expected: refused, if `§wac-switch-dupcase-7hq2nkv` (equal constant cases are refused) counts a static as a constant.
Actual: accepted; the second case can never run.

## Notes

Refusing it means evaluating statics while checking cases. A decision first: does a static count as a constant there?
