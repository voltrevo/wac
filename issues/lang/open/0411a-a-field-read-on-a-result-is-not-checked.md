# 0411a — a field read on a `Result` is not checked

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-27
- **Kind:** bug
- **Symptom:** invalid wasm (in an async function); an emitter refusal otherwise

## Reproduction

```wac
import { Result } from "core";
struct S { bool isDir; }
struct E { string m; }
Result<S, E> look() { return Result.Ok(S(true)); }
export i32 main() { return look().isDir ? 1 : 0; }
```

Expected: *no such field* at `look().isDir` — a `Result<S, E>` has no field `isDir`; `look().unwrap().isDir` or a
`match` is what reads it.
Actual: `wac check` passes. `wac build` refuses with *the exported function `main` is not in the module the emitter
produced*. Inside an `async` function the same read (`if ((await fs.stat(p)).isDir)`) is emitted, and the engine
rejects the module: *invalid field index: 4294967295* in the function's state-machine lambda.

## Notes

Found moving callers of `packages/fs`'s `Fs` onto std's `Files` (design/system/0013 step 5), where `fs.stat(p)`
used to answer a `Stat` and now answers a `Result<Stat, LookFault>`: nine places read `.isDir`, `.isSymlink` or
`.isExecutable` straight off the result and the whole tree checked clean. The second module it broke named the
lambda `$lambda$3/3011:1021`, which was `sh`'s `rm` builtin. Siblings: 0406a (a method call on a union value) and
0410a (a method call on a nullable array) — in all three the member lookup on a receiver that is not a plain
struct gives up without a diagnostic.
