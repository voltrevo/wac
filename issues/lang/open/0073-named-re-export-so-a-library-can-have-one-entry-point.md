# 0073 — named re-export, so a library can have one entry point

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a, from the operator's call (2026-08-05)
- **Date:** 2026-08-05
- **Kind:** missing feature
- **Symptom:** not implemented

## What is missing

```wac
// fmt/src/mod.wac — one entry point for a library
export { itoa, itoa64, utoa64 } from "./itoa.wac";
export { ftoa } from "./ftoa.wac";
```

Today that is a compile error: `[§wac-no-reexport-f7kn4wq]` says importing a symbol from a file that
merely imports it is an error, and there is no syntax for forwarding one deliberately.

**Wanted:** an explicit, *named* re-export. **Not wanted:** `export * from "./x.wac"`.

The operator's reasoning, which is the decision this issue records: a single entry point for a library
is valuable, and the thing to avoid is a name whose origin you cannot trace without asking "what
propagates through this other file?". Naming every forwarded symbol keeps `rg` a complete answer to
"where does this come from"; a star does not.

## Why the current rule is not a principle

The tour presents it as "go to the file that declares it", and I have been treating that as a design
stance. The operator's read is that it is simply a missing feature, and having now paid its cost twice
in one day I agree.

What the rule *does* protect is real, and a named re-export keeps all of it:

- **Identity is the declaring file.** Symbols are mangled `<filestem>$<name>`, so two files may each
  declare `Point` and stay distinct types. A re-export must therefore be an *alias*, not a copy: after
  `export { Box } from "./lib.wac"`, `mod$Box` and `lib$Box` must be one type, exactly as
  `[§wac-alias-same-type-j3wq8kf]` already requires of `import { Box as B }`.
- **No hidden fan-out.** That is what excluding `export *` buys, and it is the whole difference between
  this and the barrel files that make dependency graphs unreadable in other languages.

## What it costs today, measured

`wac-mono` has integer formatting in four places: `packages/fmt/src/itoa.wac` (the natural home, and its
own comment says so), `packages/box/src/lib/num.wac`, `packages/sh/src/program.wac`, and
`packages/wactest`'s `itoa64.wac`/`utoa64.wac`. Two of the copies had bugs the others did not — one
printed `"-"` for i32's minimum, one silently ignored a leading `-` in `atoi`.

Unifying them means every importer's import line changes, because **no compatibility shim is
expressible**. I moved `sh` (2 files) and `box` (19 files) today. I did *not* move `wactest`'s pair,
which 40-odd wac test files import, because another agent is actively writing several of those files and
a mechanical sweep through in-flight work is a merge conflict for no behaviour change. So the duplicate
stays, with a comment saying why — which is exactly the scar tissue the project tries not to accumulate.

With named re-export, that move is one new file plus a deprecation window, and the old path keeps
working while importers migrate at their own pace.

## Design sketch

- **Syntax:** `export { a, b as c } from "./file.wac";` — the same brace list and `as` renaming as
  `import`, with `export` in front. A bare `export from` and `export *` are errors; the error should say
  that every forwarded name must be written down, and why.
- **Semantics:** the re-exporting file gains no declaration. It records a binding from its own export
  namespace to another file's declared symbol, so the mangled name that reaches wasm is still the
  declaring file's. `export { Box as B } from "./lib.wac"` must satisfy the alias-is-not-a-new-type rule.
- **Chains:** a re-export of a re-export should work, or be refused with a message that says which. Two
  hops is where "trace a name" starts to hurt, so refusing it and requiring the original path is
  defensible — worth deciding, not guessing, and it belongs in the spec paragraph either way.
- **Cycles:** wac already allows circular imports (files hold only declarations). A cycle among
  re-exports needs a decision too: resolvable by name, or an error.
- **Collisions:** two `export { foo } from` lines naming different `foo`s is the existing
  same-scope-collision rule, and should be caught with the existing wording.
- **Spec:** `[§wac-no-reexport-f7kn4wq]` becomes "no *implicit* re-export" — importing still does not
  forward — plus a new paragraph for the explicit form. The tour's line changes from "go to the file that
  declares it" to naming both mechanisms.

## Reproduction

```wac
// a.wac
export i32 foo() { return 42; }
```

```wac
// b.wac
export { foo } from "./a.wac";   // wanted; today a parse error
```

```wac
// main.wac
import { foo } from "./b.wac";
export i32 test() { return foo(); }   // wanted: 42
```

Expected: `42`.
Actual: `b.wac` does not parse, and the `import { foo } from "./a.wac"` workaround plus
`import { foo } from "./b.wac"` is `[§wac-no-reexport-f7kn4wq]`.
