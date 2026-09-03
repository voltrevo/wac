# Idioms

Ordinary wac, spelled the way wac spells it. Each is the best possible spelling of its behaviour.
None of them is on its own a reason to use the language.

Each is marked **done** or **not yet**, and that marker is the only thing here that refers to an
implementation.

See [README.md](README.md) for the three tiers and why nothing checks them.

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

Takes no capability, so it cannot reach the world. The predicate is an ordinary parameter, and `T?`
is what comes back when nothing matches.

**Not yet.**

---

## Imports name the project

```wac
import { itoa } from "@/packages/fmt/src/itoa.wac";
```

An import names a path from the project root. The same header works from any file.

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
  for (auto line in lines) {
    n += line.len();
  }
  return n;
}
```

The same head walks an array and a `Vec`, and an index that exists only to be a cursor never appears.
The head keeps its parentheses, and declares its variable the way any local is declared.

**Not yet.**

---

## A type the caller supplies

```wac
i32 totalLength<C>(C parts) {
  i32 n = 0;
  for (auto part in parts) {
    n += part.len();
  }
  return n;
}
```

```wac
totalLength(names);       // string[], so `part` is a string
totalLength(chunks);      // Vec<u8[]>, so `part` is a u8[]
```

`part` is whatever `C` holds: a `string` in the first call, a `u8[]` in the second. Each
instantiation supplies the type.

**Not yet.**

---

## Two reads, one wait

```wac
async i32 total(Sys sys) {
  auto got = await Ticket.all([sys.readFile("a.txt"), sys.readFile("b.txt")]);
  return got[0].len() + got[1].len();
}
```

`all` answers when every ticket has.

**Not yet.**

---

## Giving other work a turn

```wac
async void tick(Sys sys, string name) {
  for (i32 i = 0; i < 2; i++) {
    sys.log(name);
    await;
  }
}

async i32 main(Sys sys) {
  tick(sys, "a");
  tick(sys, "b");
  await sys.drain();
  return 0;
}
```

```
a
b
a
b
```

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

`End` and `Failed` are separate cases, and the match covers all three, so neither can be skipped. The
failure is returned to the caller, which decides what it means.

Reading a socket is a method on the socket, so this function can touch one connection and nothing
else.

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
