## wac — the binary

`wacx` above is the reference toolchain, run through Deno. `wac` is the one a person types: a single
executable with V8 inside it, the compiler carried as a prebuilt module, and no JavaScript host in the
path. It is built from `native/v8/`; `native/README.md` and `native/v8/README.md` describe how, and
this section is what it promises.

There is a second host with no JavaScript at all — `wacland`, `native/src/main.rs`, on wasmtime. It
runs a built program and does not compile, so the commands below are this binary's.

### What the first argument is

The command is decided by what the first argument *is* rather than by a flag, because
`wac compile x.wac` and `wac prog.wasm` are both what somebody would type.

| first argument | what happens |
|---|---|
| `prog.wasm`, or a stem with `prog.json` beside it | run that program: the module carries its own manifest, or the pair does |
| `run`, `test`, `sh`, `validate` | this host's own commands — compiling, running, the shell, and asking the engine about a module |
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
wac validate mod.wasm […]            # whether the engine accepts each module, without running it
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

`[§wac-cli-status-8kz4rp6]` 3 rather than 1 for a failing test, for the reason `wacx` distinguishes a
trap from a compile failure: a script needs to tell "did not compile" from "ran and did something
wrong", and one code for both makes a red suite indistinguishable from a typo.

`test` has two more it uses per file and folds into the summary rather than the exit status: a file
where nothing could run because every test wants a capability this run was not granted, or an oracle
the host cannot supply, and a file where `--filter` matched nothing. Neither is a failure, and neither
is silence — the summary names the files and says which.

### A program that asks for nothing

`[§wac-cli-nocaps-5hq2xn9]` `export i32 main() { return 3; }` is a whole program: no capabilities
declared, none granted, and `wac run` runs it. This is the language's central claim, so the tools have
to be able to express its smallest case — all three hosts read `main`'s parameter list rather than
building a world and hoping the program wants it.
