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
// expect: answers isSomeOf(true) = true
// expect: answers isSomeOf(false) = false
// expect: answers orElseOf(true) = 4
// expect: answers orElseOf(false) = 9
// expect: answers mappedOf(true) = 8
// expect: traps mappedOf(false)
import { Option, mapOption } from "core";

i32 twice(i32 x) { return x * 2; }

Option<i32> maybe(bool present) { return present ? Option.Some(4) : Option.None; }

export bool isSomeOf(bool present) { return maybe(present).isSome() && !maybe(present).isNone(); }

export i32 orElseOf(bool present) { return maybe(present).orElse(9); }

export i32 mappedOf(bool present) { return mapOption(maybe(present), twice).unwrap(); }
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
// expect: answers isOkOf(true) = true
// expect: answers isOkOf(false) = false
// expect: answers orElseOf(true) = 3
// expect: answers orElseOf(false) = 0
// expect: answers unwrapOf(true) = 3
// expect: traps unwrapOf(false)
// expect: answers okIsSome(true) = true
// expect: answers okIsSome(false) = false
// expect: answers theError = "no"
import { Result, Option } from "core";

Result<i32, string> parsed(bool good) { return good ? Result.Ok(3) : Result.Err("no"); }

export bool isOkOf(bool good) { return parsed(good).isOk() && !parsed(good).isErr(); }

export i32 orElseOf(bool good) { return parsed(good).orElse(0); }

export i32 unwrapOf(bool good) { return parsed(good).unwrap(); }

export bool okIsSome(bool good) { return parsed(good).ok().isSome(); }

export string theError() { return parsed(false).err().unwrap(); }
```

`[§wac-result-methods-t7523pd]` `isOk()`, `isErr()`, `orElse(d)`, `unwrap()` — the value, or a trap — `ok()` — the value as an
`Option`, discarding the error — and `err()` — the error as an `Option` — answer as their names say.

`unwrap` is for an error that means the program is wrong. An error that is the caller's to decide about is passed on with
`try`, or matched.
