# 0413a — a fault union assigned to a `string` is not refused, and the module is invalid

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-28
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { NotFound, Other } from "std";
import { Result } from "core";
export i32 main() {
  Result<i32, union<NotFound, Other>> r = Result.Err(Other("x"));
  string why = "";
  match (r) {
    Ok(v): { why = "ok"; }
    Err(e): { why = e; }
  }
  return why.len();
}
```

Expected: `why = e` refused — a union of faults is not a `string`; `"\{e}"` is the conversion.
Actual: checked clean; the engine rejects `main`: *local.set[0] expected type (ref null 0), found local.get of
type anyref*.

## Notes

Found porting `packages/platform/test/wac/pipeline_test.wac` off `Cli` (design/system/0013 step 5), where
the old code assigned a `string` error field and the new one a fault. An assignment, not an initialiser:
`string why = e;` is worth trying separately.
