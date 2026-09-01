# Showcase

The examples worth showing first. Each is the best possible spelling of its behaviour, and each
one is a reason to use the language.

Each is marked **done** or **not yet**, and that marker is the only thing here that refers to an
implementation.

See [README.md](README.md) for the three tiers and why nothing checks them.

---

## A server

```wac
i32 main(Sys sys) {
  run(sys);
  sys.drain();
  return 0;
}

async void run(Sys sys) {
  auto listener = await sys.listen(8080);
  sys.log("listening on \{listener.port}");

  while (true) {
    auto sock = await listener.accept();
    answer(sys, sock);          // not awaited — the loop goes straight back to accept
  }
}

async void answer(Sys sys, Socket sock) {
  // …
}
```

**Not yet.**

---

## JavaScript calls it

```wac
export string greet(string who) {
  return "hello \{who}";
}

export enum Shape {
  Circle(f64 r),
  Square(f64 side)

  f64 area(const this) {
    match (this) {
      Circle(r):    { return 3.14159 * r * r; }
      Square(side): { return side * side; }
    }
  }
}
```

```ts
import { greet, Shape } from "./shapes.ts";   // generated from shapes.wac

greet("wac");                 // "hello wac"
Shape.Circle(2).area();       // 12.56636
```

JavaScript imports a wac module as a module, with types. An enum arrives as a class with its variant
constructors and its methods, held by reference: wac compiles to WebAssembly GC, so the object on the
JavaScript side *is* the one in the module. The glue is generated, so a signature cannot drift from
what it calls.

**Done.**

---

## Authority narrows on the way in

```wac
i32 main(Sys sys) {
  i32 found = sys.run(scan, [Grant.Read]);
  sys.log("\{found} matches");
  return 0;
}

i32 scan(Sys sys) {
  // reads; it cannot write, listen or spawn, whatever it asks for
}
```

`scan` runs to completion inside the program, on its own scheduler, with nothing spawned. It holds
the grants listed and no others. A subsystem that asks for more than its parent holds gets what its
parent holds.

**Not yet.**

---

## Markup is a value

```wac
import { div, p } from "core/html.wac";

Node greeting(string who) {
  return <p class="hi">Hello, {who}</p>;
}

Node page(string who) {
  return <div><greeting who={who} /></div>;
}
```

Markup is a tree of `Node`, an ordinary type from `core`, that a program builds and returns.

Every tag is a name in scope. `div` and `p` came from an import and `greeting` is mine; a tag is a
function, its attributes are that function's named parameters, and its children are a parameter.

**Not yet.**

---

## Const is deep

```wac
const i32[] xs = [1, 2, 3];
xs[0] = 9;
```

```
error: cannot write through const reference
  --> xs.wac:2:1
   |
 2 | xs[0] = 9;
   | ^ xs is const
```

In JavaScript `const` binds the name and leaves the contents open. Here it reaches the elements.

**Not yet.**

---

## The compiler is a library

```wac
import { compile } from "wacc";

async Result<i32> runSource(Sys sys, string src) {
  u8[] wasm  = try compile("main.wac", src);
  auto child = try await sys.spawn(wasm, [], [Grant.Read]);
  return Result.Ok(await child.exit());
}
```

Compiling is a function call that answers bytes, and spawning takes bytes — no file is written and
no toolchain is looked up. The child runs with the grants named here, never more than the caller
holds.

**Not yet.**

---

## A ticket is a value

```wac
async void both(Sys sys) {
  Pending<u8[]> a = sys.readFile("a.txt");
  Pending<u8[]> b = sys.readFile("b.txt");

  u8[] first = await a;
  u8[] second = await b;
}
```

Making a `Pending` starts the work, and `await` waits for one already running, so both reads are in
flight before either is awaited. There is no parallel construct and nothing to join.

**Not yet.**

---

## Passing a failure on

```wac
async Result<Config> load(Sys sys) {
  u8[] bytes = try await sys.readFile("config.json");
  Config config = try parse(bytes);
  return Result.Ok(config);
}
```

`try` yields the value and returns the failure to the caller. An error type left unwritten is the
union of what the body passes on — here, `readFile`'s and `parse`'s.

```wac
export async Result<Config, union<NotFound, Malformed>> load(Sys sys) { … }
```

Written out, it is checked: a body that passes on an error outside the set is refused here.

**Not yet.**
