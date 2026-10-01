# C — Glossary

Terms this specification uses with a meaning narrower than everyday English, and the chapter that defines each.

**alias** — an imported name written `as`. It names the same declaration as the original; identity does not change
([01](../1-programs/01-names-and-identity.md)).

**arm** — one case of a `match`: a pattern, `null` or `default`, then `:` and a value or block
([25](../3-expressions/25-control-flow.md)).

**`auto`** — a placeholder for a type, inferred by widening its initialiser or its returns ([33](../5-inference/33-placeholders.md)).

**bearing type** — a type through which a host capability can be reached: `Sys`, a handle it gives out, or a type with a
field, payload or method result that is bearing ([49](../8-tooling/49-audit.md)).

**capability** — the authority to affect the world, held only as a value — a `Sys` or a handle from one. There is no
ambient authority ([07](../1-programs/07-programs.md)).

**construction** — making a struct or variant value: positionally `P(1, 2)`, or by name `P { x: 1, y: 2 }`
([12](../2-types/12-structs.md)).

**continuation** — the rest of an `async` function after an `await`, held by a scheduler until its ticket settles
([35](../6-concurrency/35-tickets-and-await.md)).

**coroutine** — a function that can stop partway and be resumed; generators and `async` functions are both built on one
([36](../6-concurrency/36-coroutines-and-generators.md)).

**default** — of a type, the value a declaration without an initialiser holds, where the type has one; of a field, its
initialiser ([12](../2-types/12-structs.md)); in a `match`, the arm covering everything not named
([25](../3-expressions/25-control-flow.md)).

**deep const** — `const` on a reference forbids writing through it and through every reference reached from it
([17](../2-types/17-const.md)).

**diagnostic** — an error or warning, with its location, span, annotation and hint ([B](B-diagnostics.md)).

**emits** — compiles to a module. A program that *emits* may still trap when run.

**entry** — the module a command is given, from which reachability starts ([05](../1-programs/05-reachability.md)).

**export** — a declaration marked `export`, importable from its module ([02](../1-programs/02-modules-and-imports.md)).

**generator** — a function declared `gen<Y> R`, which yields `Y`s and finally returns an `R`
([36](../6-concurrency/36-coroutines-and-generators.md)).

**grant** — a capability given to a program when it is built, fixed in its module ([45](../8-tooling/45-cli.md)).

**identity** — what makes two declarations the same: the declaration itself, never its spelling
([01](../1-programs/01-names-and-identity.md)).

**instantiation** — a generic declaration with its type parameters filled in, `Vec<i32>`. Each is checked as written
([19](../2-types/19-generics.md)).

**literal** — a number, character, string, `true`, `false` or `null` written in source. A numeric literal has no type of its
own and takes one from where it is used ([09](../2-types/09-numeric-literals.md)).

**lock** — `wac.lock`, pinning each dependency to a commit ([46](../8-tooling/46-manifest-and-lock.md)).

**machine** — a coroutine's state: what it waits on, what it yields and what it returns, stepped by `step()`
([36](../6-concurrency/36-coroutines-and-generators.md)).

**manifest** — `wac.json5`, which makes a directory a project ([46](../8-tooling/46-manifest-and-lock.md)).

**module** — one `.wac` file ([02](../1-programs/02-modules-and-imports.md)).

**namespace** — a group of names, backed by a module or written inline; not a runtime value
([03](../1-programs/03-namespaces.md)).

**never** — the type with no values: the type of an expression that does not complete normally
([11](../2-types/11-never-and-uninhabited.md)).

**normalisation** — reducing a union to its canonical members: flattening, removing duplicates and absorbed members
([18](../2-types/18-unions.md)).

**origin** — an expression that contributes a type to a placeholder's inference ([33](../5-inference/33-placeholders.md)).

**package** — a project others import by name, through its `exports` entry ([04](../1-programs/04-packages.md)).

**packed type** — `i8`, `u8`, `i16` or `u16`: an ordinary integer type, stored narrowly in an array
([08](../2-types/08-primitives.md)).

**project** — a directory with a `wac.json5`. A file belongs to the project of the nearest `wac.json5` at or above it
([02](../1-programs/02-modules-and-imports.md)).

**reachable** — named, directly or through other reachable declarations, from an entry. Only reachable code is emitted
([05](../1-programs/05-reachability.md)).

**refused** — rejected with an error diagnostic; no module is produced.

**scheduler** — what receives continuations nobody awaited: `schedule f;` names it for a block, and `drain` runs what it holds
([35](../6-concurrency/35-tickets-and-await.md)).

**settled** — of a ticket: answered ([35](../6-concurrency/35-tickets-and-await.md)).

**static** — known when the program is compiled. A `static` declaration is computed by static evaluation
([27](../4-static/27-static-declarations.md), [28](../4-static/28-static-evaluation.md)).

**static evaluation** — running ordinary wac at compile time, with the same results it would have at run time
([28](../4-static/28-static-evaluation.md)).

**step boundary** — a point where a machine pauses: every `await`, every `yield`
([36](../6-concurrency/36-coroutines-and-generators.md)).

**symbol** — a nominal identity declared with `symbol name;`, used to name members — operators and conversions among
them ([21](../2-types/21-symbols.md)).

**tag** — a name like `§wac-shadow-8u8qh2j`, attached to the example that shows one rule, and claimed by the tests of
that rule ([README](../README.md)).

**ticket** — a `Ticket<T>`: a value that will answer a `T` ([35](../6-concurrency/35-tickets-and-await.md)).

**trap** — stopping the current call in a way the program cannot catch ([26](../3-expressions/26-errors-and-results.md)).

**tuple** — a fixed-length heterogeneous reference type, `(i32, string)` ([14](../2-types/14-tuples.md)).

**`typeref`** — a type as a static value, which static code can inspect and build ([30](../4-static/30-computed-types.md)).

**uninhabited** — of a type: having no values, like `never`, or a struct with a non-null field that reaches the struct again. Valid, and never defaulted
([11](../2-types/11-never-and-uninhabited.md)).

**union** — a type whose values are values of any of its members, `union<A, B>` ([18](../2-types/18-unions.md)).

**verbatim name** — `@"…"`: a name written exactly, which may be a keyword or hold any character
([01](../1-programs/01-names-and-identity.md)).

**widening** — finding the narrowest type several types all convert to ([32](../5-inference/32-widening.md)).
