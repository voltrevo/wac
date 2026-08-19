## wac — the command

`wac` is the one a person types: a single executable with V8 inside it, the compiler carried as a
prebuilt module, and no JavaScript host in the path. It is built from `native/v8/`;
`native/README.md` and `native/v8/README.md` describe how, `deno task wac:install` is the supported
way to have it, and this section is what it promises.

**There is one command.** This page used to describe two more — `wacx`, the reference toolchain run
through Deno, and `waccx`, the same commands over the wac-written compiler. Both were development
scaffolding: a way to drive a compiler before there was a binary to put it in, and a way to compare
the two. Neither is something to tell a reader to type, and describing three toolchains made the
first question about this page which one you were reading.

There is a second host with no JavaScript at all — `wacland`, `native/src/main.rs`, on wasmtime. It
runs a built program and does not compile, so the commands below are this binary's.

### What the first argument is

The command is decided by what the first argument *is* rather than by a flag, because
`wac compile x.wac` and `wac prog.wasm` are both what somebody would type.

| first argument | what happens |
|---|---|
| `prog.wasm`, or a stem with `prog.json` beside it | run that program: the module carries its own manifest, or the pair does |
| `run`, `test`, `sh`, `validate`, `covdump` | this host's own commands — compiling, running, the shell, and the two that ask about a built module |
| `uninstall` | remove what an install put under `$WAC_HOME`, and the line it added to each shell profile |
| `update` | resolve and fetch what `wac.lock` does not cover, and write the lock |
| anything else | handed to the compiler inside: `check`, `compile`, `build`, `bindgen` |

A name ending in `.wasm` is a bundle *claim* whether or not the file exists, and is reported as a file
that cannot be read — otherwise a mistyped path reaches the compiler and comes back as *unknown
command 'prog.wasm'*, which is a message about the wrong thing.

```sh
wac check   main.wac                 # diagnostics, and nothing written
wac compile main.wac [out.wasm]      # a module
wac build   main.wac -o stem         # a module carrying a manifest, and stem.json beside it
wac bindgen main.wac [--js]          # the glue a host calls it through
wac run     main.wac [args…]         # compile into a temporary file and run it
wac test    [path…] [--ignore p,…]   # every `test*` export under each path
wac sh      [-c script]              # the shell, sealed unless granted
wac validate mod.wasm […]            # whether the engine accepts each module, without running it
wac covdump mod.wasm                 # run `main` under the counters and print each one
wac uninstall [--keep-cache]         # remove an installed `wac`, and nothing else
wac update  [project]                # fetch what the lock does not cover, and lock it
```

`validate` answers the one question `WebAssembly.validate` answers on a JavaScript host and nothing in
wac could ask: are these bytes a module this engine will take? It exists because the alternative was
to *run* each one, which is a process per module — `packages/wacc/test/wac/corpusemit_test.wac` asks
about 543 of them, so the list is the point: one isolate, every module compiled inside it.

`[§wac-cli-validate-2hq7nx4]` **Only the rejections are named, then a count.** That is the shape of
every batched oracle in this repository and it is there for the same reason: a run that stopped
halfway names no rejections, which is indistinguishable from one where nothing was wrong. The last
line is `<n> module(s): <m> rejected`, and a caller checks `n` against what it asked for. A file that
cannot be read is a rejection rather than an error, so one missing path does not hide the verdict on
the others. Exit is 0 when every module is accepted, 1 when any is not, and 2 for no arguments.

`[§wac-cli-covdump-9pf3wq2]` `covdump` runs a module built with coverage and prints `<index>\t<count>`
per counter, in index order, then `<n> counter(s)`. The index is the pairing `covTableFiles` is keyed
by: its `i`th row describes counter `i`, so a caller holding both can say *which* point ran and how
often. `--coverage` on `test` answers a different question — how many points were reached, as a
percentage per file — and cannot say how often any one of them ran. Nothing in wac can ask directly:
`__cov_get` is injected by the instrumentation, so no source names it.

The module is instantiated with no imports and `main` is called if it is exported. A module with no
`__cov_init` is an error rather than an empty report, because a module built without coverage and one
whose counters all read zero are different facts.

### check, compile, bindgen

These three are handed to the compiler inside the binary. Each takes the entry file, walks its
import graph, and differs only in what it writes.

`[§wac-cli-check-4mkq8wp]` `check` writes nothing and reports. A file with no diagnostics still
prints a line — `math.wac: 1 file(s), no diagnostics` — because how many files were read is the
part you cannot otherwise see, and silence does not distinguish *checked and clean* from *did not
look*. A broken file exits 1 and names the file and the line. **The file named is the one the error
is in**, which for an error in an imported module is not the entry: that is the whole evidence the
import graph was walked rather than the entry parsed alone.

`[§wac-cli-compile-9wkn3pq]` `compile` writes a module — `main.wasm` beside the source unless an
output path is given — and prints what it wrote and how big it was. It is a plain module with no
manifest; `build` is the one that writes a program that can carry its own grants.

`[§wac-cli-bindgen-5tqm7wn]` `bindgen` writes the glue a host calls the module through, as
`main.gen.ts`, with `--js` for the JavaScript flavour. The exported functions appear as typed
wrappers, so a host calls `gcd(48, 18)` rather than marshalling by hand.

`[§wac-cli-usage-3nkq8wj]` **Warnings print and do not change the exit code.** A warning nobody sees
is not a warning, so they are not held back for `check` or suppressed on a command that also writes
a file — and a file whose only diagnostics are warnings exits 0, because a warning that failed a
build would be an error under a softer name.

`[§wac-cli-usage-3nkq8wj]` An unknown command is named, with the ones that exist — `unknown command
'chekc' — check, compile, build or bindgen` — and is a usage error, exit 2. **The command is checked
before the entry is read**, which is the difference between that message and *cannot read chekc.wac*
on a line where both were mistyped: reading first diagnoses the typo you did not make.

### run: a program, or one exported function

`[§wac-cli-run-7jnq2mv]` `wac run main.wac [args…]` compiles the entry into a temporary file and
runs it. **A module that exports `main` is a program** and everything after the entry is its
`argv`. A module that does *not* is a library, and the first argument names the export to call:

```sh
wac run math.wac gcd 48 18
# 6
```

`main` winning where it exists is what makes this unambiguous — a module with both is a program,
and `wac run prog.wac gcd` passes `gcd` to it rather than calling it.

**Arguments are coerced by the declared parameter type**, not guessed from the text. The shell has
no types, so the signature is the only thing that can supply them: `1` is an `i32` where one is
declared and the string `"1"` where a `string` is, and a `string` parameter takes the argument
exactly as written. An `i64` keeps its width — it crosses as a BigInt, so `9007199254740993` is
that number and not the nearest double. A list is comma-separated, brackets are accepted because
people type them, and an empty list is empty rather than one empty element.

`i32`, `i64`, `f64`, `bool`, `string` and arrays of `u8`, `i32`, `i64` and `f64` can be written on
a command line. Anything else is refused **by name** — a struct is not something a shell can hand
over, and saying which type it was beats a message about the call.

What comes back is printed by its declared return type: a `string` as itself, an array as its
space-separated elements, a `bool` as `true` or `false` — the same vocabulary it accepts — and a
`void` function prints nothing at all.

A wrong name lists what the module *does* export, with signatures, because that is the next thing
anybody asks. A wrong argument count shows the signature. A bad element in a list names **the
element**, since a message about `1,x,3` sends you looking at the wrong thing. All of those are
usage mistakes and exit 2; so does a trap, which repeats what `trap "…"` said. A file that does not
compile is exit 1, because it never ran.

### test: which files, and which not

`[§wac-cli-ignore-6vp2knq]` `--ignore <path,…>` drops paths from what a directory walk found, the
way `deno test --ignore` does: a prefix match, so naming a directory excludes what is under it. It
is discovery's flag and does not reach the compiler — `--filter` is per-file and does.

**What it excludes is counted and printed**, as `220 files: 220 ok, 8 not run (--ignore)`. A lane
that quietly runs fewer files than the reader believes is the failure this flag can cause, and the
summary is where that gets noticed; excluding *every* file is its own message rather than "no tests
under packages/", which would send you looking for a naming mistake that is not there.

The suite uses it for the heavy lane. A test file declares `// test-lane: heavy — <cost>` when it is
too expensive for a run that discovers everything, and `tools/runTests.ts` builds this flag from
those declarations so a push does not pay for them; `deno task test:heavy` runs them. **Naming a
path still runs it** — the exclusion is for the run that discovers, not a way to turn a file off.

### Grants, and which side of the entry they go

A grant is a promise made when the program is *packaged*: `--allow-read` and its four siblings are
baked into the artefact the compiler writes, so a program cannot be handed a capability it was not
built with, and the person running it cannot quietly widen what it may do.

`[§wac-cli-grants-3qm7wv2]` `build` and `test` take grants on either side of the entry — `build` reads
the entry as the first argument that is not a flag. `run` takes them **before** the entry, because
everything after it belongs to the program, and a grant written among the program's arguments is an
error rather than an argument:

```sh
wac run --allow-read main.wac DIR    # the grant, and DIR is the program's
wac run main.wac --allow-read DIR    # refused: the flag is in the wrong place
wac run main.wac -- --allow-read     # the program's first argument, and no grant
```

`[§wac-cli-grants-3qm7wv2]` Forwarding it was worse than refusing: the program ran without the
capability it asked for, with a flag as `argv[0]`, and whatever it said next was about the bogus
argument — nothing pointed at the command line. `--` is the escape for a program that genuinely wants
the string, and is consumed rather than passed on.

`--allow-run` is its own grant, not `write`'s: it is permission to start a *host* program, and a build
that may run a confined wasm module must be able to refuse one without refusing both.

### Exit codes

`run`'s status is the program's own answer — `export i32 main()` returning 3 exits 3 — so these are
what the toolchain says before the program starts, and what `test` says about a run.

| code | meaning |
|---:|---|
| 0 | success |
| 1 | did not compile, or a file that could not be read |
| 2 | a usage error — an unknown flag, a missing entry, a grant in the wrong place |
| 3 | it ran and something was wrong: a test failed |

`[§wac-cli-status-8kz4rp6]` 3 rather than 1 for a failing test, for the same reason a trap is
distinguished from a compile failure: a script needs to tell "did not compile" from "ran and did
something wrong", and one code for both makes a red suite indistinguishable from a typo.

`test` has two more it uses per file and folds into the summary rather than the exit status: a file
where nothing could run because every test wants a capability this run was not granted, or an oracle
the host cannot supply, and a file where `--filter` matched nothing. Neither is a failure, and neither
is silence — the summary names the files and says which.

### Fetching a dependency

`[§wac-cli-update-2rq7knp]` `wac update [project]` resolves every mapping the lockfile does not
already cover, fetches it, checks the commit's tree out into `$WAC_HOME/cache/git/`, and writes
`wac.lock`. Run twice, the second says `nothing to fetch` — a mapping that is locked stays locked
even if its branch has moved, which is `design/lang/0009` D10 and the reason a build is reproducible.

**It is the only command that reaches the network.** Not a policy the other commands follow: there is
no code path from `wac build` to a socket, because the fetcher is a separate payload. A mapped import
whose commit is not in the cache is a compile error naming this command, rather than a compile that
quietly goes online.

Moving a pin deliberately is what `update` is for; `wac.lock` is what makes everything else offline.

### Taking it away

`[§wac-cli-uninstall-7kq3mvp]` `wac uninstall` removes the binary, the cache, the `env` file, the
metadata and the marked line in each shell profile — and **nothing else**. Not a manifest, not a
lockfile, not a source file, not a build product: those live in projects rather than under
`$WAC_HOME`, and a package manager that tidies your working directory is one nobody trusts twice.
`$WAC_HOME` itself goes only if it is empty afterwards, and whatever is left in it is named in the
output rather than passed over, so *removed* and *found nothing* are never the same line.
`--keep-cache` keeps `cache/git/`, which is the one part that is expensive to refill.

Running it twice is ordinary — it is what somebody does when they are not sure the first one
worked — so the second prints `nothing to remove` and exits 0. That is not a failure.

It is on the binary as well as being `deno task wac:uninstall`, and the reason is the whole point of
installing anything: the task is a Deno program under `tools/`, so it needs this repository, and
somebody who installed the command has a `$WAC_HOME` and no checkout. Asking them to clone the
compiler in order to remove the compiler is not an answer. The two are held to one list by
`packages/wacc/test/wac/uninstall_test.wac`, which builds the same fake install twice and takes one
away with each — duplicated knowledge with a test between the copies being a different thing from
duplicated knowledge without one.

### A program that asks for nothing

`[§wac-cli-nocaps-5hq2xn9]` `export i32 main() { return 3; }` is a whole program: no capabilities
declared, none granted, and `wac run` runs it. This is the language's central claim, so the tools have
to be able to express its smallest case — all three hosts read `main`'s parameter list rather than
building a world and hoping the program wants it.
