# 0016 — implementing `spec/next`

- **Status:** doing
- **Raised by:** agent-a, 2026-10-01, on the operator's instruction to implement the next specification and
  merge it when done

## The target

`spec/next` is the next version of wac, written as examples. The target is a tree where:

- every example in `spec/next` meets its expectations — packages/wacc/test/wac/specexamples_probe.wac
  reports no missed example, and every unsupported one is unsupported for a stated reason that is a property
  of the probe rather than of the language;
- every package, tool and test in the repository is written in the new language, and the suite is green;
- `spec/next` has become `spec/`, the old definition and its case corpus are retired or retagged
  (`spec/next/appendices/D-tag-migration.md`), and `spec/tour.wac` and the repository's guides describe the
  new language.

It is **not** a compatibility exercise. Nothing outside this repository depends on wac.

## Decisions, with their reasons

- **The spec is the authority; the implementation is a head start.** Existing code is used to reduce work and
  never to bend the result: where an existing mechanism is slightly wrong for the spec, it is replaced, not
  accommodated. (The operator, 2026-10-01.)
- **No release accepts both forms of anything.** A syntax change lands as one commit: the compiler, the ladder
  and every file in the repository, rewritten. The old form is refused from that commit on. (Operator.)
- **wapy is deleted**, not migrated — it is outside the specification. (Operator.)
- **Hex literals keep bit-pattern semantics**, bounded by the target width; **core's data structures are
  exported from its root**; **`Sys` is defined here** from what `Cli` and `Core` provide today. (Operator,
  answering the open questions; the `Sys` surface is written into `spec/next/7-library/44-std.md` as it is
  settled.)
- **The ladder moves with the language.** wac-L5 compiles `packages/wacc`, so a syntax change that reaches the
  compiler's own source is taught to `bootstrap/boot/l5.l4` in the same commit. L5 is the minimum that
  compiles wacc; it learns the new form, and whether it also keeps the old is irrelevant once nothing it
  compiles uses it.
- **The probe is the oracle, and it is written to outlive this work.** It reads whatever directory it is
  pointed at, so once `spec/next` becomes `spec/` it becomes the specification's test.

## Order of work

Each step lands with the probe's count moving and the suite green.

1. **The oracle** — the probe, and `spec/next/_drafting/STATUS.md` from it.
2. **Delete wapy.**
3. **Syntax**, each a single commit with the ladder and a repository-wide rewrite:
   `fn<…>`; match arms without `case`, and `default`; `[…]` array literals and `T[].filled`/`.defaulted`;
   module `const` → `static`; subpath-free `core`/`std` imports with core's root exports; verbatim names;
   `private`; `defer`; `matches`; export lists and re-exports; nested-project imports.
4. **Checking rules that refuse code that compiled**: literals with no fallback type; definite assignment
   with defaults on demand; `is`/`matches` precedence; reachability-based checking and exported types as
   roots; `main`'s shape for programs; packed types as ordinary types; uninhabited types.
5. **Library**: `T?` from `Vec.pop`/`Map.get`; `Buf` in core; `wait` answering `Result`; drain and schedule;
   then `Sys` in place of `Cli`/`Core` across every package.
6. **Deep semantics**: static evaluation (the `consteval` branch is the starting point), computed types,
   widening and placeholders, recursive inference, operator dispatch through symbols, tuples and unions,
   coroutines and generators.
7. **Tooling**: the CLI's command behaviours, the manifest without prefix mappings, the test convention,
   bindgen (named instantiations, `private`, the generic warning), audit's bearing types.
8. **The swap**: `spec/next` → `spec/`, retagging by appendix D, the tour, the guides, then merge.

## State of play

| step | state |
|---|---|
| 1 oracle | done — 482 examples, 152 met at the start |
| 2 wapy | done — deleted, with `spec/spec` and `spec/cli` retired |
| 3 syntax | done — `fn<R(P)>`, arms without `case`, array literals and factories (closes `issues/lang/0265c`), module `static`, `core`/`std` named whole, verbatim names, `private`, `defer`, `matches` and `is` at comparison level, export lists and re-exports, nested-project imports and the project boundary (223 met). Left for later steps: `export { ns.member }` (namespaces), `export { G<T> as name }`, markup's quoted tags and hyphenated attributes, field initialisers, bindgen leaving private members out, `defer` in `async` functions |
| 4 checking | in progress — literals with no fallback (comparisons and statements; generic arguments wait on expected-type inference), definite assignment, `never` and uninhabited types, packed types as ordinary types (534 files migrated by a checker-driven codemod that widens each packed read, so arithmetic keeps the width it always ran in). reachability for builds (`src/reach.wac`: a build checks and emits only what the entry's exports reach, and a file no retained declaration needs is not compiled; `check` keeps everything). Waiting: `main`'s shape (on `Sys`, step 5), the spec's struct-default rule (with field initialisers), namespace members in reachability (with namespaces), modelling `wac check` in the probe (step 7) |
| 5 library | in progress — `Buf` in core with the spec's surface (`push(u8)`, `get` answering `u8`, `pushStr`; 136 importers moved, callers narrowed by a checker-driven codemod), a `Vec` has a default (`Vec<i32> v;`), `T?` from `Vec.at`/`first`/`last`/`pop` and `Map.get` (callers moved; `Vec<U?>` still shares `Vec<U>`'s instantiation, so a popped `null` and an empty `Vec` collapse at `T = U?`), nullable numbers cross the host boundary through `$bind$box_<t>_new`/`_get`. Tickets (ch35): core's `Ticket<T>`, `TicketBase`, `Continuation`, `Queue<T>` (`core/ticket.wac`); `async` lowers onto them, every `await` suspends and parks a continuation that the schedule target receives, `wait()` follows what a ticket waits on and answers `Result<T, string>` (`Err` when nothing it may drive can settle it), `await;`, `await` on a `TicketBase?`, `await` nested in an expression when the file writes the ticket's type, `schedule f;` scoped to its block and restored on a machine's resume (the target is one hidden global the emitter owns, behind `__wacScheduleTarget`). Interim, until `Sys`: `Pending.ticket()` bridges a host ticket, `Core.of` installs the program's queue as the default target, and `core.drain()` interleaves ready continuations with one `waitAny` round at a time. `void` as a type argument erases parameters and makes payload-free variants (`Result<void, E>.Ok()`, ch11), so `Ticket<void>` waits like any other. `Sys` (ch07, ch44): std's `Sys` over `Core` and `Cli` with the spec's surface except sockets and `spawn` (`Listener`, `Socket`, `Child` keep their pre-`Sys` shapes), `Grant`, and `run` narrowing what `Sys`'s own methods may do; `Core.exit` is a host capability (V8 and the JavaScript hosts; the wasmtime arm is written and not yet compiled). Building a program (`wac build`, `wac run`, the spec probe) checks `main`'s shape and, for a `main` that takes `Sys`, is `async`, or answers a `Result`, renames it behind an adapter the hosts call as `main(Core, Cli)` (`src/program.wac`). Every program in the repository takes `main(Sys)`, and building one whose `main` takes anything else is refused; the adapter is applied wherever a module is emitted, so the seed and the JavaScript builds get it too. Gaps: the error type of `wait()` is `string` until placeholders (`Result<T>`); `Ticket.all`/`any` wait on variadics; `schedule` is in neither the grammar nor the keyword list of the spec. |
| 6 semantics | in progress — struct defaults and field initialisers, `?.` and `??`, `for (T x in e)` over arrays and Vecs, symbols (`symbol s;`, `[s]` members, `x.[s]`), interpolation converting through core's `toString` with built-in conversions for numbers and `bool` (`core/text.wac`), `null is null` and null tests on numbers, namespaces (inline blocks, `export * as`, `import * as`, `import { ns.member }`, lowered to verbatim dotted names before parsing by `src/namespaces.wac`), operators through core's symbols (binary, reverse `FromLeft`, prefix, compound assignment as its own operation, prefix and postfix increment). tuples (types, literals, `t.N`, member-wise `==`, destructuring in its four spellings, assignment to existing locals; a static selector and variadics wait on static evaluation), `export { ns.member }`, re-exports described in the manifest, `_` bound any number of times, markup as calls (a bare tag calls the function in scope, `<"div">` builds by name, children through `toNode`; `core/html.wac`'s tag functions, pruned from builds that name none), `T??` boxes, `match` on a nullable subject with a `null` arm and arms that leave, `virtual` methods dispatched by `ref.test` at the call site (closes `issues/lang/0144`), `auto` locals. `try` (ch26: native in a function, a `match` settling the ticket in an `async` body; its error must be one of the function's error union's alternatives; `try` is not in the spec's grammar), unions (`union<…>` normalised by `src/unions.wac` in checker and emitter alike; an `anyref` with numbers boxed; insertion into the most specific alternative; literals refused with two numeric alternatives; `match` by alternative with the subject narrowed). Generators and coroutines (ch36): `gen<Y> R` and `async gen<Y> R` lower onto core's `Coroutine<W, Y, R>`, `Step`, `Generator` and `AsyncGenerator` (`core/ticket.wac`); `yield`, `coroutine f(…)` answering an unstarted machine, `for … in` over a generator and `for await` over an async one; each coroutine carries the schedule target it runs under. A container of `void` is refused; a lambda may capture a `void`. Static evaluation (ch27-29, ch31), ported from the `consteval` branch's prototype onto the current syntax: `src/consteval.wac` runs ordinary wac at compile time; a static may call functions and read one declared after it (demand orders the work and the start function); scalars fold; the four failures — a cycle, a trap, a resource limit, a construct the evaluator lacks (named) — are four errors, and a static is never quietly computed at run time; `static` locals (visible throughout their block, by dependency) and `static` struct fields (hoisted to `@"Foo.x"` beside the struct, read as `Foo.x`); `static_if` (the dropped branch unchecked), `static_for` (unrolled, `break` out of one refused) and `static_trap`. Computed types (ch30): `typeref` values and their operations in the evaluator, `type(e)` in a type position, `type` declarations — a plain alias, `= type(e)`, or a body — resolved by the checker and emitter through the evaluator, per instance inside a generic; an ordinary `if` or `static_if` on a `typeref` is decided per instance; `static_match` chooses an arm by type; a function over `typeref`s is left out of the module rather than refusing it. Widening (ch32): a ternary takes its branches' closest common ancestor at the greater nullable depth, an array literal's elements absorb into a union, an expected union takes each branch by itself, and `is T` on a union tests the alternative; the bare `union` placeholder gathers what its scope assigns (ch33). `auto` results (ch34) are inferred per root with path exclusion and written into the source as their type before parsing (`lowerAutoReturns` in `src/api.wac`, using the checker), so nothing downstream sees `auto`; `null` is a type (`never?`, ch10). Generics (ch19): a letter is bound by typed arguments, then by the slot the call fills, then by a number's natural type; `export { max<i32> as maxI32 }` lowers to a forwarding function, a type instance to an alias; every instantiation a file makes of its own generic functions is checked again with the letters bound (`checkInstances`), which also decides `static_match` arms and reaches `static_trap`s per instance. Variadic parameters (ch14) are tuples the call site packs (`lowerVariadics`); `t.[i]` selects by a static index; an expression over a `typeref` folds to a constant per instance. A generic struct's static field is one static per instantiation a file writes, and a symbol-named one is reached as `T.[s]` (ch27, ch21). The spec probe builds a fence that has a `wac.json5` with `wac build` itself, so project boundaries (ch02) are judged by the command's own resolution (`packages/wac/src/sources.wac`). Open: a computed type reaching itself (ch29), alias cycles through nullability, unions in `matches`, `auto` results per generic instantiation and across files, placeholders and defaults in type arguments (`Result<T>`), an instantiation's diagnostics reported at the template rather than the call, instance checks of imported generics and of methods, the permission on a `const` result, `null` into `T?` at a numeric `T`, a variadic method (`Ticket.all`) |
| 7 tooling | open |
| 8 swap | open |
