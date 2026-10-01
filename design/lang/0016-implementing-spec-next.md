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
| 3 syntax | in progress — `fn<R(P)>` (met 162), match arms without `case` (179), array literals and factories (204; closes `issues/lang/0265c`), module-level `static` |
| 4 checking | open |
| 5 library | open |
| 6 semantics | open |
| 7 tooling | open |
| 8 swap | open |
