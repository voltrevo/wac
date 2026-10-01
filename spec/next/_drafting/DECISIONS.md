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
9. **A program may span projects through a relative path.** 02's `@/` example has the entry project
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
