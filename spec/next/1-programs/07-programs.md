# 07 — Programs

A program is a module compiled as an entry. What it can do to the world is exactly what it is handed:
authority is a value, passed as a parameter, and a program that is handed nothing can compute and
answer but cannot reach anything.

## The entry module's exports are the program's interface

The module passed to the compiler is the program's **entry**. Its exports are the entry
points: reachability starts from them ([05](05-reachability.md)), and its exported functions are what
the compiled module exposes to its host.

```wac
// expect: answers test = 16
// ---- utils_a.wac ----
export i32 compute(i32 x) { return x + 1; }
// ---- utils_b.wac ----
export i32 compute(i32 x) { return x * 2; }
// ---- main.wac ----
import { compute as a } from "./utils_a.wac";
import { compute as b } from "./utils_b.wac";

export i32 test() { return a(5) + b(5); }
```

`[§wac-export-entry-only-v3kp8wn]` Compiling with `main.wac` as entry produces a module whose only
export is `test`. `test()` answers 16.

`[§wac-export-no-collision-m4fn9rk]` Two imported modules may export functions with the same name
without colliding: only the entry module's exports become the compiled module's exports.

Exported types, statics and type declarations are entry points too, retained and checked whole
([05](05-reachability.md)); they are not functions, so the compiled module does not expose them.

```wac
// expect: emits
import { Ticket } from "core";

export async i32 later(Ticket<i32> t) { return await t; }
export gen<i32> void counting() { yield 1; }
export T first<T>(T[] xs) { return xs[0]; }  // exported to wac importers; not a compiled export
```

`[§wac-export-any-signature-9pdfi7d]` Any function may be exported, whatever its signature — generic,
`async`, a generator, or taking a parameter no host could construct. Compiling does not judge what a
host can call. Every non-generic exported function of the entry is an export of the compiled module.

A generic function is exported for other wac modules to instantiate, and is checked as an entry point,
but it is not an export of the compiled module: a host would have to call a name the author never
wrote. An instantiation of one becomes a compiled export by being named, `export { max<i32> as maxI32 };`
([02](02-modules-and-imports.md)).

`export` in any other module is about modules naming each other ([02](02-modules-and-imports.md)).
How an export crosses to a host language — what a `string` or an enum becomes in JavaScript — is
[48](../8-tooling/48-bindgen.md)'s subject.

## A program that asks for nothing

```wac
// expect: exits 3
export i32 main() { return 3; }
```

`[§wac-cli-nocaps-5hq2xn9]` A `main` that takes no parameters is a whole program: no capabilities are
declared, none are granted, and it runs.

This is the language's central claim in its smallest form. A host reads `main`'s parameter list and
hands over what it names; it does not build a world and hope the program wants it.

## `Sys` is the authority a program is handed

```wac
// expect: prints
// hello
import { Sys } from "std";

export void main(Sys sys) {
  sys.log("hello");
}
```

`[§wac-sys-handed-xwmk4w9]` A program that names a `Sys` parameter on `main` is handed one. Every
effect on the world — files, the network, time, randomness, other programs — is a method reached
through it ([44](../7-library/44-std.md)).

Nothing reaches the world any other way. There is no global to read, no function that opens a file
without being given the means, and nothing a static initialiser can acquire
([28](../4-static/28-static-evaluation.md)). So a function's parameters are a complete statement of
what it can do:

```wac
// expect: answers firstOverTwo = 3
/** The first element `p` accepts, or nothing. */
T? find<T>(T[] xs, fn<bool(T)> p) {
  for (T x in xs) {
    if (p(x)) {
      return x;
    }
  }
  return null;
}

export i32 firstOverTwo() { return find([1, 3, 5], (i32 x) => x > 2)!; }
```

`find` takes no capability, so it cannot reach the world — whatever its body does, and whatever it
calls.

`[§wac-no-ambient-authority-q8tmqv3]` A function with no capability among its parameters, and no
capability reachable from them, can have no effect outside the program.

## Authority narrows on the way in

```wac
// expect: prints
// 0 matches
import { Sys, Grant } from "std";

export void main(Sys sys) {
  i32 found = sys.run(scan, [Grant.Read]);
  sys.log("\{found} matches");
}

i32 scan(Sys sys) {
  return 0;                  // reads; it cannot write, listen or spawn, whatever it asks for
}
```

`scan` runs to completion inside the program, on its own scheduler, with nothing spawned. It holds the
grants listed and no others.

`[§wac-sys-run-narrows-zjku4nc]` `sys.run(f, grants)` calls `f` with a `Sys` holding at most `grants`.
A subsystem that asks for more than its caller holds gets what its caller holds.

The grants a program itself holds were fixed when it was built ([45](../8-tooling/45-cli.md)): the
person running it cannot widen them.

## What `main` returns, and what the program exits with

```wac
// fragment — six spellings, not six programs
void         main(Sys sys) { }                        // 0
never        main(Sys sys) { serve(sys); }            // does not return
i32          main(Sys sys) { return 3; }              // 3
Result<void> main(Sys sys) { return Result.Ok(); }    // 0
Result<i32>  main(Sys sys) { return Result.Ok(3); }   // 3
Result<i32>  main(Sys sys) { return Result.Err(e); }  // 1
```

A `never` main has no status of its own — it comes from `sys.exit`, a trap, or the host. The async
forms settle first and then answer the same way.

```wac
// expect: exits 1
import { Sys } from "std";

export Result<i32> main(Sys sys) {
  return Result.Err("no input");
}
```

`[§wac-main-status-kcv64ub]` `main` answering `void` exits 0; answering an `i32` exits with it; answering
`Result.Ok(v)` exits as `v` would; answering `Result.Err(…)` exits 1.

```wac
// expect: refused
import { Sys } from "std";

export string main(Sys sys) { return "hi"; }   // not a return type for main
```

`[§wac-main-return-types-jtjuda4]` `main` returns `void`, `never`, `i32`, or a `Result` of `void` or
`i32`, optionally `async`. Any other return type is refused.

Nothing in the language assumes a posix exit code. The host reads whatever `main` answered; a status
is how the command-line host reports it.

## `try` works in `main`

```wac
// fragment — a program with read and write grants
async Result<void> main(Sys sys) {
  u8[] src = try await sys.readFile("in.txt");
  try await sys.writeFile("out.txt", transform(src));
  return Result.Ok();
}
```

Every call at the top of a program can fail, and a `main` answering `void` or `i32` would have to
match each one by hand. A `Result`-answering `main` is what makes `try`
([26](../3-expressions/26-errors-and-results.md)) available there.

## A program is finished when its work is

A program does not end when `main` returns. It ends when nothing it started is left to run — and work
it started but did not finish is a failure, whatever `main` answered:

```wac
// expect: exits 1
import { Sys } from "std";

export i32 main(Sys sys) {
  sys.sleepMillis(10);         // not awaited, and never drained
  return 0;                    // exits 1: scheduled work never ran
}
```

```wac
// expect: exits 0
import { Sys } from "std";

export i32 main(Sys sys) {
  sys.sleepMillis(10);
  sys.exit(0);                 // exits 0: abandoning the rest, said out loud
}
```

`[§wac-exit-work-left-pu5wju6]` A program whose `main` returns while work it scheduled has not run
exits 1, whatever `main` answered. `sys.exit(n)` ends the program at once with status `n`, abandoning
what is left.

A trap does the same. Neither is distinguished from an `Err` by its status; what separates them is
what gets printed.

An unawaited call is still the program's work — it was the program's from the call, not from an
`await` that was never written ([35](../6-concurrency/35-tickets-and-await.md)):

```wac
// expect: exits 1
import { Sys } from "std";
import { Ticket } from "core";

async void stuck() {
  Ticket<i32> t;
  await t;                     // nothing will ever settle t
}

export async void main(Sys sys) {
  stuck();
  await sys.drain();           // exits 1: drain waits on a ticket nothing settles
}
```

## A program that cannot make progress is hung

```wac
// expect: exits 1
import { Sys } from "std";
import { Ticket } from "core";

export async void main(Sys sys) {
  Ticket<i32> t;
  await t;                     // exits 1: nothing can run and nothing is outstanding
}
```

`[§wac-hung-exits-1-3i9b2ti]` A program in which nothing can run and nothing is outstanding with the
host is hung, and exits 1.

The condition belongs to the program rather than the ticket, which is why no ticket state models it.
A program awaiting a socket read is not hung — the host has the read outstanding — and one awaiting a
ticket nobody holds is, because the scheduler is empty and no event is pending.

## A server

```wac
// fragment — the shape of a long-running program
async Result<never> main(Sys sys) {
  auto listener = try await sys.listen(8080);
  sys.log("listening on \{listener.addr}");

  while (true) {
    auto sock = try await listener.accept();
    answer(sys, sock);          // not awaited — the loop goes straight back to accept
  }
}

async void answer(Sys sys, Socket sock) {
  // …
}
```

`Result<never>` says the program runs until something fails. The unawaited `answer` is work the
program owns, and it runs alongside the loop ([35](../6-concurrency/35-tickets-and-await.md)).

## Open

- **Whether `listener.accept()` can fail.** Vision's server marks it as a question; it is written
  with `try` above.
