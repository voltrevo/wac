# 06 — Checking a project

Normal compilation follows dependencies ([05](05-reachability.md)). Project checking deliberately
covers source that no entry point reaches.

## Full-project checking

```sh
wac check
```

Run from the project to check all project source without requiring it to be reachable from an entry
point. No `--all` flag is needed.

```wac
// expect: emits
// expect (wac check): refused
// ---- wac.json5 ----
{}
// ---- src/unused.wac ----
i32 broken() { return nonexistent(); }    // a normal build never reads this file
// ---- main.wac ----
export i32 main() { return 0; }
```

`[§wac-check-project-x9xt4fg]` `wac check` with no arguments checks every declaration in every
project file, reached or not. A normal build may drop `broken`; full-project checking diagnoses it.

## Checking explicitly supplied files

```sh
wac check ./src/lib.wac ./tools/example.wac
```

`wac check [files]` uses the supplied files as roots and checks their full, transitive import graph.
Every declaration in each reached file is checked, including unused declarations. Every import and
namespace re-export is followed and validated, even when its names are unused.

```wac
// expect (wac check src/lib.wac): refused
// ---- wac.json5 ----
{}
// ---- src/lib.wac ----
import { helper } from "./optional.wac";  // this file does not exist
export i32 answer() { return 42; }
```

Explicit checking still loads and checks `optional.wac`. A missing `optional.wac` is an error even
though `helper` is unused.

`[§wac-check-files-2ncb9c8]` `wac check` with files checks each one, and every file their imports and
namespace re-exports reach, in full — every declaration, and every import whether or not its names
are used.

Supplying files replaces project-wide file discovery; unrelated neighbouring files are not scanned.
Discovery exclusions do not exclude explicitly supplied files or files reached through their imports.
With no files supplied, the project discovery rules below apply.

```wac
// expect (wac check src/lib.wac): emits
// ---- wac.json5 ----
{}
// ---- src/lib.wac ----
export i32 answer() { return 42; }
// ---- src/neighbour.wac ----
i32 broken() { return nonexistent(); }    // not reached from src/lib.wac, so not checked
```

`[§wac-check-files-no-discovery-km2e8t2]` Supplying files turns off discovery: a project file that the
supplied files do not reach is not checked.

## Project membership

Discover `.wac` files recursively beneath the directory containing `wac.json5`. Explicit exclusions can
omit fixtures or generated source:

```json5
{
  check: {
    exclude: ["./fixtures/invalid/**", "./generated/**"],
  },
}
```

Exclusion patterns require an explicit `./` prefix and are relative to the project directory.
Exclusions control discovery only: an import from checked code still requires checking its target,
even when that file was excluded from discovery.

```wac
// expect (wac check): refused
// ---- wac.json5 ----
{ check: { exclude: ["./fixtures/**"] } }
// ---- fixtures/invalid.wac ----
i32 broken() { return nonexistent(); }    // excluded, and nothing imports it: not checked
// ---- fixtures/used.wac ----
export i32 alsoBroken() { return nonexistent(); }   // excluded, but imported: checked
// ---- main.wac ----
import { alsoBroken } from "./fixtures/used.wac";
export i32 main() { return 0; }
```

`[§wac-check-exclude-2ixx2cu]` A file matching `check.exclude` is not discovered. It is still checked
if a checked file imports it.

`[§wac-check-exclude-dot-slash-yfwkbsg]` An exclusion pattern must begin with `./`, and is relative to
the project directory.

Dependencies outside the project are followed through imports; their entire source trees are not
scanned for full-project checking.

## Validate unused imports

Both forms of `wac check` validate import targets and requested exports even when the imported names
are unused. Namespace re-exports are validated too.

```wac
// expect: emits
// expect (wac check): refused
// ---- wac.json5 ----
{}
// ---- main.wac ----
import { helper } from "./missing.wac";   // never referenced
export i32 main() { return 0; }
```

```wac
// expect: emits
// expect (wac check): refused
// ---- wac.json5 ----
{}
// ---- existing.wac ----
export i32 something() { return 1; }
// ---- main.wac ----
import { nonexistent } from "./existing.wac";   // existing.wac does not export it
export i32 main() { return 0; }
```

```wac
// expect: emits
// expect (wac check): refused
// ---- wac.json5 ----
{}
// ---- lib.wac ----
export * as optional from "./missing.wac";   // nothing imports lib.wac
// ---- main.wac ----
export i32 main() { return 0; }
```

`[§wac-check-unused-imports-tdqy2m2]` `wac check` refuses an import whose file is missing, an import
of a name its file does not export, and a namespace re-export whose file is missing — whether or not
anything uses the imported names.

Normal builds retain lazy import loading. Full-project checking validates the project without
requiring its declarations or imports to be used first.
