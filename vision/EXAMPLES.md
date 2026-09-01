# Examples

What wac should read like, in programs. Each is marked **done** or **not yet**, and that marker is
the only thing on this page that refers to an implementation.

An entry is an example, not an argument. A want that cannot be shown as a program somebody would
want to write does not belong here.

See [README.md](README.md) for what this directory is and why nothing checks it.

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

Takes no capability, so it cannot reach the world. Absence is a type, a loop says what it walks, and
a predicate is a value.

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

Markup is a tree of `Node`, an ordinary type from `core`, that a program builds and returns.

Every tag is a name in scope. `div` and `p` came from an import and `greeting` is mine; a tag is a
function, its attributes are that function's named parameters, and its children are a parameter.

**Not yet.**

---

## Literal tags and verbatim names

```wac
Node label(string id, string @for, Node[] kids) {   // `for` is a keyword; `@for` is the name
  return <"label" id={id} for={@for}>{kids}</"label">;
}

Node field(string who) {
  return <label id="who" for={who}>Name</label>;
}
```

A tag written as a literal takes any name — a hyphenated custom element, a namespaced one — and
inside one an attribute name is a string.

`@for` is a verbatim identifier: any word taken as a name, so a keyword can be one. It marks the
definition and nothing at the call site, which matches attributes by spelling.

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

The same head walks an array and a `Vec`, and an index that exists only to be a cursor never appears.
The head keeps its parentheses and its type, as every other head in the language does.

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
      Data(bytes): { got.append(bytes); }
      End:         { return Result.Ok(got.bytes()); }
      Failed(why): { return Result.Err(why); }
    }
  }
}
```

Three outcomes, all named: a read that ended and a read that broke are different answers. The failure
is returned rather than reported, so the caller decides what it means.

Reading a socket is a method on the socket, so this function can touch one connection and nothing
else.

**Not yet.**

---

## Matching an enum

```wac
async void show(Sys sys) {
  match (await sys.readFile("a.txt")) {
    Ok(bytes):        { use(bytes); }
    Err(is NotFound): { sys.log("no a.txt — using the default"); }
    Err(_):           { sys.warn("cannot read a.txt"); }
  }
}
```

```wac
async Result<Config, string> load(Sys sys) {
  return match (await sys.readFile("config.json")) {
    Ok(bytes):        parse(bytes),
    Err(is NotFound): Result.Ok(Config.defaults()),
    Err(e):           Result.Err(e.message()),
  };
}
```

Arms hold blocks or values, and a match holding values is an expression. `is` matches a variant
inside a payload; a bare name there binds it.

**Not yet.**

---

## An arm can leave

```wac
async i32 totalSize(Sys sys, string[] names) {
  i32 total = 0;
  for (string name in names) {
    u8[] bytes = match (await sys.readFile(name)) {
      Ok(b):  b,
      Err(_): continue,
    };
    total += bytes.len();
  }
  return total;
}
```

An arm that leaves gives no value, and is not asked to agree with the others.

**Not yet.**

---

## An enum with a default

```wac
string advice(Fault f) {
  return match (f) {
    NotGranted: "start it with the grant it needs",
    IsDir:      "that path is a directory",
    default:    "",
  };
}
```

```wac
f64 area(Shape s) {
  return match (s) {
    Circle(r):  3.14159 * r * r,
    Square(sd): sd * sd,
    default:    0.0,
  };
}
```

```
error: this `default` is unreachable
  --> shapes.wac:6:5
   |
 6 |     default:    0.0,
   |     ^
   = help: every variant is already named — remove it
```

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

Written out, it is checked: a body that gains a third way to fail is refused at this line.

**Not yet.**

---

## Any of several types

```wac
union<f64, string, bool> parseCell(string text) {
  if (text == "true")  { return true; }
  if (text == "false") { return false; }

  f64? n = parseNum(text);
  if (n is null) { return text; }
  return n;
}
```

```wac
string render(union<f64, string, bool> cell) {
  return match (cell) {
    f64:    fmt(cell),
    string: cell,
    bool:   cell ? "true" : "false",
  };
}
```

A member is returned as itself; there is nothing to construct. An arm names a type, and inside it the
value is that type.

**Not yet.**

