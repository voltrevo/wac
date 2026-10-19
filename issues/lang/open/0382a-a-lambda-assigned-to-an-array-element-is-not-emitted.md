# 0382a — a lambda assigned to an array element is not emitted

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-19
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Sys } from "std";
export i32 main(Sys sys) {
  fn<i32()> z = () => 0;
  fn<i32()>[] fs = fn<i32()>[].filled(2, z);
  fs[1] = () => 7;
  sys.log("\{fs[1]()}");
  return 0;
}
```

Expected: `7`.
Actual: `wacc: cannot emit … — the function \`__wacMain\` is not in the module the emitter produced — a
lambda (this module has 130, 1 in a position the walk does not type yet, 0 sharing a position key)`.

## Notes

The same lambda as an initializer, an argument (`filled(2, () => 7)`) or a struct field works. The slot is
an index assignment, which the positional lambda walk does not type.

**A variant constructor's argument is another such slot** (2026-10-19): `V.Comp(() => …, (Component old) =>
…, key)` is declined the same way — "4 in a position the walk does not type yet" — and works with each lambda
bound to a local first. 0383a, a lambda as a markup attribute, is a third.
