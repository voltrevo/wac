# 0405a — an `await` in the `Ok` arm of a match on a `Result<void, E>` emits a module the engine refuses

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-27
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { Result } from "core";
struct Gone { string m; }
async Result<void, Gone> act(bool ok) { return ok ? Result.Ok() : Result.Err(Gone("x")); }
async void say(string s) { }
export async i32 main() {
  match (await act(false)) {
    Ok(v): { await say("w"); }
    Err(e): { }
  }
  return 4;
}
```

Expected: exits 4.
Actual: *the module … was rejected by the engine — this is a compiler bug*. Deno names it: *Compiling function
"$lambda$0/6:…" failed: not enough arguments on the stack for array.set (need 3, got 2)*.

`Result<i32, Gone>` in place of `Result<void, Gone>` runs, as does the same match with no `await` in the `Ok` arm, so it
looks like the arm's `void` binding being saved into the machine's frame across the `await`. Binding the result to a
local first and matching that fails the same way.

## Notes

Found with `std`'s `Output.write`, which answers `Result<void, OutputFault>`: matching a write and then awaiting a line
on the diagnostic output is the obvious way to report what happened, and every `Files` change answers a `Result<void, …>`
too.
