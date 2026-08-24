# Using wac in a project of your own

Everything below was run, in order, in an empty directory outside this repository. Where something
does not work yet it says so and names the issue, rather than being left out.

## Getting the command

There is one way today, and it needs a checkout of this repository, Deno, and **Cargo**:

```sh
git clone <this repo> wac && cd wac
bash tools/seed.sh --bootstrap    # once, from a fresh clone: builds the compiler the binary carries
deno task --no-lock wac:install   # builds `wac` and puts it on PATH
```

**Why `bash` and `--no-lock` rather than `deno task seed:bootstrap`.** Both forms work; these two do
not touch the network. `deno task` restores this repository's `deno.lock` before running anything, and
that lockfile carries every npm package the whole tree uses — **twelve of them**, including Playwright,
ethers, two versions of Binaryen and `ws` — so a fresh clone downloaded all of it before compiling a
line. Neither of these two steps needs a single one: `tools/install.ts` has no npm in its import graph
at all. On a slow or unreliable connection the download was what stopped the bootstrap. GitHub issue
21; `deno task seed:bootstrap` and `deno task wac:install` are still there and still correct if you
have the packages already.

Cargo because the seed is a wasm module the `wac` binary *carries*, so building it means building the
binary, and `native/v8` is Rust. This said "a checkout of this repository and Deno" until 2026-08-20,
and the omission was not harmless: without cargo the bootstrap stopped after about six seconds with
its stderr discarded, so what you got was a command that quit for no stated reason. It now says which
program is missing before it does any work — GitHub issue 21, from somebody following this page from a
fresh checkout.

`wac:install` writes four things under `$WAC_HOME` (default `$HOME/.wac`) — `bin/wac`, `cache/git/`,
`env`, `install.json5` — and adds one marked line to whichever of `.bashrc`, `.zshrc`
and `.profile` already exist. Running it again is how you upgrade. `wac uninstall` removes exactly those and never
a manifest, a lockfile, a source file or a build product.

**There is no release, no package manager entry and no prebuilt binary.** If that matters to you,
this is the wrong week.

### Without Cargo: compiling through Deno

If you have Deno and not Rust, you can compile without installing `wac` at all. The repository's
Deno-hosted compiler takes an entry and an output stem, from any directory:

```sh
deno run --allow-read --allow-write --allow-env --allow-run \
  --import-map <wac>/deno.json <wac>/packages/platform/native.ts \
  main.wac --allow-read -o out
```

That writes `out.wasm`, the same artefact `wac build` writes, and honours `@/` and a `wac.json5` the
same way. It is slower — it is the reference front end plus wacc running as wasm under Deno rather than
a binary — and it is a developer fallback rather than the supported route, which is
`deno task wac:install`.

**And a Deno- or Node-hosted `wac` command is a thing you can build**, which is not the same as the
line above: that one compiles, and this one is the command.

```sh
deno run -A <wac>/packages/platform/build.ts <wac>/packages/wacc/example/wacc.wac \
  -o wac --target deno --allow-read --allow-write --allow-run --allow-env --allow-net
./wac run main.wac                       # compile and run, no file in between
```

`--target node` gives the same thing for Node, run as `node wac`. It answers `check`, `compile`,
`build`, `bindgen`, `run`, `test <one_test.wac>`, and `wac <prog.wasm>` — running a built module, with
the grants that module's own manifest declares. `test <directory>` (which walks for `*_test.wac` and
builds one aggregate module), `--coverage`, `sh` and `update` are still the native binary's alone, and
`issues/system/0230a` tracks giving them to all three. Every command they share is held to the same
output on all three — `packages/wacc/test/wac/commandparity_test.wac`.

**It did not work from outside this repository until 2026-08-20**, which is worth saying because
somebody hit it: the compiler's own sources were named by relative path, so it read
`packages/wacc/src/api.wac` from *your* directory and died with a `NotFound` and ten frames of
TypeScript. That is fixed, a failure now prints the message without the stack (`WAC_STACK=1` if you
want it), and GitHub issue 21 is where it was reported.

**And a `@/` import did not work here until 2026-08-21**, which is worth saying more plainly still,
because this paragraph claimed it did. The walk that reads your files searches upward for the nearest
`wac.json5` — it has to, to follow the import at all — and then handed the compiler the files and not
what it had found. Both compilers refused, in different words:

    wacc         wacc cannot compile main.wac yet — an import of a file that was not supplied
    reference    `@/src/lib.wac` needs a project: no `wac.json5` above main.wac

from any entry position, and `deno task bindgen` refused the same import for the same reason. GitHub
issue 22 reported it; `issues/system/0229a` has the measurement and the fix, and
`packages/platform/test/project.test.ts` is what now holds this sentence to being true.

### What the Deno path is, and is not

It compiles. It is not the `wac` command. The seven things `wac` does are, through Deno, seven
different entry points with different flags and exit codes — `native.ts` builds, `tools/check.ts`
checks, `harness/referenceRun.ts` runs, `deno task bindgen` generates bindings, and `wac update` has no
Deno equivalent at all. Note that **`deno task check` is this repository's own TypeScript check**, not
`wac check`.

So if you want the development loop rather than an artefact, install the binary. `issues/system/0230a`
is the open question of whether Deno should host the whole command, with options and a recommendation;
GitHub issue 22 is the case for it, and it makes the case better than that issue does.

**One thing here does need the network, once.** Compiling does not: the two commands above complete
under `deno run --cached-only`, which fetches nothing. But building a *runnable application bundle*
(`packages/platform/build.ts`) shells out to `deno bundle`, and Deno downloads `@esbuild` for your
platform the first time it does — about 72 seconds of waiting and then a failure if you are offline.
`issues/system/0228a` item 7 has the measurement.

## The smallest program

No manifest, no configuration, one file:

```wac
// main.wac
import { Cli, Core } from "std/platform.wac";

export i32 main(Core core, Cli cli) {
  cli.write("hello from wac\n".toBytes());
  return 0;
}
```

```sh
$ wac run main.wac
hello from wac
```

`main` may take `()`, `(Core)` or `(Core, Cli)` — the host builds what the signature asks for and
nothing else. Its `i32` return is the process exit status, which is why the examples below check
answers by looking at `$?`.

## What you get without depending on anything

Two module trees ship **inside the compiler**. Nothing on disk answers for them, and a directory of
your own with these names does not shadow them.

```wac
import { Read } from "core";                 // the pure half — no capability needed
import { Option } from "core/option.wac";    // …and its siblings, by path
import { Cli, Core } from "std/platform.wac";// the capability half
```

`core` holds `Read`, `Option`, `Result`, `Vec`, `Map`, hashing and equality, plus the JSX node types.
`std/platform.wac` holds the world: `Core`, `Cli`, the filesystem, the network, processes, the
environment, the terminal, clocks, randomness, the page.

**Every specifier is a quoted path, including these.** `from core` without quotes was the one
unquoted specifier in the language and is now an error that tells you to add the quotes.

**What is not in there is worth knowing before you start.** There is no string formatting — no
`itoa`, no `format` — no JSON, no HTTP, no crypto. Those are packages in this repository, and the
only way to reach one from your project today is a Git dependency, below. A program that wants to
print a number writes its own `itoa` or fetches one.

## Capabilities are handed in, never ambient

A program can only touch what its `main` was handed, and the command line decides what that is:

```wac
FileResult f = cli.readFile("wac.json5").wait();
cli.write((f.ok ? "read ok\n" : "refused\n").toBytes());
```

```sh
$ wac run src/read.wac                 # refused   (exit 1)
$ wac run --allow-read src/read.wac    # read ok   (exit 0)
```

A refused capability **answers false**; it does not trap. So a program that never got a grant takes
its own error path rather than dying, and you can write one that degrades instead of failing.

Writing to stdout needs no grant. `--allow-read`, `--allow-write`, `--allow-net`, `--allow-run` and
`--allow-env` are the ones you will meet.

## Making it a project: `wac.json5`

A project is a directory with a `wac.json5` in it. An empty one is valid and is all you need to use
`@/`, which names the root of the project the **importing file** is in:

```json5
// wac.json5
{}
```

```wac
import { twice } from "@/src/util/math.wac";
```

That beats counting `../../..` and, unlike a relative path, it does not change when you move the
file.

**Where you run from does not matter, and neither does how you spell the entry.** These are the same
program and all answer the same thing:

```sh
$ wac run src/main.wac        # from the project root
$ cd src && wac run main.wac
$ cd src && wac run ./main.wac
$ cd src/util && wac run ../main.wac
$ cd src/util && wac run /abs/path/src/main.wac
```

That is `§wac-import-project-4hq7mnv` — `@/` is the project containing the *importing file*, "not the
directory the compiler was started in". It was not true until `issues/lang/0168a`, where the upward
search walked the path as typed and so could climb only as far as you had spelled it.

## Depending on someone else's code

Dependencies are Git repositories, mapped to a prefix in your manifest:

```json5
// wac.json5
{
  imports: {
    'dep/': { git: 'https://github.com/voltrevo/wac', ref: 'master' },
  },
}
```

`ref` is a branch or tag — what to resolve **when you ask**. Then:

```sh
$ wac update
wacfetch: dep/ (https://github.com/voltrevo/wac @ master)
  master -> 5bc931d7cf3e via refs/heads/master
  8034066 bytes, 2725 objects -> $WAC_HOME/cache/git/…/5bc931d7cf3e…
wacfetch: 1 fetched, 0 already locked
```

and every module in that repository is reachable under the prefix:

```wac
import { f } from "dep/spec/cases/0001-bare-generic-constructor-from-the-slot.wac";
```

`wac update` writes `wac.lock`, which pins the **commit**:

```json5
{ "imports": { "dep/": { "git": "…", "ref": "master", "commit": "5bc931d7cf3e…" } } }
```

**Commit the lockfile.** Once a mapping is locked it stays locked even when its branch moves; a
second `wac update` says *nothing to fetch; 1 mapping(s) already locked*. `wac update` is the only
command that does anything different, and running it is how you take a newer commit.

**`wac update` is also the only command that reaches the network, and structurally so** — the fetcher
is a separate payload inside the binary, so there is no code path from `wac build` to a socket. A
build whose commit is not in the cache is a compile error telling you to run `wac update`, never a
silent download.

`subdir` maps one directory of a larger repository:

```json5
'acme': { git: 'https://example.invalid/monorepo', ref: 'v1', subdir: 'lib/acme' },
```

You get that directory and only that directory: code inside it cannot import the rest of the
repository, by any spelling. That is the point of naming a `subdir` rather than taking the whole
thing, and it is checked rather than assumed — `issues/lang/0169a`.

### Names you cannot use

`core`, `core/`, `std` and `std/` are reserved and never appear in a lockfile.

The whole prefix, not just the names that happen to exist — `std/anything.wac` is refused too, and so
are `core`, `std`, `core/` and `std/` themselves. `stdlib/`, `corelib/` and `mystd/` are ordinary
names and stay yours.

```
$ wac update
wacfetch: wac.json5 is not valid: code 11 (std/)
```

## Building, running and testing

```sh
wac check   src/main.wac              # diagnostics, nothing written
wac run     src/main.wac [args…]      # compile to a temporary file and run
wac build   src/main.wac -o hello     # hello.wasm — one file, nothing beside it
wac hello.wasm                        # run a built artefact — the manifest says what it needs
wac test    src/math_test.wac         # or a directory
wac bindgen src/main.wac [--js]       # src/main.gen.ts — the glue a JS host calls it through
```

**The manifest is inside the module**, in a `wac.manifest` custom section — not a file beside it.
That is what makes a built artefact one file you can hand to somebody: `wac hello.wasm` reads the
grants out of the module and refuses what the module did not ask for, and there is nothing to keep
in step or lose in transit. A module with no such section is refused by name rather than run with
guessed authority.

*(This paragraph replaced a sentence saying `wac build` writes `hello.json` beside the wasm. It does
not, and nothing in the tree ever wrote one — verified by building with and without a grant, and by
looking for a writer.)*

### Reading those `[args…]`

The line above passes arguments and does not say how a program gets them, which somebody noticed. Two
fields on `Cli`, and **argument 0 is the first argument to your program**, not the program's own name:

```wac
// greet.wac
import { Cli, Core } from "std/platform.wac";

export i32 main(Core core, Cli cli) {
  i32 n = cli.argCount().wait();
  string who = n > 0 ? string.fromBytes(cli.arg(0).wait()) : "world";
  cli.write(("hello, " + who + "\n").toBytes());
  return 0;
}
```

```sh
$ wac run greet.wac Ada
hello, Ada
$ wac run greet.wac
hello, world
```

**The `.wait()` is not ceremony and neither is `string.fromBytes`** — they are the two boundaries a
wac program crosses, and both show up in those five lines:

- **A capability answers a `Pending<T>`, not a `T`.** `argCount` and `arg` are fields holding
  funcrefs, because what they do is leave the module; `.wait()` is where the answer arrives. Nothing
  is granted implicitly, so a program that never declared a capability cannot have one — which is why
  reading an argument looks like work rather than like a variable.
- **A capability deals in bytes, and `string` is a wac type.** `cli.arg(0)` answers `u8[]`, and
  `string.fromBytes` interprets those bytes as text; `"…".toBytes()` goes the other way, which is why
  `cli.write` takes the result of one. The conversion is explicit in both directions because the
  bytes crossing the boundary are not guaranteed to be text, and a silent decode is how that becomes
  somebody's corrupted output rather than an error.

A test is an exported function whose name begins with `test`, returning a string — empty for pass,
the reason for failure:

```wac
import { twice } from "@/src/util/math.wac";

export string test_twice_doubles() {
  return twice(21) == 42 ? "" : "twice(21) was not 42";
}
```

```sh
$ wac test src/math_test.wac
1 passed, 0 failed
```

Like `main`, a test may take `()`, `(Core)` or `(Core, Cli)`, and `wac test` needs the matching
`--allow-` flags for whatever the tests actually use.

A built program carries its own manifest, so `wac hello.wasm` knows which capabilities to construct.
`hello.wasm` for the eight-line program above is 232 KB, most of which is the capability layer.

## Where things live

| | |
| --- | --- |
| `$WAC_HOME/bin/wac` | the command |
| `$WAC_HOME/cache/git/<repo>/<commit>/` | fetched dependencies, shared by every project |
| `<project>/wac.json5` | what you depend on |
| `<project>/wac.lock` | which commit — commit this |

The cache is keyed by repository *and* commit, so two projects on the same commit share one checkout
and two mappings at different commits coexist.

## Learning the language

[`spec/tour.wac`](../spec/tour.wac) is the whole of wac in one annotated file that compiles and
self-tests, and is much faster than reading [`spec/spec/`](../spec/spec/). Start there.
