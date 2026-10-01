# 40 — Option and Result

`Option<T>` and `Result<T, E>` are ordinary generic enums in `core`. `T?` already says that a value may be absent, and
the containers use it; `Option<T>` is for an absence that has to be a value of an enum — matched alongside other
variants, or stored where `T?` would nest. `Result` is a success or an error ([26](../3-expressions/26-errors-and-results.md)).

## `Option`

```wac
// fragment — from core
enum Option<T> {
  Some(T v), None
}
```

```wac
// expect: answers main = 1
import { Option, mapOption } from "core";

i32 twice(i32 x) { return x * 2; }

export i32 main() {
  Option<i32> a = Option.Some(4);
  Option<i32> b = Option.None;
  bool some = a.isSome() && b.isNone();
  bool orElse = a.orElse(0) == 4 && b.orElse(9) == 9;
  bool mapped = mapOption(a, twice).unwrap() == 8;
  return some && orElse && mapped ? 1 : 0;
}
```

`[§wac-option-methods-s4r3cci]` `isSome()`, `isNone()`, `orElse(d)` — the value or `d` — and `unwrap()` — the value, or a trap —
answer as their names say. `mapOption(o, f)` applies `f` to a present value.

## `Result`

```wac
// fragment — from core
enum Result<T, E = union> {
  Ok(T v), Err(E e)
}
```

```wac
// expect: answers main = 1
import { Result, Option } from "core";

export i32 main() {
  Result<i32, string> good = Result.Ok(3);
  Result<i32, string> bad = Result.Err("no");

  bool ok = good.isOk() && bad.isErr();
  bool orElse = good.orElse(0) == 3 && bad.orElse(0) == 0;
  bool unwrap = good.unwrap() == 3;
  bool okErr = good.ok().isSome() && bad.ok().isNone() && bad.err().unwrap() == "no";
  return ok && orElse && unwrap && okErr ? 1 : 0;
}
```

`[§wac-result-methods-t7523pd]` `isOk()`, `isErr()`, `orElse(d)`, `unwrap()` — the value, or a trap — `ok()` — the value as an
`Option`, discarding the error — and `err()` — the error as an `Option` — answer as their names say.

`unwrap` is for an error that means the program is wrong. An error that is the caller's to decide about is passed on with
`try`, or matched.
