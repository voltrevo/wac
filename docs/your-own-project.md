# Using wac in a project of your own

Everything below was run, in order, in an empty directory outside this repository. Where something
does not work yet it says so and names the issue, rather than being left out.

## Getting the command

There is one way today, and it needs a checkout of this repository, Deno, and **Cargo**:

```sh
git clone <this repo> wac && cd wac
deno task seed:bootstrap     # once, from a fresh clone: builds the compiler the binary carries
deno task wac:install        # builds `wac` and puts it on PATH
```

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
wac build   src/main.wac -o hello     # hello.wasm, and hello.json beside it
wac hello.wasm                        # run a built artefact — the manifest says what it needs
wac test    src/math_test.wac         # or a directory
wac bindgen src/main.wac [--js]       # src/main.gen.ts — the glue a JS host calls it through
```

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
