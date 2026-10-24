# 0399a — `wac build` reports a `try` mismatch where `wac check` reports the missing import

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-24
- **Kind:** diagnostic
- **Symptom:** compile error

## Reproduction

```wac
import { Result } from "core";

export async Result<void> main(Sys sys) {
  try await sys.stdout().line("hi");
  return Result.Ok();
}
```

Expected: both commands say `unknown type 'Sys'` at line 3, and nothing else — `Sys` is not imported.
Actual: `wac check` does; `wac build` instead reports only *the error `try` passes on does not fit the function's
error type … the function's error type is never*, which sends the reader to the wrong line and the wrong fix.

## Notes

`wac build` goes through the program adapter (`packages/wacc/src/program.wac`), which wraps `main` and builds a
`Sys` for it; the wrapped program seems to resolve `Sys` where the user's file did not, and the gathered error type
comes out `never` instead of the unknown name being reported. Leaving `Result` unimported as well gives
*unknown type 'Result'* pointing at the adapter's generated text (`__wacMain`, `__wacT`) rather than the user's line.
