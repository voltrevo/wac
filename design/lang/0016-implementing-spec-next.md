# 0016 — implementing `spec`

- **Status:** done — `spec/next` became `spec/` on 2026-10-03
- **Raised by:** agent-a, 2026-10-01, on the operator's instruction to implement the next specification and
  merge it when done

## The target

`spec` is the next version of wac, written as examples. The target is a tree where:

- every example in `spec` meets its expectations — packages/wacc/test/wac/specexamples_probe.wac
  reports no missed example, and every unsupported one is unsupported for a stated reason that is a property
  of the probe rather than of the language;
- every package, tool and test in the repository is written in the new language, and the suite is green;
- `spec` has become `spec/`, the old definition and its case corpus are retired or retagged
  (`spec/appendices/D-tag-migration.md`), and `spec/tour.wac` and the repository's guides describe the
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
  answering the open questions; the `Sys` surface is written into `spec/7-library/44-std.md` as it is
  settled.)
- **The ladder moves with the language.** wac-L5 compiles `packages/wacc`, so a syntax change that reaches the
  compiler's own source is taught to `bootstrap/boot/l5.l4` in the same commit. L5 is the minimum that
  compiles wacc; it learns the new form, and whether it also keeps the old is irrelevant once nothing it
  compiles uses it.
- **The probe is the oracle, and it is written to outlive this work.** It reads whatever directory it is
  pointed at, so once `spec` becomes `spec/` it becomes the specification's test.

## Order of work

Each step lands with the probe's count moving and the suite green.

1. **The oracle** — the probe, and `spec/_status/STATUS.md` from it.
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
8. **The swap**: `spec` → `spec/`, retagging by appendix D, the tour, the guides, then merge.

## State of play

| step | state |
|---|---|
| 1 oracle | done — 482 examples, 152 met at the start |
| 2 wapy | done — deleted, with `spec/spec` and `spec/cli` retired |
| 3 syntax | done — `fn<R(P)>`, arms without `case`, array literals and factories (closes `issues/lang/0265c`), module `static`, `core`/`std` named whole, verbatim names, `private`, `defer`, `matches` and `is` at comparison level, export lists and re-exports, nested-project imports and the project boundary (223 met). Left for later steps: `export { ns.member }` (namespaces), `export { G<T> as name }`, markup's quoted tags and hyphenated attributes, field initialisers, bindgen leaving private members out, `defer` in `async` functions |
| 4 checking | in progress — literals with no fallback (comparisons and statements; generic arguments wait on expected-type inference), definite assignment, `never` and uninhabited types, packed types as ordinary types (534 files migrated by a checker-driven codemod that widens each packed read, so arithmetic keeps the width it always ran in). reachability for builds (`src/reach.wac`: a build checks and emits only what the entry's exports reach, and a file no retained declaration needs is not compiled; `check` keeps everything). Waiting: `main`'s shape (on `Sys`, step 5), the spec's struct-default rule (with field initialisers), namespace members in reachability (with namespaces), modelling `wac check` in the probe (step 7) |
| 5 library | in progress — `Buf` in core with the spec's surface (`push(u8)`, `get` answering `u8`, `pushStr`; 136 importers moved, callers narrowed by a checker-driven codemod), a `Vec` has a default (`Vec<i32> v;`), `T?` from `Vec.at`/`first`/`last`/`pop` and `Map.get` (callers moved; `Vec<U?>` still shares `Vec<U>`'s instantiation, so a popped `null` and an empty `Vec` collapse at `T = U?`), nullable numbers cross the host boundary through `$bind$box_<t>_new`/`_get`. Tickets (ch35): core's `Ticket<T>`, `TicketBase`, `Continuation`, `Queue<T>` (`core/ticket.wac`); `async` lowers onto them, every `await` suspends and parks a continuation that the schedule target receives, `wait()` follows what a ticket waits on and answers `Result<T, string>` (`Err` when nothing it may drive can settle it), `await;`, `await` on a `TicketBase?`, `await` nested in an expression when the file writes the ticket's type, `schedule f;` scoped to its block and restored on a machine's resume (the target is one hidden global the emitter owns, behind `__wacScheduleTarget`). Interim, until `Sys`: `Pending.ticket()` bridges a host ticket, `Core.of` installs the program's queue as the default target, and `core.drain()` interleaves ready continuations with one `waitAny` round at a time. `void` as a type argument erases parameters and makes payload-free variants (`Result<void, E>.Ok()`, ch11), so `Ticket<void>` waits like any other. `Sys` (ch07, ch44): std's `Sys` over `Core` and `Cli` with the spec's surface except sockets and `spawn` (`Listener`, `Socket`, `Child` keep their pre-`Sys` shapes), `Grant`, and `run` narrowing what `Sys`'s own methods may do; `Core.exit` is a host capability (V8 and the JavaScript hosts; the wasmtime arm is written and not yet compiled). Building a program (`wac build`, `wac run`, the spec probe) checks `main`'s shape and, for a `main` that takes `Sys`, is `async`, or answers a `Result`, renames it behind an adapter the hosts call as `main(Core, Cli)` (`src/program.wac`). Every program in the repository takes `main(Sys)`, and building one whose `main` takes anything else is refused; the adapter is applied wherever a module is emitted, so the seed and the JavaScript builds get it too. Gaps: the error type of `wait()` is `string` until placeholders (`Result<T>`); `Ticket.all`/`any` wait on variadics; `schedule` is in neither the grammar nor the keyword list of the spec. |
| 6 semantics | in progress — struct defaults and field initialisers, `?.` and `??`, `for (T x in e)` over arrays and Vecs, symbols (`symbol s;`, `[s]` members, `x.[s]`), interpolation converting through core's `toString` with built-in conversions for numbers and `bool` (`core/text.wac`), `null is null` and null tests on numbers, namespaces (inline blocks, `export * as`, `import * as`, `import { ns.member }`, lowered to verbatim dotted names before parsing by `src/namespaces.wac`), operators through core's symbols (binary, reverse `FromLeft`, prefix, compound assignment as its own operation, prefix and postfix increment). tuples (types, literals, `t.N`, member-wise `==`, destructuring in its four spellings, assignment to existing locals; a static selector and variadics wait on static evaluation), `export { ns.member }`, re-exports described in the manifest, `_` bound any number of times, markup as calls (a bare tag calls the function in scope, `<"div">` builds by name, children through `toNode`; `core/html.wac`'s tag functions, pruned from builds that name none), `T??` boxes, `match` on a nullable subject with a `null` arm and arms that leave, `virtual` methods dispatched by `ref.test` at the call site (closes `issues/lang/0144`), `auto` locals. `try` (ch26: native in a function, a `match` settling the ticket in an `async` body; its error must be one of the function's error union's alternatives; `try` is not in the spec's grammar), unions (`union<…>` normalised by `src/unions.wac` in checker and emitter alike; an `anyref` with numbers boxed; insertion into the most specific alternative; literals refused with two numeric alternatives; `match` by alternative with the subject narrowed). Generators and coroutines (ch36): `gen<Y> R` and `async gen<Y> R` lower onto core's `Coroutine<W, Y, R>`, `Step`, `Generator` and `AsyncGenerator` (`core/ticket.wac`); `yield`, `coroutine f(…)` answering an unstarted machine, `for … in` over a generator and `for await` over an async one; each coroutine carries the schedule target it runs under. A container of `void` is refused; a lambda may capture a `void`. Static evaluation (ch27-29, ch31), ported from the `consteval` branch's prototype onto the current syntax: `src/consteval.wac` runs ordinary wac at compile time; a static may call functions and read one declared after it (demand orders the work and the start function); scalars fold; the four failures — a cycle, a trap, a resource limit, a construct the evaluator lacks (named) — are four errors, and a static is never quietly computed at run time; `static` locals (visible throughout their block, by dependency) and `static` struct fields (hoisted to `@"Foo.x"` beside the struct, read as `Foo.x`); `static_if` (the dropped branch unchecked), `static_for` (unrolled, `break` out of one refused) and `static_trap`. Computed types (ch30): `typeref` values and their operations in the evaluator, `type(e)` in a type position, `type` declarations — a plain alias, `= type(e)`, or a body — resolved by the checker and emitter through the evaluator, per instance inside a generic; an ordinary `if` or `static_if` on a `typeref` is decided per instance; `static_match` chooses an arm by type; a function over `typeref`s is left out of the module rather than refusing it. Widening (ch32): a ternary takes its branches' closest common ancestor at the greater nullable depth, an array literal's elements absorb into a union, an expected union takes each branch by itself, and `is T` on a union tests the alternative; the bare `union` placeholder gathers what its scope assigns (ch33). `auto` results (ch34) are inferred per root with path exclusion and written into the source as their type before parsing (`lowerAutoReturns` in `src/api.wac`, using the checker), so nothing downstream sees `auto`; `null` is a type (`never?`, ch10). Generics (ch19): a letter is bound by typed arguments, then by the slot the call fills, then by a number's natural type; `export { max<i32> as maxI32 }` lowers to a forwarding function, a type instance to an alias; every instantiation a file makes of its own generic functions is checked again with the letters bound (`checkInstances`), which also decides `static_match` arms and reaches `static_trap`s per instance. Variadic parameters (ch14) are tuples the call site packs (`lowerVariadics`); `t.[i]` selects by a static index; an expression over a `typeref` folds to a constant per instance. A generic struct's static field is one static per instantiation a file writes, and a symbol-named one is reached as `T.[s]` (ch27, ch21). The spec probe builds a fence that has a `wac.json5` with `wac build` itself, so project boundaries (ch02) are judged by the command's own resolution (`packages/wac/src/sources.wac`). Default type arguments (ch19): `= D` on a type parameter, written into every use that omits it (`lowerTypeDefaults`); a `union` default in a function's or method's result is gathered from its `Err` payloads and `try`s (`lowerResultPlaceholders`), which is what makes core's `Result<T>` a type. `fromNumber` (ch09): core's `NumberLiteral`, the `fromNumber` symbol and the built-in numbers' conversions; a literal in a `[fromNumber]` type's slot becomes a static computed at compile time, an `Err` refused at the literal. Static evaluation runs methods, `match`, `try` and generic functions. Open: a computed type reaching itself (ch29), alias cycles through nullability, unions in `matches`, `auto` results per generic instantiation and across files, a `union` default nested in a local's type, an instantiation's diagnostics reported at the template rather than the call, instance checks of imported generics and of methods, the permission on a `const` result, `null` into `T?` at a numeric `T`, a variadic method (`Ticket.all`) |
| 7 tooling | done except where the spec needs a decision — the manifest without prefix mappings (spec ch04): a key is a complete package name and one ending in `/` is refused; importing a package imports the module its directory's own `wac.json5` names in `exports` (`subdir` selects that directory), with no fallback; `exports` and `subdir` begin with `./`; the project's own manifest is checked even when unused; a build resolves a package only when a retained declaration needs it. The spec probe builds a fence with a manifest, a `@/` or a package checkout through `wac build`, filling `$WAC_HOME`'s cache and a lock itself. bindgen (ch48): `.wac.ts` and a summary line, `_` class names (`Vec_f64`), `export { G<T> as N }` binding the class `N`, `__bindgenSkipped` with a `// skipped:` comment for each export left out and each generic the entry exports (which also warns), `ref`, `of` (not generated beside a declared `of` or a private field), `toObject()`, private members left out, no setter for a `const` field, a payload getter that throws for another variant. `wac audit` (ch49) per dependency from `Sys`. `wac test` (ch47): tests taking `Sys` or `async`, `void` and verbatim tests in directory runs, a filter matching nothing and an all-ungranted file reported and exit 0. `wac check` (ch06, ch45): alone over the project with `check.exclude`, with several files, always ending with its count. Left for a decision: `wac run`'s argument types (the host takes more than ch45 lists), `--quiet` (the suite reads the FAIL lines it prints), and `wac app`'s version (blank by ruling). |
| 8 swap | done, 2026-10-03 — `spec/next` is `spec/`; the probe, `specstatus` and the tag guard read it there, `STATUS.md` and `MET` are in `spec/_status/`, tests and cases cite this spec's tags (appendix D's replacements substituted, retired ones dropped), and the drafting aids are deleted. 481 of 482 examples met; ch35:529 (`Ticket.all`) is a gap in the spec, not the compiler |

## Appendix — drafting decisions

Kept from the drafting directory's DECISIONS.md when it was retired: where the sources
disagreed while the specification was written, and which way each disagreement went.

Drafting aid, deleted when the spec is done. Where sources disagreed, the order was: the settled
design documents, then `vision/`, then `spec/spec`, and the implementation is evidence of nothing.
Every place that order decided something is listed, so none of it happens silently.

Status: **taken** (the chapter follows it; say if wrong) · **needs you** (the chapter avoids it).

### Chapters 01–03

#### Needs you

1. **Where `Vec` and the rest of core live in its public API.** spec/spec/imports.md and
   `vision/spec/imports.wac` reach them by file — `import { Vec } from "core/vec.wac"` — and say
   `import { Vec } from "core"` is an error. The design removes package subpaths entirely, so that
   form is gone. What replaces it is open: everything at core's root (`import { Vec } from "core"`),
   or a namespace per area (`import { collections.Vec } from "core"`). The design puts `toString`,
   `toNode` and `fromNumber` at the root and the operator symbols in `core.operators`, which is
   evidence for "root unless it is a family". Chapters 01–03 use only `Read` and `operators`, which
   are settled. Decided in 37.
2. **`std`'s shape.** spec/spec/imports.md says `std` has no root module and every name is reached
   by path (`std/platform.wac`) — `[§wac-std-no-root-2vp6xmk]`. Without subpaths that cannot hold,
   so `std` gets an entry module like any package. Its namespaces are 44's question, and the old tag
   is retired.
3. **`[§wac-std-imports-core-7hn3qrz]`: a file in a built-in package may import only `core`.** Its
   stated reason is how the toolchain carries built-ins (as text, with no filesystem behind them),
   which constrains the authors of `std` rather than any program. Proposed: cut from the language
   spec. Left out of 02 pending your call.

#### Taken

4. **Package specifiers are exact names; prefix mappings are gone.** `spec/spec` allows
   `"dep/": { … }` with the unmatched suffix appended to `subdir`. The design removes prefix keys and
   suffixes. `[§wac-import-mapped-6np2rkq]` and `[§wac-import-undefined-h4mq9xk]` (which listed four
   specifier kinds) are replaced by `[§wac-specifier-kinds-sgmw8y4]` (three kinds) and
   `[§wac-no-subpath-wqatc72]`. 04 will take the manifest side.
5. **Module-level `const` becomes `static`** in every example (design 13). `vision/spec/imports.wac`
   writes `export const i32 LIMIT`.
6. **Spellings follow the design and vision over current spec**, everywhere in examples:
   `fn<…>` not `fn[…]`; match arms without `case` (`Data(b): …`); array literals `[7, 7, 7]` not
   `u8[](7, 7, 7)`.
7. **One collision rule for every kind of declaration.** spec/spec/naming.md states function/struct
   only (`[§wac-dup-kind-9h0mrly]`, kept); `vision/spec/naming.wac` says *"whatever the two things
   are"*. Added `[§wac-dup-any-kind-ctguh44]` for the general rule.
8. **A namespace cannot be reopened.** The design says reopening and merging are *"not proposed
   here"*. A spec has to say what happens, and the general collision rule already refuses a second
   declaration, so 03 states it: `[§wac-namespace-once-7ar5jqz]`.
9. **Reversed by the operator:** relative and `@/` imports stay inside their project; another project is
   reached by package name only (`wac-import-within-project`). Formerly: **A program may span projects through a relative path.** 02's `@/` example has the entry project
   reach a nested project with `./vendored/…`. Current spec allows this explicitly. The design leaves
   *package* boundaries open, which 02 lists as Open — a project directory is not a package.
10. **Static declarations are UPPER_SNAKE by convention.** Current spec gives conventions for types,
    functions and variables only. The design's examples consistently write `SIZE`, `TABLE`, `ANSWER`,
    so 01 states it — as a convention, not a rule.
11. **`_` and verbatim names come from vision.** `vision/DECISIONS.md` says an entry is deleted once it
    reaches the spec. `vision/` is being left alone, so `_`'s entry stays there for now.

#### Moved to a later chapter

- `[§wac-core-read-6kv4pnx]` (why `Read` has three variants) → 41.
- `[§wac-struct-export-const-r7nf4jq]` (`export const struct`) → 12, with struct modifiers.
- `[§wac-export-entry-only-v3kp8wn]`, `[§wac-export-no-collision-m4fn9rk]` (which functions become
  wasm exports) → 07, since they concern the compiled program rather than modules naming each other.

#### Excluded as implementation, not language

- spec/spec/imports.md *Name mangling* and *Import resolution*: how the compiler labels and indexes
  declarations. 01 states the observable rule they served — identity is the declaring file, not a
  spelling.

### Chapters 04–49 and the appendices

All **taken**. Where one reverses something written in chapters 01–03, it says so.

#### Programs (04–07)

- **Prefix mappings are gone.** A dependency key is a whole package name (`[§wac-package-key-exact-rme93fh]`);
  `[§wac-import-mapped-6np2rkq]` retired.
- **Item 3 above is taken as proposed:** `[§wac-std-imports-core-7hn3qrz]` is retired (D), not placed.
- **05's section on statics** was rewritten to remove a contradiction with 27–29.
- **Every 06 example carries its `wac.json5`**, since full-project checking is defined by one.

#### Types (08–21)

- **Packed types are ordinary types** (vision/DECISIONS): nullable, castable, locals, parameters and results. Seven
  `wac-arr-i8-*`/packed tags retired or replaced.
- **Uninhabited types are valid** (proposal 18 and vision); `[§wac-recursive-nodefault-1os4yl4]` replaced.
- **Struct defaults come only from field initialisers.** A field without one has no default; a local may be declared
  unassigned and must be assigned before it is read. `[§wac-struct-default-ar2wgyf]`, `[§wac-uninit-nypziz8]` replaced.
- **`virtual`/`override` dispatch dynamically** (vision/TECHNICAL); the static-dispatch tag is retired.
- **Sized arrays are `T[].filled(n, v)` and `T[].defaulted(n)`**; `T[n]()` is gone.
- **Hex literals:** the bit-pattern/value question is Open in 09, and five hex tags are suspended (D).
- **A call skips a non-callable local** of the same name (01), reconciling `vision/spec/functions.wac`.
- **Generic enum methods are checked at definition**, like everything else under two-pass checking.
- **An expected type infers type parameters**, and computed types never do: `fromSlot<i32>(5)` is written.

#### Expressions (22–26)

- **Interpolation converts through `toString`; markup tags are functions** in `core.html`, children through `toNode`.
  `[§jsx-component-renders]` replaced.
- **`default` replaces `else` in `match`**; a nullable subject takes a `null` arm; `matches` and `defer` added (vision).
- **`??` binds looser than arithmetic** (22's table).
- **`as~` rounds half to even.**
- **A char literal at or above 128 is not a byte** (16).

#### Static (27–31)

- **Module `const` is `static`.** `wac-modconst-*` tags kept where the rule is unchanged, replaced where static
  evaluation now allows calls.
- **`static_if` checks every branch**; only the chosen one is emitted.
- **`typeref` at run time is Open**; examples use it only in static initialisers.

#### Concurrency (35–36)

- **`wait` answers `Result`**, and refuses rather than traps when nothing can advance the ticket.
- **`drain` and `schedule`** replace `core.drain()`; a default schedule target is stated.

#### Library (37–44)

- **`core` and `std` export from their roots;** no subpaths. `std`'s root exports `Sys`, which replaces `Cli`/`Core` as
  the capability.
- **`Vec.pop` and `Map.get` answer `T?`**, not `Option<T>`.
- **`Buf` is in `core`, with `pushStr`.** The linked list and the old `Buffer` were example programs; their tags are
  retired (D).
- **The rest of the host surface** (directories, processes, environment, terminal) is Open in 44.

#### Tooling (45–49)

- **Host and build history is dropped** from the CLI chapter; it states behaviour only.
- **`wac update` is the only networked command**, and a missing lock entry is refused naming it (46).
- **Tests:** `test*` exports, `""` or `void` return passes, `test_traps_*` must trap, verbatim names allowed (47). A
  test wanting an ungranted capability is *not run*, not failed.
- **Bindgen** follows the new spellings (`fn<…>`), maps packed types and `u*[]` arrays, and binds `T?` as `T | null`
  everywhere — `Map.get` therefore returns `number | null`, not an `Option_*` class. Its file is `main.wac.ts`
  (bindgen.md), not `main.gen.ts` (cli/wac.md). Async exports are Open.
- **Audit's bearing types** are `Sys` and the handles `std` gives out, replacing `Cli`/`Core`; derived authority is
  therefore in scope rather than a stated limit.

#### Appendices

- **A** is rewritten against the new syntax; the keyword rule is now "reserved", not "matches the lexer".
- **B** keeps the diagnostic tags whose wording is unchanged; the `i32 n = 3.14` diagnostic is restated for literals with
  no type of their own. Soundness stays in 26.
- **D** lists every current tag not carried, replaced or retired, with the reason. Nine pairs of current tags share a
  suffix; both are carried, and D says so.

### Exports and `main` (after review)

- **An example exports what it tests** (README). `main` appears only in programs (Sys, exits, prints).
  `answers f(args) = v` takes arguments, and a fence may carry several.
- **Every export of the entry is an entry point**, types and statics included (05,
  `wac-reach-export-type-root`). Any non-generic function may be exported whatever its signature (07).
- **Import-shaped ERROR lines** became `refused` fences that use the imported name: under 05's lazy reading,
  an unused import of a missing name is not an error, so the commented line tested nothing.
- **`is`, `is not` and `matches` bind as comparisons**, tighter than `&&`: every example, appendix A and
  vision/TECHNICAL's `Ok(cfg) matches res && …` assume it, against spec/spec's table. Retagged (D).

### Chapter 02's open questions (operator's ruling)

- **`export { a, b as c } from "m"` is supported** — several names and renames; no local binding; identity kept;
  collides with other exports of the name; lazy like an import; a namespace member re-exports under its own
  name; in the entry, a re-exported function is a program export. The no-implicit-re-export rule stays.
- **Relative imports stay inside the package boundary**, taken as the project: the target's nearest
  `wac.json5` must be the importer's own (two files with none count as the same). 02's `@/` example now
  spans projects through a dependency instead of `./vendored/`.
- **Revised:** a nested project is imported by naming its directory (`"./vendored"`, `"@/vendored"`), which
  resolves to its `exports` module; no `exports` is an error. Any other path into a nested project, including
  into a project nested within it, is refused, as is a path out past the project root
  (`wac-import-nested-project`, `wac-import-within-project`). "Project" is any directory with a `wac.json5`;
  a "package" is a project with `exports` — so only a nested project that is a package can be imported.
- **Inline namespace visibility (operator's ruling, 03):** a member without `export` is visible only inside
  the namespace block; an exported member of an unexported namespace is visible only within its module.
- **Export lists (operator's ruling):** `export { a, b as c };` exports visible declarations, own or imported (an
  explicit re-export). `export { ns.member }` is refused; `export { ns.member as m }` works when the member is
  visible, which lifts it out of an unexported namespace. `export { G<T> as N }` exports an instantiation — a
  callable function in the compiled program, a type bound by bindgen as `N`. Taken: one declaration may be
  exported under several names; a name exported twice collides. Bindgen today silently skips exported generics
  (`collectBindStructs` drops anything with type parameters); 48 now lists them in `__bindgenSkipped` with the
  export-list form that would bind them.
- **Generic exports are fine (operator):** `export { Box };` exports the generic; only bindgen leaves it out. `wac
  bindgen` warns for each generic the entry exports with no instantiation exported by name (not for generics other
  modules export). Taken: a generic that also has a named instantiation draws no warning.
- **Revised (operator):** `export { ns.member }` is allowed and exports `member`, symmetric with
  `import { ns.member }`; `as` remains optional. Instantiations still need `as`. Retagged
  `wac-export-member-as` → `wac-export-member` (both new in this spec).
- **Definite assignment (operator):** one flow-sensitive rule in 08. Paths intersect at joins; exits (`return`,
  `trap`, `break`, `continue`, `never`) constrain nothing; conditions are not evaluated except `while (true)`/no-condition
  `for`. A defaulted type's default fills in only where a read can reach the local unassigned, built as if at the
  declaration; `Point p;` is legal for any `Point`. Lambdas capture only definitely assigned locals. Struct and tuple
  locals are tracked part by part until first use; a `const` field may be assigned once before first use. Replaces
  the eager `wac-struct-default-decl` (new in this spec, retagged).
- **`private` (operator):** fields, methods and static members of structs, and methods of enums; visible only in the
  declaring type's body. Positional construction outside a struct with a private field is refused; named construction
  may omit, not name, a private field. Subtypes do not see parent private members; a subtype of a struct with a
  private field lacking a default cannot be constructed, and its declaration is refused. A private method's name stays
  taken; `private virtual` refused. Reflection sees name and type, not value. Bindgen omits private members and `of`.
  Enums have no static methods (13 refuses them), so `private` there covers instance methods only.
- **`main` is ordinary (operator):** its return-type and status rules apply only when building a program (`wac build`/`run`/`app`); `wac compile` and other modules treat it as any export.
- **A program's `main` takes nothing or one `Sys` (operator).** Arguments arrive through `sys.args()`, added to 44 (no grant), since 45 already promised them to the program.
- **`accept` (agreed):** `Result<Socket>`; `Err` only for listener-level failure; connections that die before acceptance are retried by the host, never reported. The server example matches and backs off instead of `try`. A `close` on `Listener` would need a third outcome.
