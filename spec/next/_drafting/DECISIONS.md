# Decisions and conflicts — for review

Drafting aid, deleted when the spec is done. Where sources disagreed, the order was: the settled
design documents, then `vision/`, then `spec/spec`, and the implementation is evidence of nothing.
Every place that order decided something is listed, so none of it happens silently.

Status: **taken** (the chapter follows it; say if wrong) · **needs you** (the chapter avoids it).

## Chapters 01–03

### Needs you

1. **Where `Vec` and the rest of core live in its public API.** `spec/spec/imports.md` and
   `vision/spec/imports.wac` reach them by file — `import { Vec } from "core/vec.wac"` — and say
   `import { Vec } from "core"` is an error. The design removes package subpaths entirely, so that
   form is gone. What replaces it is open: everything at core's root (`import { Vec } from "core"`),
   or a namespace per area (`import { collections.Vec } from "core"`). The design puts `toString`,
   `toNode` and `fromNumber` at the root and the operator symbols in `core.operators`, which is
   evidence for "root unless it is a family". Chapters 01–03 use only `Read` and `operators`, which
   are settled. Decided in 37.
2. **`std`'s shape.** `spec/spec/imports.md` says `std` has no root module and every name is reached
   by path (`std/platform.wac`) — `[§wac-std-no-root-2vp6xmk]`. Without subpaths that cannot hold,
   so `std` gets an entry module like any package. Its namespaces are 44's question, and the old tag
   is retired.
3. **`[§wac-std-imports-core-7hn3qrz]`: a file in a built-in package may import only `core`.** Its
   stated reason is how the toolchain carries built-ins (as text, with no filesystem behind them),
   which constrains the authors of `std` rather than any program. Proposed: cut from the language
   spec. Left out of 02 pending your call.

### Taken

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
7. **One collision rule for every kind of declaration.** `spec/spec/naming.md` states function/struct
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

### Moved to a later chapter

- `[§wac-core-read-6kv4pnx]` (why `Read` has three variants) → 41.
- `[§wac-struct-export-const-r7nf4jq]` (`export const struct`) → 12, with struct modifiers.
- `[§wac-export-entry-only-v3kp8wn]`, `[§wac-export-no-collision-m4fn9rk]` (which functions become
  wasm exports) → 07, since they concern the compiled program rather than modules naming each other.

### Excluded as implementation, not language

- `spec/spec/imports.md` *Name mangling* and *Import resolution*: how the compiler labels and indexes
  declarations. 01 states the observable rule they served — identity is the declaring file, not a
  spelling.

## Chapters 04–49 and the appendices

All **taken**. Where one reverses something written in chapters 01–03, it says so.

### Programs (04–07)

- **Prefix mappings are gone.** A dependency key is a whole package name (`[§wac-package-key-exact-rme93fh]`);
  `[§wac-import-mapped-6np2rkq]` retired.
- **Item 3 above is taken as proposed:** `[§wac-std-imports-core-7hn3qrz]` is retired (D), not placed.
- **05's section on statics** was rewritten to remove a contradiction with 27–29.
- **Every 06 example carries its `wac.json5`**, since full-project checking is defined by one.

### Types (08–21)

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

### Expressions (22–26)

- **Interpolation converts through `toString`; markup tags are functions** in `core.html`, children through `toNode`.
  `[§jsx-component-renders]` replaced.
- **`default` replaces `else` in `match`**; a nullable subject takes a `null` arm; `matches` and `defer` added (vision).
- **`??` binds looser than arithmetic** (22's table).
- **`as~` rounds half to even.**
- **A char literal at or above 128 is not a byte** (16).

### Static (27–31)

- **Module `const` is `static`.** `wac-modconst-*` tags kept where the rule is unchanged, replaced where static
  evaluation now allows calls.
- **`static_if` checks every branch**; only the chosen one is emitted.
- **`typeref` at run time is Open**; examples use it only in static initialisers.

### Concurrency (35–36)

- **`wait` answers `Result`**, and refuses rather than traps when nothing can advance the ticket.
- **`drain` and `schedule`** replace `core.drain()`; a default schedule target is stated.

### Library (37–44)

- **`core` and `std` export from their roots;** no subpaths. `std`'s root exports `Sys`, which replaces `Cli`/`Core` as
  the capability.
- **`Vec.pop` and `Map.get` answer `T?`**, not `Option<T>`.
- **`Buf` is in `core`, with `pushStr`.** The linked list and the old `Buffer` were example programs; their tags are
  retired (D).
- **The rest of the host surface** (directories, processes, environment, terminal) is Open in 44.

### Tooling (45–49)

- **Host and build history is dropped** from the CLI chapter; it states behaviour only.
- **`wac update` is the only networked command**, and a missing lock entry is refused naming it (46).
- **Tests:** `test*` exports, `""` or `void` return passes, `test_traps_*` must trap, verbatim names allowed (47). A
  test wanting an ungranted capability is *not run*, not failed.
- **Bindgen** follows the new spellings (`fn<…>`), maps packed types and `u*[]` arrays, and binds `T?` as `T | null`
  everywhere — `Map.get` therefore returns `number | null`, not an `Option_*` class. Its file is `main.wac.ts`
  (bindgen.md), not `main.gen.ts` (cli/wac.md). Async exports are Open.
- **Audit's bearing types** are `Sys` and the handles `std` gives out, replacing `Cli`/`Core`; derived authority is
  therefore in scope rather than a stated limit.

### Appendices

- **A** is rewritten against the new syntax; the keyword rule is now "reserved", not "matches the lexer".
- **B** keeps the diagnostic tags whose wording is unchanged; the `i32 n = 3.14` diagnostic is restated for literals with
  no type of their own. Soundness stays in 26.
- **D** lists every current tag not carried, replaced or retired, with the reason. Nine pairs of current tags share a
  suffix; both are carried, and D says so.

## Exports and `main` (after review)

- **An example exports what it tests** (README). `main` appears only in programs (Sys, exits, prints).
  `answers f(args) = v` takes arguments, and a fence may carry several.
- **Every export of the entry is an entry point**, types and statics included (05,
  `wac-reach-export-type-root`). Any non-generic function may be exported whatever its signature (07).
- **Import-shaped ERROR lines** became `refused` fences that use the imported name: under 05's lazy reading,
  an unused import of a missing name is not an error, so the commented line tested nothing.
- **`is`, `is not` and `matches` bind as comparisons**, tighter than `&&`: every example, appendix A and
  vision/TECHNICAL's `Ok(cfg) matches res && …` assume it, against spec/spec's table. Retagged (D).

## Chapter 02's open questions (operator's ruling)

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
