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
| `run`, `test`, `sh` | this host's own commands — compiling, running and the shell |
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
wac test    [path…]                  # every `test*` export under each path
wac sh      [-c script]              # the shell, sealed unless granted
```

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

### A program that asks for nothing

`[§wac-cli-nocaps-5hq2xn9]` `export i32 main() { return 3; }` is a whole program: no capabilities
declared, none granted, and `wac run` runs it. This is the language's central claim, so the tools have
to be able to express its smallest case — all three hosts read `main`'s parameter list rather than
building a world and hoping the program wants it.
