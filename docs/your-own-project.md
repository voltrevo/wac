# Using wac in a project of your own

Everything below was run, in order, in an empty directory outside this repository. Where something
does not work yet it says so and names the issue, rather than being left out.

## Getting the command

**One line, no clone, and no Rust:**

```sh
curl -fsSL https://raw.githubusercontent.com/voltrevo/wac/master/bootstrap.sh | sh -s -- --host deno
```

That builds the compiler from source and puts `wac` on your PATH. `--host nodejs` is the same command
run by node instead. Neither needs cargo, a C++ toolchain, or npm.

**Without `--host`, you get a native binary**, which is faster and needs Rust:

```sh
curl -fsSL https://raw.githubusercontent.com/voltrevo/wac/master/bootstrap.sh | sh
```

`sh -s --` is how you pass arguments to a script that arrived on standard input; the script's own
`--help` says so, because getting it wrong silently runs the default.

From a clone it is the same script:

```sh
git clone https://github.com/voltrevo/wac wac && cd wac
./bootstrap.sh                    # or --host deno|nodejs|wasmtime
```

What each host needs, checked before the script does any work rather than after:

| `--host`             | needs                  | what you get                              |
| -------------------- | ---------------------- | ----------------------------------------- |
| `v8` *(default)*     | cargo, a C++ toolchain | a native binary, ~68 MB                    |
| `wasmtime`           | cargo                  | a native binary with no JavaScript in it   |
| `deno`               | deno                   | one JavaScript file with a shebang         |
| `nodejs`             | node                   | the same file, run by node                 |

**Every host produces the same `wac`.** The command is `packages/wac/src/wac.wac`, a wac program the
host carries; what differs is the engine underneath it. So the JavaScript hosts are not a cut-down
version — `packages/wacc/test/wac/commandparity_test.wac` holds every command they share to the same
output on all of them.

**There is no seed to fetch.** `bootstrap.sh` builds the compiler through a ladder of five rungs, the
lowest of which is hand-written wasm assembly text — see `bootstrap/README.md` — and reaches no
network beyond the clone, on any host.

There used to be a second route that built the compiler with the TypeScript reference instead. That
reference is deleted and so is the script that drove it: the ladder is the only way in.

**Why the path to the binary rather than a bare `wac task`.** Because you do not have one yet: that is
what the second line builds and the third line installs. `wac task` is a subcommand of the `wac`
command, so a fresh clone cannot dispatch through it at all — the seed is gitignored and there is no
binary until `./bootstrap.sh` has made one. After it has, `./native/v8/target/release/wac`
is that binary, and naming it explicitly is what `tools/push.sh` does for the same reason: an
installed `wac` from an earlier day would be a different build than the one this checkout is testing.

**This block said `deno task --no-lock wac:install` until 2026-08-27**, and the argument for it is
worth keeping because it is still true of Deno, and because the flag it turned on is the reason the
line looked odd. `deno task` restored this repository's `deno.lock` before running anything, and that
lockfile carries every npm package the whole tree uses — **twelve of them**, including Playwright,
ethers, two versions of Binaryen and `ws` — so a fresh clone downloaded all of it before compiling a
line. Neither of these steps needs a single one: nothing on the path from a clone to an installed `wac`
has npm in its import graph at all. On a slow or unreliable connection the download was what stopped the bootstrap. GitHub issue 21.

`wac task` restores nothing and has no `--no-lock`, so that whole hazard is gone rather than avoided —
which is a real gain from moving the registry, and the reason this paragraph is history rather than
advice. `./bootstrap.sh` is how you get `wac` in the first place and how you rebuild it afterwards: it
starts from the ladder every time and iterates to a fixed point before handing anything over, so
there is no separate first-build command to remember.

Cargo because the seed is a wasm module the `wac` binary *carries*, so building it means building the
binary, and `native/v8` is Rust. This said "a checkout of this repository and Deno" until 2026-08-20,
and the omission was not harmless: without cargo the bootstrap stopped after about six seconds with
its stderr discarded, so what you got was a command that quit for no stated reason. It now says which
program is missing before it does any work — GitHub issue 21, from somebody following this page from a
fresh checkout.

`wac:install` writes four things under `$WAC_HOME` (default `$HOME/.wac`) — `bin/wac`, `cache/git/`,
`env`, `install.json5` — and adds one marked line to whichever of `.bashrc`, `.zshrc`
and `.profile` already exist. Running it again is how you upgrade. `wac self uninstall` removes exactly those and never
a manifest, a lockfile, a source file or a build product.

**There is no release, no package manager entry and no prebuilt binary.** If that matters to you,
this is the wrong week.

### Without Cargo: a JavaScript-hosted `wac`

If you have Deno or Node and not Rust, `--host deno` and `--host nodejs` are the whole answer, and
they are not a fallback — they build the same command from the same ladder:

```sh
./bootstrap.sh --host deno              # or --host nodejs
wac run main.wac                        # compile and run, no file in between
```

`-o PATH` writes the command somewhere and installs nothing, which is what you want if you would
rather not touch your shell profile:

```sh
./bootstrap.sh --host deno -o ./wac
./wac run main.wac
```

What you get is a single JavaScript file with a shebang instead of a 67 MB binary, and nothing that
runs it needs to know which. It is slower than the native host on compiler-shaped work and identical
in what it answers.

**This section described two other routes until 2026-08-29, and both are gone.** One ran
`packages/platform/native.ts` under Deno to compile without installing anything; the other built the
command with `packages/platform/build.ts --target deno`. They needed npm — `build.ts` shells out to
`deno bundle`, which fetches on first use — so the Cargo-free route was also the one that needed a
network, which is the opposite of what somebody without Rust usually wants. `design/system/0009`
replaced them: the bundler that flattens the host into one JavaScript file is now
`packages/ts`, written in wac and run by the ladder, so `--host deno` needs no npm, no network and no
`build.ts`. That builder is being removed.

**The entry is `packages/wac/src/wac.wac`, and this line named the compiler's old example until
2026-08-26** — packages/wacc/example/wacc.wac, unbackticked here because it no longer exists and
`tools/wac/links_test.wac` would fail on it, which is the same trick that file plays on itself.
`issues/system/0257c` moved the command out of that example, listed this page among the files to
repoint, and repointed the others. So for a day the one documented Cargo-free way to *have* the command
named a deleted file. Everything the paragraphs below claim was still true of the program; the reader
could not reach it.

**Installing rather than building** is the difference between a command and a file you made, and it
is the same script either way — `bootstrap.sh` installs unless you tell it not to:

```sh
./bootstrap.sh --host deno       # builds it and puts it on PATH
wac check src/main.wac           # …and it is there like any other command
```

Same `$WAC_HOME` layout as the native install, same one marked line in your shell profile, same
`wac self uninstall` to take it away. `install.json5` records which host you have.

**This said `wac task wac:install --target deno` until 2026-08-29**, and that command cannot work:
`wac:install` is `bash bootstrap.sh --host v8` in `tasks.json5`, and `bootstrap.sh` has no `--target`
— it would answer `unknown argument` and print its usage. The flag belonged to `build.ts`, which is
not what installs anything. Worth stating rather than quietly correcting, because it is the shape of
error a reader cannot debug: the command names a flag, so a failure reads as *their* mistake.

`--host nodejs` gives the same thing for Node, run as `node wac`. It answers `check`, `compile`,
`build`, `bindgen`, `run`, `test` — one file or a whole directory — and `wac <prog.wasm>`, running a
built module with the grants that module's own manifest declares. `test --coverage` works here too,
over a file or a directory, though a directory answers a narrower table than the binary used to —
see below. **`sh` and `update` are here too, since 2026-08-26**, which is the second half of
`issues/system/0257c`: they were never host implementations, only separate payloads the binary
embedded, so the command carried what the *compiler's* example carried and those two were outside it.
One program now, and every host has them. Measured on a Deno-hosted build outside this repository:
`./wac sh -c 'seq 1 20 | grep 7 | wc -l'` answers `2`, and `./wac update` answers
`nothing to fetch; 0 mapping(s) already locked`.
Every command they share is held to the same output on all three —
`packages/wacc/test/wac/commandparity_test.wac`.

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

from any entry position, and `wac task bindgen` refused the same import for the same reason. GitHub
issue 22 reported it; `issues/system/0229a` has the measurement and the fix, and
`packages/platform/test/project.test.ts` is what now holds this sentence to being true.

### What the Deno path is, and is not

**It is the `wac` command now, and since 2026-08-26 that includes `sh` and `update`** — which were
missing because of how the command was built rather than because a host cannot have them
(`issues/system/0257c`). That is a change from what this
section said until 2026-08-25, and the paragraph above is where it happened: one program, built for
Deno or Node, answering `check`, `compile`, `build`, `bindgen`, `run`, `test` — a file or a directory,
with or without `--coverage` — plus `sh`, `update`, `app`, `app-run`, `validate` and `self`, and
`wac <prog.wasm>`. It is the same wac program the native binary
carries, so "the same" is by construction rather than by care, and
`packages/wacc/test/wac/commandparity_test.wac` measures it invocation by invocation anyway.

**One number this changed, and not for the better**: `wac test --coverage <directory>` now reports
only the `*_test.wac` files the walk found, so the library the tests exercise is missing from the
table and from the denominator. On a two-file project outside this repository the file form said
`12 of 14 points (85%)` over `rot13_test.wac` and `rot13.wac`, and the directory form said
`4 of 6 points (66%)` over the test file alone — same tests, same code, same run.
`issues/system/0264c` is where the two implementations' disagreement is tracked.

**What is still not the command**: the older, lower-level entry points, which remain because the
compiler needs an API and not only a CLI. `native.ts` builds and `harness/ladderRun.ts` runs one
export of a file with a wacc the ladder built — for the rung-5 self-host tests, which need a
compiler that is not the one under test. They take different flags, answer different exit codes,
and resolve a project differently — reaching for one of those is what GitHub issue 22 was
originally about. Reach for the built command unless you are working on the compiler itself. And note
that **`wac task check` is this repository's own TypeScript check**, not `wac check`.

**Nothing on this page needs the network**, on any host, which was not true until 2026-08-29 and is
worth stating because the warning it replaces is still quoted elsewhere.

Building a runnable application is `wac app`, a subcommand of the one program every host carries, and
it writes a preamble and a module — no JavaScript bundling and so no npm. Compiling, installing and
running reach none either.

**What did need it was `packages/platform/build.ts`**, which shells out to `deno bundle` and so
fetched `@esbuild/<your platform>` on first use: twice — August and a later tour — somebody watched a
command this page called offline sit for ~72 and ~74 seconds and then fail on an npm URL
(`issues/system/0228a` item 7). That builder is not how you build an application any more, and
`design/system/0009` is removing what is left of it. The diagnostic added for it in 2026-08-26 — a
bundle still going after five seconds naming the package — remains where `build.ts` is still called
from inside this repository.

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
second `wac update` says *nothing to fetch; 1 mapping(s) already locked* and changes nothing.

**To take a newer commit, remove the lock and fetch again** — delete the mapping's entry from
`wac.lock`, or the file, and run `wac update`. There is no flag that advances a pinned ref: the
fetcher takes no options at all, so "locked" means locked until you say otherwise, and moving a pin is
something you do deliberately and can see in a diff. This paragraph said that rerunning `wac update`
was how to take a newer commit, which is not true and contradicted the sentence before it — GitHub
issue 22.

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
wac app     src/main.wac -o hello     # an executable you can run directly: ./hello
wac test    src/math_test.wac         # or a directory
wac bindgen src/main.wac [--js]       # src/main.gen.ts — the glue a JS host calls it through
```

**`--` means something in one of these and not the other**, which is easy to miss because the two
lines look alike. `run` takes flags of its own, so `--` is where they stop and the program's arguments
begin. A built artefact is the first argument, so there are no command flags to end and `--` is just
another argument:

```sh
$ wac run args.wac -- one two      # the program is passed:  [one][two]
$ wac argsprog.wasm one two        # the program is passed:  [one][two]
$ wac argsprog.wasm -- one two     # the program is passed:  [--][one][two]
```

Reported as friction on GitHub issue 22, where a habit formed on `run` was carried to an artefact.

**`app` against `build`**: `build` writes a module you run with `wac hello.wasm`; `app` writes a file
you run as `./hello`. The executable is a short preamble in front of that same module, and the
preamble finds the runtime with `command -v wac` — so it is not a static binary, and a machine
without `wac` gets a sentence saying so rather than a confusing failure:

```
./hello: needs the wac command on PATH.
  https://github.com/voltrevo/wac — ./bootstrap.sh builds and installs it.
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
