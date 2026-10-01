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
- 04 [Packages](1-programs/04-packages.md)
- 05 [Reachability](1-programs/05-reachability.md)
- 06 [Checking a project](1-programs/06-checking-a-project.md)
- 07 [Programs](1-programs/07-programs.md)

**2 — Types**

- 08 [Primitives](2-types/08-primitives.md)
- 09 [Numeric literals](2-types/09-numeric-literals.md)
- 10 [Nullability](2-types/10-nullability.md)
- 11 [Never and uninhabited types](2-types/11-never-and-uninhabited.md)
- 12 [Structs](2-types/12-structs.md)
- 13 [Enums](2-types/13-enums.md)
- 14 [Tuples](2-types/14-tuples.md)
- 15 [Arrays](2-types/15-arrays.md)
- 16 [Strings](2-types/16-strings.md)
- 17 [Const](2-types/17-const.md)
- 18 [Unions](2-types/18-unions.md)
- 19 [Generics](2-types/19-generics.md)
- 20 [Functions and funcrefs](2-types/20-functions-and-funcrefs.md)
- 21 [Symbols](2-types/21-symbols.md)

**3 — Expressions**

- 22 [Operators](3-expressions/22-operators.md)
- 23 [Interpolation and markup](3-expressions/23-interpolation-and-markup.md)
- 24 [Casts](3-expressions/24-casts.md)
- 25 [Control flow](3-expressions/25-control-flow.md)
- 26 [Errors and results](3-expressions/26-errors-and-results.md)

**4 — Static**

- 27 [Static declarations](4-static/27-static-declarations.md)
- 28 [Static evaluation](4-static/28-static-evaluation.md)
- 29 [Static dependencies](4-static/29-static-dependencies.md)
- 30 [Computed types](4-static/30-computed-types.md)
- 31 [Static control](4-static/31-static-control.md)

**5 — Inference**

- 32 [Widening](5-inference/32-widening.md)
- 33 [Placeholders](5-inference/33-placeholders.md)
- 34 [Recursive inference](5-inference/34-recursive-inference.md)

**6 — Concurrency**

- 35 [Tickets and await](6-concurrency/35-tickets-and-await.md)
- 36 [Coroutines and generators](6-concurrency/36-coroutines-and-generators.md)

**7 — Library**

- 37 [Core](7-library/37-core.md)
- 38 [Vec](7-library/38-vec.md)
- 39 [Map and hash](7-library/39-map-and-hash.md)
- 40 [Option and Result](7-library/40-option-and-result.md)
- 41 [Read](7-library/41-read.md)
- 42 [Buf](7-library/42-buf.md)
- 43 [Markup types](7-library/43-markup-types.md)
- 44 [Std](7-library/44-std.md)

**8 — Tooling**

- 45 [The `wac` command](8-tooling/45-cli.md)
- 46 [Manifest and lock](8-tooling/46-manifest-and-lock.md)
- 47 [Testing](8-tooling/47-testing.md)
- 48 [Bindgen](8-tooling/48-bindgen.md)
- 49 [Audit](8-tooling/49-audit.md)

**Appendices**

- A [Grammar](appendices/A-grammar.md)
- B [Diagnostics](appendices/B-diagnostics.md)
- C [Glossary](appendices/C-glossary.md)
- D [Tag migration](appendices/D-tag-migration.md)

## Conventions

### A fence is a whole program

Unless its first line says otherwise, a ` ```wac ` fence is a complete program that can be compiled
as written. Its first lines state what happens to it:

```wac
// expect: answers gcd(48, 18) = 6
// expect: answers gcd(7, 0) = 7
export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}
```

| Expectation | Meaning |
|---|---|
| `// expect: emits` | It compiles. |
| `// expect: refused` | It does not compile. Which phase refuses it is not the language's business. |
| `// expect: answers f(args) = v` | It compiles, the export `f` called with `args` returns `v`. `f = v` is `f() = v`. |
| `// expect: traps f(args)` | It compiles, and calling the export `f` with `args` traps. |
| `// expect: exits n` | It compiles, runs as a program from its `main` ([07](1-programs/07-programs.md)), and exits with status `n`. |
| `// expect: prints …` | As `exits`, and what follows is what it writes to its output, one line per `// …` line beneath. |

A fence may carry several `answers` and `traps` lines, each a separate call. Arguments and results
are written as wac literals — `true`, `"text"`, `2.5` — taking their types from the export's
signature.

### What an example exports is what it tests

Only declarations the entry's exports reach are checked: everything else is dropped after parsing
([05](1-programs/05-reachability.md)). So an example exports the declarations it is about, and
everything else in it is reached from those exports. A declaration nothing reaches appears only
where being dropped is the point.

Every export of the entry is an entry point, an exported struct or enum included: retaining a type
retains all its members ([05](1-programs/05-reachability.md)), so `export struct` is how an example
has a type checked that no function uses.

The same holds for a refused line. An `// ERROR:` line sits in exported code, or in code an export
reaches, and a commented-out declaration under one is written `export` — otherwise uncommenting it
would add a declaration that is dropped unchecked, and the claim would test nothing.

`main` is not special to the language: a module is a set of exports, and calling one named `main`
to start a program is a convention of the toolchain ([07](1-programs/07-programs.md)). Examples use
`main` only when they are a program in that sense — run by `wac run`, handed a `Sys`, expected to
exit or print. Everywhere else the export is named for what it answers.

An expectation about one command of the toolchain names it, and may sit beside the build's:

```wac
// expect: emits
// expect (wac check): refused
i32 unused() { return nonexistent(); }     // dropped by the build; wac check checks it
export i32 used() { return 0; }
```

A program of several files marks each one, and its entry is `main.wac`:

```wac
// expect: answers six = 6
// ---- lib.wac ----
export i32 twice(i32 x) { return x * 2; }
// ---- main.wac ----
import { twice } from "./lib.wac";
export i32 six() { return twice(3); }
```

A program may include its manifest, `wac.json5`, and paths may name directories. JSON5 takes `//`
comments, so the same marker works there:

```wac
// expect: answers eight = 8
// ---- wac.json5 ----
{}
// ---- src/lib.wac ----
export i32 four() { return 4; }
// ---- main.wac ----
import { four } from "@/src/lib.wac";
export i32 eight() { return four() * 2; }
```

A file inside a dependency is shown under the dependency's name in angle brackets. `<geometry>/`
is the root of the checkout that the manifest's `geometry` entry resolves to — whatever repository,
ref and lock entry that takes, which a test supplies rather than the example:

```wac
// expect: answers twoViaGeometry = 2
// ---- wac.json5 ----
{ imports: { geometry: { git: "https://example.com/geometry", ref: "v1" } } }
// ---- <geometry>/wac.json5 ----
{ exports: "./src/lib.wac" }
// ---- <geometry>/src/lib.wac ----
export i32 two() { return 2; }
// ---- main.wac ----
import { two } from "geometry";
export i32 twoViaGeometry() { return two(); }
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
export i32 f() { return 1; }

// ERROR: duplicate function 'f'
// export i32 f() { return 2; }
```

The program compiles as written. **Uncommenting any one `// ERROR:` line, and nothing else, makes it
refused** — that is the claim the line makes, and each is checkable on its own. The text after
`ERROR:` names the rule broken; its wording is not part of the language unless a chapter says it is.

### Clause tags

A tag names one behaviour that a test can check:

```wac
// expect: answers outer = 1
export i32 outer() {
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
