# wac — the next version

This is a complete statement of the next version of wac: the language, its core and standard
libraries, and its tools. It is written to be implemented from.

**The examples are the definition.** Each rule is shown as a program with its outcome written next
to it, and the prose around an example says only what the example cannot. Where two readings of a
rule are possible, the answer is another example that separates them, not a sentence ruling one
out.

Nothing here describes an implementation. Whether today's compiler does a thing is not evidence
about whether the thing is right; where it disagrees, the compiler is what changes.

## Reading order

Chapters are numbered in reading order, and a chapter relies only on the ones before it. A forward
reference says so, and links.

**1 — Programs**

- 01 [Names and identity](1-programs/01-names-and-identity.md)
- 02 [Modules and imports](1-programs/02-modules-and-imports.md)
- 03 [Namespaces](1-programs/03-namespaces.md)
- 04 Packages
- 05 Reachability
- 06 Checking a project
- 07 Programs

**2 — Types**

- 08 Primitives
- 09 Numeric literals
- 10 Nullability
- 11 Never and uninhabited types
- 12 Structs
- 13 Enums
- 14 Tuples
- 15 Arrays
- 16 Strings
- 17 Const
- 18 Unions
- 19 Generics
- 20 Functions and funcrefs
- 21 Symbols

**3 — Expressions**

- 22 Operators
- 23 Interpolation and markup
- 24 Casts
- 25 Control flow
- 26 Errors and results

**4 — Static**

- 27 Static declarations
- 28 Static evaluation
- 29 Static dependencies
- 30 Computed types
- 31 Static control

**5 — Inference**

- 32 Widening
- 33 Placeholders
- 34 Recursive inference

**6 — Concurrency**

- 35 Tickets and await
- 36 Coroutines and generators

**7 — Library**

- 37 Core
- 38 Vec
- 39 Map and hash
- 40 Option and Result
- 41 Read
- 42 Buf
- 43 Markup types
- 44 Std

**8 — Tooling**

- 45 The `wac` command
- 46 Manifest and lock
- 47 Testing
- 48 Bindgen
- 49 Audit

**Appendices**

- A Grammar
- B Diagnostics
- C Glossary
- D Tag migration

## Conventions

### A fence is a whole program

Unless its first line says otherwise, a ` ```wac ` fence is a complete program that can be compiled
as written. Its first lines state what happens to it:

```wac
// expect: answers main = 7
export i32 main() { return 7; }
```

| Expectation | Meaning |
|---|---|
| `// expect: emits` | It compiles. |
| `// expect: refused` | It does not compile. Which phase refuses it is not the language's business. |
| `// expect: answers f = v` | It compiles, `f()` runs, and the result is `v`. |
| `// expect: traps f` | It compiles, and `f()` traps. |
| `// expect: exits n` | It compiles, runs as a program from its `main` ([07](1-programs/07-programs.md)), and exits with status `n`. |
| `// expect: prints …` | As `exits`, and what follows is what it writes to its output, one line per `// …` line beneath. |

An expectation about one command of the toolchain names it, and may sit beside the build's:

```wac
// expect: emits
// expect (wac check): refused
i32 unused() { return nonexistent(); }
export i32 main() { return 0; }
```

A program of several files marks each one, and its entry is `main.wac`:

```wac
// expect: answers main = 6
// ---- lib.wac ----
export i32 twice(i32 x) { return x * 2; }
// ---- main.wac ----
import { twice } from "./lib.wac";
export i32 main() { return twice(3); }
```

A program may include its manifest, `wac.json5`, and paths may name directories. JSON5 takes `//`
comments, so the same marker works there:

```wac
// expect: answers main = 4
// ---- wac.json5 ----
{}
// ---- src/lib.wac ----
export i32 four() { return 4; }
// ---- main.wac ----
import { four } from "@/src/lib.wac";
export i32 main() { return four(); }
```

A file inside a dependency is shown under the dependency's name in angle brackets. `<geometry>/`
is the root of the checkout that the manifest's `geometry` entry resolves to — whatever repository,
ref and lock entry that takes, which a test supplies rather than the example:

```wac
// expect: answers main = 2
// ---- wac.json5 ----
{ imports: { geometry: { git: "https://example.com/geometry", ref: "v1" } } }
// ---- <geometry>/wac.json5 ----
{ exports: "./src/lib.wac" }
// ---- <geometry>/src/lib.wac ----
export i32 two() { return 2; }
// ---- main.wac ----
import { two } from "geometry";
export i32 main() { return two(); }
```

A fence that is not a whole program says so on its first line, with what it assumes:

```wac
// fragment — inside a function, with a Point p in scope
p.x;                         // 3
```

### Outcomes are written beside the code

`expr; // value` gives the value of an expression at that point. A comment that gives an outcome
does not explain it.

```wac
// fragment
u8 a = 200;
a + 100;                     // 44 — u8 arithmetic wraps
```

### A refused line is commented out under its reason

```wac
// expect: emits
i32 f() { return 1; }

// ERROR: duplicate function 'f'
// i32 f() { return 2; }
```

The program compiles as written. **Uncommenting any one `// ERROR:` line, and nothing else, makes it
refused** — that is the claim the line makes, and each is checkable on its own. The text after
`ERROR:` names the rule broken; its wording is not part of the language unless a chapter says it is.

### Clause tags

A tag names one behaviour that a test can check:

```wac
// expect: answers main = 1
export i32 main() {
  i32 x = 1;
  { i32 x = 2; }
  return x;
}
```

`[§wac-shadow-8u8qh2j]` A block may declare a name its enclosing scope already has, and the outer
binding is untouched.

A tag stands directly below the example that shows it, and its sentence states the rule the example
pins. One example may carry several tags. A test claims a tag by beginning its name with it.

Where a rule is unchanged from the current specification, it keeps the tag it had there. A rule
that changed gets a new tag, and [appendix D](appendices/D-tag-migration.md) records the old one and
what became of it.

### Words with fixed meanings

- **refused** — the program does not compile.
- **traps** — the program compiles, and running it reaches a wasm trap.
- **may warn** — an implementation may report the construct without refusing it. A warning never
  changes what a program means.
- **error** — the same as refused, in prose where "refused" reads badly.

### Open questions are marked

A section headed **Open** records something not yet decided. Nothing in an Open section is a
requirement, and an implementation must not treat a guess about one as settled.
