# 45 — The `wac` command

`wac` is one executable: it compiles, runs, tests, binds and audits programs, and fetches dependencies. Every command
below is a subcommand of it. Examples here are shell sessions; `$` starts a command and the lines after it are its
output.

## Commands

| Command | What it does |
|---|---|
| `wac check [files…]` | diagnostics, and nothing written ([06](../1-programs/06-checking-a-project.md)) |
| `wac compile main.wac [out.wasm]` | a module |
| `wac build main.wac -o stem` | a module carrying its own manifest and grants |
| `wac run main.wac [args…]` | compile and run, with no file left behind |
| `wac test [paths…]` | run every test ([47](47-testing.md)) |
| `wac bindgen main.wac [--js]` | the glue a host calls a module through ([48](48-bindgen.md)) |
| `wac audit main.wac [--verbose]` | what each dependency can reach ([49](49-audit.md)) |
| `wac update [project]` | fetch what the lock does not cover, and write the lock ([46](46-manifest-and-lock.md)) |
| `wac app main.wac -o thing` | an executable file that runs itself |
| `wac prog.wasm [args…]` | run a built module, with the grants its manifest declares |
| `wac validate mod.wasm…` | whether the engine accepts each module, without running it |
| `wac covdump`, `ctcompare`, `tracestat` | coverage and trace instruments over a built module |
| `wac sh [-c script]` | the shell, sealed unless granted |
| `wac self uninstall [--keep-cache]` | remove an installed `wac`, and nothing else |

The first argument decides the command. A name ending in `.wasm` is a module to run, whether or not the file exists —
so a mistyped path is reported as a file that cannot be read, not as an unknown command.

## Every command says what it read

```sh
$ wac check math.wac
math.wac: 1 file(s), no diagnostics
```

`[§wac-cli-check-4mkq8wp]` `check` writes nothing and always prints a line, including when there is nothing to report,
because how many files were read is the part that cannot otherwise be seen. A diagnostic names the file it is in — for an
error in an imported module, not the entry.

```sh
$ wac compile math.wac
math.wasm: 1782 bytes
```

`[§wac-cli-compile-9wkn3pq]` `compile` writes a module — beside the source unless an output path is given — and prints
what it wrote and how big it was. It is a plain module with no manifest.

`[§wac-cli-usage-3nkq8wj]` Warnings print and do not change the exit status. An unknown command is named, with the ones
that exist, and is a usage error — checked before the entry is read, so a typo is diagnosed as a typo.

## `build` remembers what it built

```sh
$ wac build main.wac -o app
app.wasm: 1782 bytes from 1 file(s)
$ wac build main.wac -o app
app.wasm: 1782 bytes from cache, 1 file(s) unchanged
```

`[§wac-cli-build-cache-7pk3mq9]` `build` caches its output, keyed on everything that reaches the artefact: the compiler,
every source read, the grants and the output's name. A hit writes the same bytes and says it was a hit. A build that
warned, or one built for coverage or tracing, is never cached.

`[§wac-cli-build-nocache-2wq9nk4]` `--no-cache` neither reads nor writes the cache.

## `run`: a program, or one exported function

```sh
$ wac run main.wac first second        # main is exported: a program, and these are its arguments
$ wac run math.wac gcd 48 18           # no main: the first argument names an export
6
```

`[§wac-cli-run-7jnq2mv]` `wac run` compiles the entry and runs it. A module exporting `main` is a program, and every
argument after the entry is its own. A module without `main` is a library: the first argument names the export to call,
and the rest are its arguments.

Arguments are read by the declared parameter types — `1` is an `i32` where one is declared and the string `"1"` where a
`string` is. `i32`, `i64`, `f64`, `bool`, `string`, and arrays of `u8`, `i32`, `i64` and `f64` can be written on a command
line, a list comma-separated; anything else is refused by name. The result prints by its declared type. A wrong export
name lists what the module does export, with signatures.

## Grants

A program's grants are fixed when it is built. The person running it cannot widen them:

```sh
$ wac run --allow-read main.wac DIR    # the grant; DIR is the program's argument
$ wac run main.wac --allow-read DIR    # refused: a grant among the program's arguments
$ wac run main.wac -- --allow-read     # the program's first argument, and no grant
```

`[§wac-cli-grants-3qm7wv2]` `build` and `test` take grants on either side of the entry; `run` takes them only before it,
since everything after the entry belongs to the program. A grant written among the program's arguments is a usage error,
and `--` passes what follows to the program unread.

The grants are `--allow-read`, `--allow-write`, `--allow-net`, `--allow-env` and `--allow-run`. `--allow-run` — starting a
host program — is its own grant, so a build may run a confined module without being able to run a host one.

## Exit statuses

`run`'s status is the program's ([07](../1-programs/07-programs.md)). Otherwise:

| status | meaning |
|---:|---|
| 0 | success |
| 1 | did not compile, or a file that could not be read |
| 2 | a usage error — an unknown flag, a missing entry, a grant in the wrong place |
| 3 | it ran and something was wrong: a test failed |

`[§wac-cli-status-8kz4rp6]` A failing test exits 3 rather than 1, so a script can tell "did not compile" from "ran and did
something wrong".

## Handing somebody a program

`[§wac-cli-app-4mt8qzv]` `wac app main.wac -o thing` writes one executable file: a short shell preamble with the module
after it. Running it runs the module through the `wac` on the machine, which it requires — and says so if it is absent.

`[§wac-cli-app-grants-8xr2knw]` The grants are inside the module, not in the preamble: the shell lines are identical
between a sealed build and a granted one, so editing them cannot widen what the program may do.

`[§wac-cli-app-skew-3vq9mkt]` A module built for a different version of `wac` than the one running it is refused, naming
both versions.

## Instruments over a built module

`[§wac-cli-validate-2hq7nx4]` `wac validate mod.wasm…` reports, for each module, whether the engine accepts it, without
running it. It names only the rejections, then `<n> module(s): <m> rejected`, so a run that stopped halfway cannot pass
for a clean one.

`[§wac-cli-covdump-9pf3wq2]` `wac covdump mod.wasm [export…]` runs a module built with `--coverage` and prints
`<index>\t<count>` for every counter, then `<n> counter(s)`. A module built without coverage is an error, not an empty
report.

`[§wac-cli-covdump-world-6knq4vt]` It runs the module with the grants its manifest declares, as `wac prog.wasm` would.

`[§wac-cli-covdump-sweep-4tn8mr6]` Named exports are called after `main`, each with its trap caught. `name:<n>` calls
`name(0)` through `name(n-1)`, each trap caught.

`[§wac-cli-ctcompare-6knq4wp]` `wac ctcompare a.wasm b.wasm` compares the journals of two runs built with `--trace` and
answers with one line: `same <n>` over `n` events, `differs <i> …` at the first divergence, or `truncated <a> <b>` when
nothing diverged but a journal was too small to be sure. `same` carries its count because agreement over nothing is not
agreement.

`tracestat mod.wasm` prints one traced run's events, what it wanted, and the room it had.

## Taking it away

`[§wac-cli-uninstall-7kq3mvp]` `wac self uninstall` removes the binary, its cache, its environment file and the line it
added to each shell profile — and nothing else: no manifest, lockfile, source file or build product. `--keep-cache` keeps
the dependency checkouts. Run twice, the second says `nothing to remove` and succeeds.
