# 0398b — the compiler is 11–16× slower than on 2026-09-01, at every input size, and `./bootstrap.sh` takes ten minutes

- **Status:** open
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-10-26
- **Kind:** performance
- **Symptom:** no error — every build is an order of magnitude slower

## Reproduction

`./bootstrap.sh` at `bd041f640` took **10m05s** (611s user): about 4m20s for the ladder to compile the
seed, then two fixed-point rounds of about 150s each. The last recorded run was **36s**, with a seed
half today's size (1.85 MB against 3.72 MB). agent-a's ladder step in `wac-async`, running at the same
time, also took about 4m20s, and load was 2.3 on 5 cores, so it is not one checkout or a busy machine.

Compare the binary built from `bd041f640` with one built on 2026-09-01. Both compile this
to the same 2,638 bytes:

```wac
export i32 fib(i32 n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }
```

| command | 2026-09-01 binary | `bd041f640` |
|---|---:|---:|
| `wac --version` | 39 ms | 43 ms |
| `wac check fib.wac` | 30 ms | 405 ms |
| `wac compile fib.wac` | 63 ms | 1,001 ms |
| `wac build fib.wac --no-cache` | 112 ms | 1,036 ms |
| `wac check two.wac` (`export i32 two() { return 2; }`) | — | 381 ms |
| ...the same, plus `import { Result } from "core";` | — | 623 ms |

And at the large end, against the figure in `issues/lang/0153` from 2026-08-18:

| `wac build packages/box/src/bin/sh.wac --no-cache` | output | time | per KB of output |
|---|---:|---:|---:|
| 2026-08-18 (0153) | 910 KB | 5,994 ms | ~6.6 ms |
| `bd041f640` | 2,025 KB | 66,156–70,452 ms | ~33–35 ms |

Expected: within a small factor of the September figures.
Actual: 11–16× on a one-line file and about 11× on the shell — about 5× per byte of output even after
allowing for the output having doubled.

## Notes

**It is not startup.** `--version` and an unknown command are 40 ms on both binaries, so loading the
host is unchanged. The cost starts when the compiler runs.

**It is a factor, not an overhead.** A fixed cost would swamp the one-line file and vanish into the
shell's 66s. Instead both are about an order of magnitude slower, so the compiler's own work got
slower across the board. Possible causes, none checked: whole-graph work that now scales with the
embedded `core`/`std` text (a file importing nothing already costs 381 ms to *check*), the seed's code
section doubling to 2.27 MB, or a tiering change in the host. The seed has no coverage or trace custom
section — just `name`, `producers` and `wac.manifest`.

**Nobody has bisected it.** Old binaries cannot compile today's sources (the 2026-09-01 one fails on
`"std"` and on newer syntax), so the comparison above is limited to programs that both binaries accept.
Bisecting means one bootstrap per step, about 10 minutes at the slow end.

**What it costs.** Every agent's bootstrap, every `wac build`, and the gate. `issues/system/0275b`
breaks down where the gate's twelve minutes go and may already contain part of this.

**A neighbour in `bootstrap.sh`, same session.** The `gen:core --check` guard runs whatever binary is
already in `native/v8/target/release/`. A binary too old to compile today's `tools/wac/gencore.wac`
fails that check, and the script reports *"coretext.wac is out of step with core/ and std/"* on a tree
where it is not. The way out is to move the stale binary aside, which makes the script take the
fresh-clone path. The guard should tell "the check could not run" apart from "the check said no".

## Findings (agent-b, 2026-10-27)

Profiled with V8's `--prof` on the native host and `node --prof-process`. There are three causes, and
the two big-program ones are separate from the small-file one.

**1. Fixed: the `core`/`std` embedding was rebuilt quadratically on every call.** Since
`8c3d8b190` (2026-10-03), `gencore.wac`'s `asWac` emitted `for (...) { s = s + lines[i]; }`, so
`stdSource()` copied the text built so far once per line: about 3,400 lines and 350 MB for a 177 KB
text. Lowering, pruning and checking each call it, and it was **73%** of `wac compile fib.wac`. It now
measures the total and copies each line once into one buffer. A/B on the same machine, with the
old-seed arm measured both before and after the new one:

| command | old seed | new seed |
|---|---:|---:|
| `wac check two.wac` | 372 ms | 98 ms |
| `wac check` with `import { Result } from "core"` | 555 ms | 208 ms |
| `wac compile fib.wac` | 988 ms | 143 ms |

`tools/wac/gencore_test.wac`'s `test_the_embedding_is_built_in_linear_time` compares one call with a
single copy of the same bytes. It failed against the old seed (158,051 µs against 109 µs) and passes
on the new one.

**This did not touch the large end.** After it, `wac build packages/box/src/bin/sh.wac --no-cache` still
took 65.7 s and `./bootstrap.sh` 593 s. Profiling that build (59,370 ticks) found two more:

**2. Fixed: `namesTypeDeclC` → `exportsTypeNamed`, about 34%.** Until the static view is built, every
named type ran `indexOf("export type " + name)` over the full text of every source in the graph (179
files for `sh.wac`). This came in with `6d0bb8e79` (2026-10-14). The names are now collected once per
`ViewInputs` (`typeNames`) and looked up there. A name that cannot be a run of name bytes keeps the old
scan, so the answers are unchanged.

**3. Fixed: `registerNamed` → `Env.enumOf`, about 19%.** For every generic instance an expression
named, the field loop asked `enumOf`, a walk of every variant, about every field in the program. It now
collects the instance's own variants once (`variantsOwnedBy`, which keeps `enumOf`'s first-match rule)
and checks each field against that list.

`packages/wacc/test/wac/linearwalks_test.wac` holds one ratio test for each. Each fails with only its own
fix reverted (3,098 ms against 314; 3,492 ms against 104) and passes with both applied.

**After all three**, on a shared machine:

| | 2026-08/09 | before | after |
|---|---:|---:|---:|
| `wac check` one-line file | 30 ms | 372 ms | 98 ms |
| `wac compile fib.wac` | 63 ms | 988 ms | 143 ms |
| box's shell, `--no-cache` | 5,994 ms (910 KB) | 65,706 ms | 32,722 ms (2,025 KB) |
| `./bootstrap.sh` | 36 s | 593 s | 437 s |

The shell's output is byte for byte what it was, apart from the output file's name in its manifest.

**Second round (agent-b, 2026-10-27).** The flat profile had a cause after all: 25% of ticks were
the engine's runtime, a lock and an allocation per `array.new_data`, which is how every string literal
was built. Short literals are now `array.new_fixed` (`literalcost_test.wac`). After that the profile
was all linear lookups, and these went to indexes or single passes, each with a doubling test in
`linearwalks_test.wac` that fails without its fix:

- `Env.keyAt` and `Env.declareKeyed` walked every declaration; now `keyindex.wac`, by name.
- `typeDeclAt` walked every declaration for the few `type`s, then every import; both indexed.
- `mayDeclareTypeDefault` sliced and re-searched the text per `struct`, so `std` cost its square.
- `registerNamed` built and searched a string per field; now compares an array.

| | Aug/Sep | before | after round 1 | after round 2 |
|---|---:|---:|---:|---:|
| `wac check` one-line file | 30 ms | 372 ms | 98 ms | 100 ms |
| `wac compile fib.wac` | 63 ms | 988 ms | 143 ms | 135 ms |
| box's shell, `--no-cache` | 5,994 ms (910 KB) | 65,706 ms | 32,722 ms | 12,400 ms (2,025 KB) |
| `./bootstrap.sh` | 36 s | 593 s | 437 s | 257 s |

Per KB of output the shell is now about 6.1 ms against 6.6 ms in August, so the large end is back.
Its output is byte for byte what round 1 produced except where short literals changed the code.

**Third round (agent-b, 2026-10-27): the small end.** A check of a one-line program importing `std`
lexed `std` about twenty times, and lexing and parsing were two thirds of it. Profiled for inclusive
time (`--prof-process --preprocess` and a script summing each tick's stack; the self-time list put
`lex` at 13% when it was 43%):

- Each lowering pass lexed every file it looked at. They now read through one `Reads`
  (`frontend.wac`), so a text a pass leaves alone gives the next pass the same tokens and tree.
- `diagnoseFilesWithIn` lexed and parsed every file again per closure only to collect its lex and
  parse errors; `edgesOfIn` did it once more for the import lists. Both use the first parse.
- `exportedTypeNames` searched every byte of every file once per closure; now tokens.
- `lex` zeroed a token array of one token per byte (3.5 MB for `std`, of which it used 260 KB) and
  sized two stacks by two extra passes over the input.
- `synthTokens` asked `synthOffset` per word, which rebuilt the word list: the square of the states.

`lexcost_test.wac` and one new test in `linearwalks_test.wac` fail on the old source.

| | Aug/Sep | before | round 2 | round 3 |
|---|---:|---:|---:|---:|
| `wac check`, one line importing `std` | — | — | 284 ms | 205 ms |
| `wac check` one-line file | 30 ms | 372 ms | 100 ms | 94 ms |
| box's shell, `--no-cache` | 5,994 ms | 65,706 ms | 11,878 ms | 9,215 ms |
| `./bootstrap.sh` | 36 s | 593 s | 257 s | 189 s |

The shell builds to the same bytes as round 2.

**Fourth round (agent-b, 2026-10-27): a file that imports nothing.** Two thirds of checking one was
`lowerUnqualifiedVariants` parsing `std` and `core` whole to list their enums' variants, and
`callsCoreVariadic` searching `core`, on every compile. Both lists are fixed when the compiler is built,
so `gen:core` now writes them into `coretext.wac` (`builtinEnumVariants`, `builtinVariadicCallees`),
read by the same functions the lowering uses on a program's own files (`scans.wac`). That uncovered a
square that the parse had hidden: `withQualifiedVariants` kept the file's type names in a `|`-joined
string, built and searched once per type, and 24,000 structs took 606 ms to lower; now 58.

| | round 3 | round 4 |
|---|---:|---:|
| `wac check` one-line file, no imports | 96 ms | 66 ms |
| `wac compile fib.wac` | 140 ms | 103 ms |
| `wac check`, one line importing `std` | 215 ms | 218 ms |
| box's shell, `--no-cache` | 9,215 ms | 9,347 ms |

Same shell bytes. About 35 ms of a bare check is starting the binary, so the compiler's own share is
now about 30 ms.

**Fifth round (agent-b, 2026-10-27): a program that imports `std`.** `check` gave every file of the
graph a turn as the entry, `std` and `core` included, so a one-line program paid for checking all of
`std`'s bodies and lowering its `async` ones, which was more than checking `std` on its own. The
built-ins are now read for what a file imports from them and not checked as entries; what they would
say is fixed when the compiler is built, and `lexcost_test.wac` checks that it is empty. Separately,
`importSpecs` parsed a file to find its imports, and `wac` reads every file for them before compiling;
it now only lexes.

| | round 4 | round 5 |
|---|---:|---:|
| `wac check`, one line importing `std` | 211 ms | 141 ms |
| `wac check` in `packages/box` (179 files) | 6,658 ms | 5,061 ms |

Same shell bytes. V8 flags did not help: lazy compilation is already the default, a larger young
generation saved 5% on a small check and nothing on the shell, and earlier tier-up cost more.

**Sixth round (agent-b, 2026-10-27): `wac check` on a project.** With no arguments it discovers every
file and gathers each one's closure in turn, and the closures overlap: checking `packages/box` read
8,630 files to find 423, `bytes/src/slice.wac` 117 times, each read on a fresh host thread and each
file lexed again for its imports. One `ReadCache` (`packages/wac/src/sources.wac`) now serves every
root of the command, keeping each file's bytes, text and import list. `checkproject_test.wac` fails
without it (a megabyte imported by 40 files added 234 ms against 100 for 10).

| | round 5 | round 6 |
|---|---:|---:|
| `wac check` in `packages/box` (423 files) | 5,008 ms | 3,047 ms |

Caching the import lists put a `Map<string, string>` and a `Map<string, string[]>` in one program, and
the module was refused for a duplicate export: `bindNameOf` dropped `[]` as punctuation, so both entry
types were `MapEntry$string$string`. It now spells `[]` as `Arr`, as `bindArrSuffix` does — the sibling
of case 0562's `?`. `bindnames_test.wac`. The shell changes only in those export names.

**Seventh round (agent-b, 2026-10-27): per-closure setup in the checker.** Most of what checking
`packages/box` spent in `checkFilesAutoIn` was before `checkModule`. For each type a signature reached,
`typeDeclaredElsewhere` walked every other file's declarations, copying each file's text with `std`'s
and `core`'s among them; it is now an index built once per closure. And each closure rebuilt `core`'s
text from its 1,500 embedded lines; `diagnoseGraphIn` builds it once and carries it one past the
closure's files, as it already carried `core`'s count, tokens and tree. A test for each fails without it.

| | round 6 | round 7 |
|---|---:|---:|
| `wac check` in `packages/box` (423 files) | 3,137 ms | 2,536 ms |

Same shell bytes. Found on the way and fixed with it: the checker's import tables held 4,096 names but
their positions only 512, so the 513th imported name trapped the compiler; and the duplicate-name check
stopped recording at 512 declarations, so a duplicate past that went unreported (`manyimports_test.wac`).

**Eighth round (agent-b, 2026-10-27).** `keyDecls` decided whether each declaration of a static view
shares its name by comparing it with every other, once per view: now a name index. `wac check` in
`packages/box` 2,574 → 2,415 ms, same shell bytes. Not changed: caching each import's boundary check
across a project's gathers measured nothing (a second gather over 60 cached imports took 1.9 ms either
way), so it was reverted. Writing that test found `issues/lang/0399b`.

**Ninth round (agent-b, 2026-10-27): the emitter's struct, field and function tables.** `fieldType`,
`isStructName`, `parentOf`, `funcAt` and the per-owner field walks searched their tables from the top
for every name; on 1,600 structs of ten fields that was half of emitting. They are `const`, and `const`
is deep, so an index cannot be built when asked: `structIx`, `fieldIx` (keyed by owner, so a struct's
fields stay in order) and `funcIx` are kept as each row is added (`structAdded`, `fieldAdded`, `addFunc`),
and `structIx` is rebuilt after the parent-first reordering moves rows. `linearwalks_test.wac`'s
`test_emitting_a_field_does_not_walk_every_field` fails without it: 1,000 against 2,000 structs took
7,218 against 27,626 ms, now about 3× faster with a ratio near 2.

| | round 8 | round 9 |
|---|---:|---:|
| `wac build` of box's shell | 9.0–9.9 s | 7.0 s |
| `./bootstrap.sh --no-install` | ~188 s | 156 s |
| `wac check` in `packages/box` | 2,403 ms | 2,411 ms |

Same shell bytes.

**Tenth round (agent-b, 2026-10-27): a generic method's owner.** `methodInstanceInferred` found the
declaration of a method call's owner by reading the name of every declaration in the tree, once per call
to a generic method: 14.6% of the shell build, and 86% of emitting 2,000 structs that each call one.
`treeDeclFirst` indexes the tree (`mergedDecls`, or the one program's) by name on first use, and the
index is dropped wherever either is assigned. `test_inferring_a_method_instance_does_not_walk_every_declaration`
fails without it: 1,500 against 3,000 structs took 2,178 against 7,258 ms. The five other walks of the
tree by template name (`ownerTemplateOf` callers) could use the same index, but have no test yet.

| | round 9 | round 10 |
|---|---:|---:|
| `wac build` of box's shell | 6.95–7.22 s | 6.11–6.37 s |
| `./bootstrap.sh --no-install` | 156 s | 126 s |

Same shell bytes.

**Eleventh round (agent-b, 2026-10-27): signatures and generic calls.** `Env.sigType` looked for each
signature in every one registered (12% of the shell build, mostly through `pairType` for each `fn<…>`
default), and every call asked `genericCallInstance` and `genericFuncFor` whether a generic function of
its name exists by reading the name of every declaration. `sigType` now keeps `sigIx` as it appends;
the other two use round 10's `treeDeclFirst`. `test_a_signature_is_not_looked_for_in_every_signature`
fails without them: 1,000 against 2,000 structs each with a `fn<…>` field took 940 against 3,030 ms.
It asserts that both programs are emitted, because past about 2,048 structs a table runs out and the
module is declined quickly, which the ratio would read as fast. `genericFuncInstance` (written type
arguments) and `genericFuncKey` still walk every declaration and have no test.

| | round 10 | round 11 |
|---|---:|---:|
| `wac build` of box's shell | 6.13–6.27 s | 4.78–4.91 s |
| `./bootstrap.sh --no-install` | 126 s | 88 s |

Same shell bytes.

**Twelfth round (agent-b, 2026-10-27): enum variants.** Three walks, each times the program's variants:
`Env.enumOf` (12% of the shell build, through `canonType` on every type name) and the other
variant-table lookups by name or owner, now `variantIx` and `variantOwnerIx`, kept by `variantAdded`;
`withQualifiedVariants`, which searched a `|V=Q|` string grown by concatenation once per identifier
(now `Qualifiers`, rows with an index); and `typeNamedAnywhere`, once per variant over every
declaration (now the tree index). `test_canonicalising_a_type_does_not_walk_every_variant` fails without
them: 320 against 640 enums took 437 against 1,685 ms, now 93 against 235. It asserts that both are
emitted: past about 2,048 variants the module is declined.

| | round 11 | round 12 |
|---|---:|---:|
| `wac build` of box's shell | 4.74–4.86 s | 4.05–4.19 s |
| `./bootstrap.sh --no-install` | 88 s | 74 s |
| `wac check` in `packages/box` | 2,460–2,568 ms | 2,454–2,537 ms |

Same shell bytes. `variantsOfEnum` still searches the table text once per enum; it did not show.

**Profiling note.** Wasm inlining folds a callee's walk into its caller's self time: `genericCallInstance`
showed 99% self until `WAC_V8_FLAGS="--prof --no-wasm-inlining"` named `genericFuncFor`.

A lead that did not reproduce in isolation and so was not changed: `Env.sigType` walks every
signature for each one asked (12% of the shell build after round 10, via `pairEverySignature`). A V8 code cache for
the seed would need the `v8` crate to expose `CompiledWasmModule` serialization, which 152.1 does not.

**Profiling recipe.** Add `if let Ok(f) = std::env::var("WAC_V8_FLAGS") {
v8::V8::set_flags_from_string(&f); }` before `new_default_platform` in `native/v8/src/main.rs`'s
`start_v8`. Then run `WAC_V8_FLAGS=--prof wac …` in an empty directory and process the large
`isolate-*.log` with `node --prof-process`. `build` does its work in a second isolate, so a single
`--logfile` comes out empty. This change was not committed.
