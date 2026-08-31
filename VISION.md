# VISION

What wac should read like, in programs. Each is marked **done** or **not yet**, and that marker is
the only thing on this page that refers to an implementation.

An entry is an example, not an argument. A want that cannot be shown as a program somebody would
want to write does not belong here.

---

## What wac is for

Systems programming where **authority is a value**: a program does exactly what it was handed and
nothing more, and that is a fact about its type rather than a sandbox around it.

The same module runs in a browser, on Node, on Deno, on wasmtime and natively, without being
rebuilt — so where a program runs stops being something the program knows.

Enough language to write the stack in rather than a program on top of one: the compiler that
compiles it, the shell that runs it, the cryptography that carries it.

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
      case Circle(r): return 3.14159 * r * r;
      case Square(side): return side * side;
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
what it calls. **Done.**

---

## Ordinary code

```wac
/** The first element `p` accepts, or nothing. */
T? find<T>(T[] xs, fn[bool(T)] p) {
  for (T x in xs) {
    if (p(x)) {
      return x;
    }
  }
  return null;
}
```

Most of a program is this. It takes no capability, so it cannot reach the world, and the signature is
the whole of that argument — nothing else had to be arranged. Absence is a type rather than a
sentinel, a loop says what it walks rather than how it counts, and a predicate is a value.
**Not yet.**
