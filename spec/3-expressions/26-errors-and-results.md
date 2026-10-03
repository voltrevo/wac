# 26 — Errors and results

A program has two ways to fail. A **trap** stops the current call: it cannot be caught by the program, and is
for states the program considers impossible. A **`Result`** is a value that is either a success or an error,
returned like any other; `try` passes an error on to the caller.

## Traps

`trap;` stops execution. It is a statement of type `never` ([11](../2-types/11-never-and-uninhabited.md)), so it
satisfies any return type:

```wac
// expect: answers mustBePositive(5) = 5
// expect: traps mustBePositive(-1)
export i32 mustBePositive(i32 n) {
  if (n <= 0) { trap; }
  return n;
}
```

`[§wac-trap-stmt-v3kq8fn]` A `trap` that is not reached changes nothing: `mustBePositive(5)` answers `5`.

`[§wac-trap-fires-w2jm4pd]` A `trap` that is reached stops the call: `mustBePositive(-1)` traps.

A `trap` may carry a message — any `string` expression, so it can be built at the point of failure — and the
host is told it instead of the engine's bare report:

```wac
// expect: answers half(8) = 4
// expect: traps half(7)
export i32 half(i32 n) {
  if (n % 2 != 0) { trap "half needs an even number, not \{n}"; }
  return n / 2;
}
```

`[§wac-trap-message-4nqk8wm]` `trap e` traps, and the host reports the string `e`: called from JavaScript,
`half(7)` throws `wac trap: half needs an even number, not 7`.

A trap the engine raises — an index out of bounds, `!` on `null`, an integer division by zero — carries no
message, and is not given the last one: attributing a message to a failure the program said nothing about would
be worse than saying nothing.

`[§wac-trap-no-poison-cxtfv9a]` A trap ends the call it happens in, not the module. The instance's state is intact
afterwards, and a host may call it again.

That is what lets a long-running program catch a failed call at its host boundary and carry on.

## `Result`

`core` declares `Result`, an ordinary generic enum:

```wac
// fragment — from core
enum Result<T, E = union> {
  Ok(T v), Err(E e)
}
```

A function that can fail returns one, and a caller takes it apart like any enum:

```wac
// expect: answers digitOr("3") = 3
// expect: answers digitOr("x") = -1
// expect: answers digitOr("42") = -1
// expect: answers orElseZero("x") = 0
import { Result } from "core";

Result<i32, string> parseDigit(string s) {
  if (s.len() != 1) { return Result.Err("not one character"); }
  i32 c = s.toBytes()[0] as i32;
  if (c < '0' || c > '9') { return Result.Err("not a digit"); }
  return Result.Ok(c - '0');
}

export i32 digitOr(string s) {
  return match (parseDigit(s)) {
    Ok(v):  v,
    Err(e): -1,
  };
}

export i32 orElseZero(string s) { return parseDigit(s).orElse(0); }
```

`[§wac-result-enum-mk5axe4]` `Result<T, E>` is an enum with variants `Ok(T v)` and `Err(E e)`, matched like any
other.

`E` defaults to a fresh `union` placeholder, so `Result<T>` collects the error types its function passes on
([19](../2-types/19-generics.md), [33](../5-inference/33-placeholders.md)). There is nothing special about
`Result` beyond what a default type argument gives it. Its methods are [40](../7-library/40-option-and-result.md)'s
subject.

## `try` passes an error on

`try e`, where `e` is a `Result`, answers `e`'s value if it is `Ok`, and otherwise returns its error from the
enclosing function:

```wac
// expect: answers sumOr("a", "b") = 2
// expect: answers sumOr("", "b") = 0
import { Result } from "core";

Result<i32, string> digit(string s) {
  if (s == "") { return Result.Err("empty"); }
  return Result.Ok(s.len());
}

Result<i32, string> sum(string a, string b) {
  i32 x = try digit(a);
  i32 y = try digit(b);                    // not reached when digit(a) failed
  return Result.Ok(x + y);
}

export i32 sumOr(string a, string b) {
  return sum(a, b).orElse(0);              // sumOr("", "b"): digit("") returned its Err from sum
}
```

`[§wac-try-propagates-8s7defi]` `try e` on an `Ok` answers its value; on an `Err` it returns that error from the
enclosing function at once.

`try` is allowed only in a function whose return type is a `Result`, and the error must fit its error type:

```wac
// expect: emits
import { Result } from "core";

Result<i32, string> digit(string s) { return Result.Ok(1); }

export i32 viaOrElse() { return digit("1").orElse(0); }

// ERROR: try needs a function that returns a Result
// export i32 plain() { return try digit("1"); }
```

`[§wac-try-needs-result-nqim9be]` `try` in a function that does not return a `Result` is refused.

### The error must be in the set, not equal to it

A function's error type may be a union, and an error passes through `try` when its type is one of the union's
members:

```wac
// expect: answers loaded("data") = 1
// expect: answers narrow("data") = 1
import { Result } from "core";

enum NotFound { Missing }
enum Malformed { BadJson }

Result<i32, NotFound> read(string path) { return Result.Ok(1); }
Result<i32, Malformed> parse(i32 bytes) { return Result.Ok(bytes); }

Result<i32, union<NotFound, Malformed>> load(string path) {
  i32 bytes = try read(path);              // NotFound is in the set
  i32 value = try parse(bytes);            // and so is Malformed
  return Result.Ok(value);
}

Result<i32, union<NotFound>> tooNarrow(string path) {
  i32 bytes = try read(path);

  // ERROR: parse can fail with Malformed, which tooNarrow does not return
  // i32 value = try parse(bytes);

  return Result.Ok(bytes);
}

export i32 loaded(string path) { return load(path).orElse(-1); }
export i32 narrow(string path) { return tooNarrow(path).orElse(-1); }
```

`[§wac-try-error-in-set-44qtqmu]` `try e` requires `e`'s error type to fit the enclosing function's error type —
equal to it, or one of its union's members. Otherwise it is refused, and the diagnostic names the error type that
does not fit.

An error type left unwritten is collected: with `Result<T>`, the union of what the body passes on is the error
type, and written out, it is checked:

```wac
// fragment — a program with a Sys and a parse function
async Result<Config> load(Sys sys) {
  u8[] bytes = try await sys.readFile("config.json");
  Config config = try parse(bytes);
  return Result.Ok(config);
}
// The error type is union<readFile's error, parse's error>.

export async Result<Config, union<NotFound, Malformed>> load2(Sys sys) { … }
// Written out, it is checked: passing on an error outside the set is refused here.
```

`[§wac-try-collects-errors-6cjnatm]` In a function returning `Result<T>` with its error type omitted, every error
passed on by `try` contributes to the error type's union.

### Matching an error

An error that is a union or an enum is taken apart with `match`, and `is` in a payload tests it without binding
([13](../2-types/13-enums.md)):

```wac
// expect: answers adviceForDir = "that path is a directory"
// expect: answers adviceForMissing = "no such file"
import { Result } from "core";

enum Fault { NotFound, IsDir, Denied }

string advice(Result<i32, Fault> r) {
  return match (r) {
    Ok(v):            "",
    Err(is NotFound): "no such file",
    Err(is IsDir):    "that path is a directory",
    Err(e):           "cannot read it",
  };
}

export string adviceForDir() { return advice(Result.Err(Fault.IsDir)); }
export string adviceForMissing() { return advice(Result.Err(Fault.NotFound)); }
```

`try` works with `await` — `try await t` awaits a ticket of a `Result` and passes its error on — which is the
shape of almost every call at the top of a program ([07](../1-programs/07-programs.md),
[35](../6-concurrency/35-tickets-and-await.md)).

## A compiled program is valid

Whatever the compiler accepts, the module it produces is valid: a module that fails validation is a compiler
bug, never a program error.

`[§wac-sound-k3fn9wp]` Any module the compiler produces is accepted by a conforming WebAssembly GC runtime.
