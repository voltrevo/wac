# 40 — Result

`Result<T, E>` is an ordinary generic enum in `core`: a success or an error
([26](../3-expressions/26-errors-and-results.md)). A value that may simply be absent is `T?`
([10](../2-types/10-nullability.md)), which nests and must be checked before use, so `core` has no `Option`.

## `Result`

```wac
// fragment — from core
enum Result<T, E = union> {
  Ok(T v), Err(E e)
}
```

```wac
// expect: isOkOf(true) = true
// expect: isOkOf(false) = false
// expect: orElseOf(true) = 3
// expect: orElseOf(false) = 0
// expect: unwrapOf(true) = 3
// expect: traps unwrapOf(false)
// expect: okIsPresent(true) = true
// expect: okIsPresent(false) = false
// expect: theError() = "no"
import { Result } from "core";

Result<i32, string> parsed(bool good) { return good ? Result.Ok(3) : Result.Err("no"); }

export bool isOkOf(bool good) { return parsed(good).isOk() && !parsed(good).isErr(); }

export i32 orElseOf(bool good) { return parsed(good).orElse(0); }

export i32 unwrapOf(bool good) { return parsed(good).unwrap(); }

export bool okIsPresent(bool good) { return parsed(good).ok() is not null; }

export string theError() { return parsed(false).err()!; }
```

`[§wac-result-methods-t7523pd]` `isOk()`, `isErr()`, `orElse(d)`, `unwrap()` — the value, or a trap — `ok()` — the value as a
`T?`, discarding the error — and `err()` — the error as an `E?` — answer as their names say.

`unwrap` is for an error that means the program is wrong. An error that is the caller's to decide about is passed on with
`try`, or matched.
