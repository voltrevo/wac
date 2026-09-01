# Technical

One detail of the language per entry, with the outcome shown. An entry here is not always the best
way to write the thing; it is written to pin the detail down.

Read together these are meant to be enough to implement the language from.

Each is marked **done** or **not yet**, and that marker is the only thing here that refers to an
implementation.

See [README.md](README.md) for the three tiers and why nothing checks them.

---

## Literal tags and verbatim names

```wac
Node label(string id, string @"for", Node[] kids) {   // `for` is a keyword
  return <"label" id={id} for={@"for"}>{kids}</"label">;
}

Node field(string who) {
  return <label id="who" for={who}>Name</label>;
}
```

```wac
Node icon() {
  return <"my-widget" data-size="8" />;
}

Node dot() {
  return <"svg:circle" cx="1" cy="1" r="1" />;
}
```

A quoted tag name may be any name. An attribute name is written as it is in HTML, and runs to `=`,
whitespace, `/` or `>`.

The call site writes `for`, and the parameter it fills is `@"for"`.

**Not yet.**

---

## A hyphenated attribute

```wac
Node widget(string @"data-size") {
  return <"my-widget" data-size={@"data-size"} />;
}

Node sized() {
  return <widget data-size="8" />;
}
```

The parameter is `@"data-size"`. Both tags write the attribute as HTML does.

**Not yet.**

---

## `@` on a name that does not need it

```wac
i32 double(i32 @"n") {
  return n * 2;
}
```

```
warning: `@"n"` is just `n`
  --> math.wac:1:16
   |
 1 | i32 double(i32 @"n") {
   |                ^^^^
   = help: `n` needs no quoting — write `n`
```

`@"n"` and `n` are the same name. The program compiles.

**Not yet.**

---

## A quoted tag and a quoted name

```wac
Node caption(Node[] kids) {
  return <"label">{kids}</"label">;
}

Node one()   { return <caption>Name</caption>; }
Node two()   { return <@"caption">Name</@"caption">; }
Node three() { return <"caption">Name</"caption">; }
```

`one` and `two` both call `caption`. `three` is the `caption` element.

**Not yet.**

---

## A test names itself

```wac
export void @"test: an empty read returns End"() {
  // …
}
```

```
ok   test: an empty read returns End
```

**Not yet.**

---

## Const through an accessor

```wac
struct Server {
  Vec<Route> routes;
  Vec<Route> table(const this) { return this.routes; }
}

i32 count(const Server s) {
  return s.table().len();
}
```

```wac
void add(const Server s, Route r) {
  s.table().push(r);
}
```

```
error: a non-const reference cannot be taken from a const one
  --> server.wac:2:13
   |
 2 |   s.table().push(r);
   |             ^ `push` writes, and `s.table()` is const
```

`table` hands back the real `Vec`. Reading it is allowed and writing to it is not.

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
