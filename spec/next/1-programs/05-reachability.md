# 05 — Reachability

A program is compiled from its entry points outward. Declarations no entry point reaches are dropped
before they are checked, and files no retained declaration needs are never read.

The rule here is deliberately simple; optimisation may remove more later.

## Compilation order

1. Parse each file that is actually loaded.
2. Retain declarations reachable from requested entry-point exports; follow imports lazily.
3. Check retained declarations and perform static evaluation.
4. Link and optimise; optionally eliminate more code.

Steps 1–2 repeat as needed when reachability loads another file. Minimal binding identifies
declaration references; it is not full type checking or evaluation.

The entry points are the exports of the module passed to the compiler ([07](07-programs.md)).
Checking a whole project is a different operation, which retains everything
([06](06-checking-a-project.md)).

## Dropped declarations need only parse

```wac
// expect: answers main = 0
i32 unused() { return nonexistent(); }
export i32 main() { return 0; }
```

`[§wac-reach-dropped-cmkjyyd]` A declaration no entry point reaches is dropped, and is not checked: it
need only parse. `unused` is dropped, so its call to a name that does not exist is not an error.

```wac
// expect: refused
export i32 main() {
  if (false) { return nonexistent(); }
  return 0;
}
```

`[§wac-reach-retained-checked-kdwrqvx]` A retained declaration must pass ordinary checking in full,
including branches that can never run.

## Later branch elimination does not undo retention

```wac
// expect: refused
i32 broken() { return nonexistent(); }

export i32 main() {
  static_if (false) {
    return broken();
  } else {
    return 0;
  }
}
```

`[§wac-reach-static-branch-uqdrahd]` A reference in a static branch that is not taken still retains
what it names. `main` references `broken`, so `broken` is retained and must compile.

If the retained code compiles successfully, the compiler should still eliminate the dead branch and
declarations left unused by that elimination. Retention requires checking; it does not require dead
code in the output.

## Structs are declarations; namespaces are containers

```wac
// expect: refused
struct Widget {
  i32 value;
  i32 read(const this) { return this.value; }
  i32 broken(const this) { return nonexistent(); }
}

export i32 main() {
  Widget w = Widget(7);
  return w.read();
}
```

`[§wac-reach-struct-whole-3wx2wun]` Retaining a struct retains all its members and their declaration
references. `Widget` is retained with every method, so `broken`'s error is reported though nothing
calls it.

Reachability is computed before types are known. It cannot determine which generic instantiations
will occur, and therefore cannot determine which struct members will be reached through them, so it
does not prune methods by type:

```wac
// expect: answers main = 7
export i32 main() { return readValue(Widget(7)); }

i32 readValue<T>(T value) { return value.read(); }

struct Widget {
  i32 value;
  i32 read(const this) { return this.value; }
}
```

`readValue`'s receiver depends on `T`. Retaining `Widget` keeps `read` available.

Namespaces are neither types nor values. Their member references are resolved statically, so
selecting one member need not retain its siblings:

```wac
// expect: answers main = 7
namespace helpers {
  export i32 good() { return 7; }
  export i32 bad() { return nonexistent(); }
}

export i32 main() { return helpers.good(); }
```

`[§wac-reach-namespace-member-vde62x5]` Qualifying a namespace member retains that member, not its
siblings. `good` is retained; `bad` is dropped.

## Retained static declarations must evaluate

Every retained static declaration must evaluate, even if no later runtime code uses it. Reachability
failure, type errors, traps during required static evaluation and static cycles cannot be rescued by
later optimisation ([28](../4-static/28-static-evaluation.md)).

```wac
// expect: refused
static i32 BROKEN = 1 / zero();
i32 zero() { return 0; }

export i32 main() {
  if (false) { return BROKEN; }    // retains BROKEN; its evaluation traps
  return 0;
}
```

`[§wac-reach-static-must-evaluate-cnbyywj]` A retained static declaration must evaluate at compile
time. A trap, a cycle or an unfinished evaluation in one is an error, whether or not anything reads
its value at run time.

A static declaration nothing reaches is dropped like any other, so the same initialiser is not an
error when nothing refers to it:

```wac
// expect: answers main = 0
static i32 BROKEN = 1 / zero();    // dropped: never evaluated
i32 zero() { return 0; }

export i32 main() { return 0; }
```

## An import is a route, not an instruction to read immediately

```wac
// expect: answers main = 0
// ---- main.wac ----
import { helper } from "./optional.wac";   // this file does not exist

i32 unused() { return helper(); }
export i32 main() { return 0; }
```

With `main` as the only root:

- `unused` is dropped.
- `optional.wac` is never read.
- Compilation succeeds even though `optional.wac` does not exist.

```wac
// expect: refused
// ---- main.wac ----
import { helper } from "./optional.wac";   // this file does not exist
export i32 main() { return helper(); }
```

Now `optional.wac` must be loaded; a missing file or missing export is an error.

`[§wac-reach-import-lazy-2jhptfk]` A file is read only when a retained declaration needs a name it
exports. A missing file, or a missing export, is an error exactly when it is needed.

Neighbouring files are never discovered merely because they are nearby. Explicit imports provide the
dependency routes.

## Namespace exports can preserve laziness

```wac
// expect: answers main = 42
// ---- library.wac ----
export * as basic from "./basic.wac";
export * as optional from "./missing.wac";   // this file does not exist
// ---- basic.wac ----
export i32 answer() { return 42; }
// ---- main.wac ----
import { basic.answer } from "./library.wac";
export i32 main() { return answer(); }
```

`[§wac-reach-namespace-lazy-pxz4t63]` Reaching a member of one namespace re-export reads that
namespace's module and not the others. `optional` need not load `missing.wac`.
