# VISION

What wac should read like, in programs. Each is marked **done** or **not yet**, and that marker is
the only thing on this page that refers to an implementation.

An entry is an example, not an argument. A want that cannot be shown as a program somebody would
want to write does not belong here.

No test reads this page. Nothing here is a fixture, a list some guard checks, or a promise a
suite holds anybody to — an entry can be rewritten, reordered or deleted without running anything,
and a guard that made an edit here fail a build would be the wrong guard.

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
what it calls.

**Done.**

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

`scan` runs to completion inside the program — its own scheduler, less authority than the caller
holds, and nothing spawned. A grant can only be removed: a subsystem asking for more than its parent
holds gets what its parent holds, so the ceiling falls as you go inward and never rises. It is what
the host does when it runs `main`, one level up.

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

A tree of `Node`, an ordinary type from `core` — markup is data a program builds and returns, not a
template language beside it.

**Every tag is a name in scope.** `div` and `p` were handed over by an import, `greeting` is mine,
and nothing distinguishes them: a tag is a function, its attributes are that function's named
parameters and its children are a parameter. So attributes are typed wherever they appear, a tag that
takes no children refuses them, and `<dvi>` is an unresolved name rather than an element nobody
meant.

**Not yet.**

---

## Tags a name cannot reach

```wac
Node label(string id, string @for, Node[] kids) {   // `for` is a keyword; `@for` is the name
  return <"label" id={id} for={@for}>{kids}</"label">;
}

Node field(string who) {
  return <label id="who" for={who}>Name</label>;
}
```

A tag is a name only when it can be one. `"label"` is a literal, so a tag whose name is not an
identifier — a hyphenated custom element, a namespaced one — is reachable too, and inside a literal
element an attribute name is a string rather than an identifier.

Where the name really is a parameter, `@for` writes it: a verbatim identifier is any word taken as a
name, so a keyword can be one and nothing is renamed. It costs a mark at the definition and nothing
at any use — an attribute is matched by spelling, so the call site stays bare. Defining a tag is how
the vocabulary grows, and `core`'s `label` is exactly this.

**Not yet.**

---

## Imports name the project

```wac
import { itoa } from "@/packages/fmt/src/itoa.wac";
```

A header says where something is, not how many directories away the reader happens to be standing.

**Done.**

---

## Iterate over a thing, not over its indices

```wac
Vec<string> nonEmpty(string[] lines) {
  Vec<string> out = Vec.create();
  for (string line in lines) {
    if (line.len() > 0) {
      out.push(line);
    }
  }
  return out;
}

i32 totalLength(Vec<string> lines) {
  i32 n = 0;
  for (string line in lines) {
    n = n + line.len();
  }
  return n;
}
```

The same head walks an array and a `Vec`, so they read as one language rather than two libraries, and
an index that exists only to be a cursor never appears. The head keeps its parentheses and its type:
every other head in the language has both, and a redundancy the eye can rest on is worth more than a
character saved.

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

Both reads are in flight before either is awaited, because starting the work and waiting for it are
different acts. Concurrency is what you get by *not* awaiting yet — there is no parallel construct,
no task type and nothing to join.

**Not yet.**

---

## A stream ends, or fails, and says which

```wac
async Result<u8[], string> readAll(Socket sock) {
  Buf got = Buf.create();
  while (true) {
    match (await sock.recv()) {
      case Data(bytes): { got.append(bytes); }
      case End:         { return Result.Ok(got.bytes()); }
      case Failed(why): { return Result.Err(why); }
    }
  }
}
```

Three outcomes, all named, none forgettable: a read that ended and a read that broke are different
answers and neither can be mistaken for the other. The failure is returned rather than reported, so
the caller decides what it means — and a partial read cannot be handed back as if it were whole.

The socket is the whole of what it was handed. Reading one is a method on it rather than something
asked of the system on the socket's behalf, so a handle carries its own authority and this function
can touch one connection and nothing else.

**Not yet.**
