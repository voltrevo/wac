# 0420c — a for-in variable in an async function collides with a later local of its name

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-10-28
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { Sys, Files } from "std";
async i32 count(Files fs, string[] given) {
  i32 n = 0;
  for (string g in given) {
    if ((await fs.stat(g)).isOk()) { n = n + 1; }
  }
  i32[] g = i32[].filled(3, 0);
  return n + g.len();
}
export async i32 main(Sys sys) {
  string[] a = string[].filled(2, "/");
  return (await count(sys.files(), a)) == 5 ? 0 : 1;
}
```

Expected: exit 0. The loop's `g` is scoped to the loop, and the later `g` is a new local.
Actual: `wac run --allow-read` says the module *"was rejected by the engine — this is a compiler bug"*.

## Notes

- Spelling the loop as `for (i32 k = 0; k < given.len(); k++) { string g = given[k]; … }` runs and
  exits 0, so the block-scoped local survives the async lowering and the for-in variable does not.
  It looks like it is hoisted into the async state under its bare name.
- In a larger function (`checkCommand` in `packages/wac/src/wac.wac`, whose later local is
  `Gathered g`), the checker sees the same collision and refuses with *"a call to `Gathered.len`"*.
  On an older seed the module was emitted and refused with *"call[2] expected type (ref null 0),
  found array.get of type (ref null 323)"*. `checkCommand` uses the index form until this is fixed.
