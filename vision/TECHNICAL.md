# Technical

One detail of the language per entry, with the outcome shown. An entry here is not always the best
way to write the thing; it is written to pin the detail down.

Read together these are meant to be enough to implement the language from.

Each is marked **done** or **not yet**, and that marker is the only thing on this page that refers to
an implementation.

See [README.md](README.md) for the three tiers and why nothing checks them.

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
