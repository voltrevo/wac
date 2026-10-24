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

struct Refused { string why; }

Result<i32, Refused> parsed(bool good) { return good ? Result.Ok(3) : Result.Err(Refused("no")); }

export bool isOkOf(bool good) { return parsed(good).isOk() && !parsed(good).isErr(); }

export i32 orElseOf(bool good) { return parsed(good).orElse(0); }

export i32 unwrapOf(bool good) { return parsed(good).unwrap(); }

export bool okIsPresent(bool good) { return parsed(good).ok() is not null; }

export string theError() { return parsed(false).err()!.why; }
```

`[§wac-result-methods-t7523pd]` `isOk()`, `isErr()`, `orElse(d)`, `unwrap()` — the value, or a trap — `ok()` — the value as a
`T?`, discarding the error — and `err()` — the error as an `E?` — answer as their names say.

`unwrap` is for an error that means the program is wrong. An error that is the caller's to decide about is passed on with
`try`, or matched.

## `flatten`

```wac
// expect: joined(0) = 41
// expect: joined(1) = 100
// expect: joined(2) = 1000
import { Result, flatten } from "core";

struct NotFound { string message; }
struct Gone { string message; }

Result<Result<i32, NotFound>, Gone> layered(i32 k) {
  if (k == 0) { return Result.Ok(Result.Ok(41)); }
  if (k == 1) { return Result.Ok(Result.Err(NotFound("no such file"))); }
  return Result.Err(Gone("nothing can settle it"));
}

export i32 joined(i32 k) {
  return match (flatten(layered(k))) {
    Ok(v):  v,
    Err(e): match (e) { NotFound: 100, Gone: 1000 },
  };
}
```

`[§wac-result-flatten-p4w8n2c]` `flatten(r)` turns a `Result<Result<A, X>, Y>` into a `Result<A, union<X, Y>>`: the inner
value, or whichever error there was. It is a function rather than a method, because a method would need its receiver's
`T` to be a `Result`.

A synchronous call to a capability is the case it is for: `wait()` has its own error outside the capability's
([35](../6-concurrency/35-tickets-and-await.md)), and `flatten(files.readFile(p).wait())` gives one error to match or
`try`.
