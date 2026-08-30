# wac

A C-family language for WebAssembly GC, and the systems stack written in it. See
[README.md](README.md) for the layout, [spec/](spec/) for the language definition, and
[packages/README.md](packages/README.md) for how to run things.

**This repository was two repositories until 2026-08-09.** If you have a checkout of `wac` or
`wac-mono` from before then, it cannot fetch this history — see [MERGE.md](MERGE.md), which is the
first thing to read if anything about the layout surprises you.

To learn the language itself, read [spec/tour.wac](spec/tour.wac) first — the whole of wac in one
annotated file that compiles and self-tests. It is much faster than reading `spec/spec/*.md`, and is
the right starting point before writing or reviewing any wac code.

## wac is unstable by choice

`spec/tour.wac` says it in its header and it governs more than the language: **there are no users and
no legacy to support.** Nothing here has to keep working for someone outside this repository.

So **when nothing needs a thing, delete it.** Not deprecate it, not keep it behind a flag, not keep it
"as a convenience" or because a test happens to read it — change the test. A second copy of anything
is a copy that drifts, and git remembers what was deleted.

This applies to code, tasks, tests, files written beside other files, and whole subsystems. Two
producers of one artefact is one producer too many. A differential that exists only to prove the old
thing still agrees with the new one goes when the old thing stops being used — keeping it makes the
retiree an oracle, which is the arrangement rather than evidence about it.

**If you find yourself proposing to keep something, say what would break, and check that it is not
just a test you could edit.** That question is the whole rule.

Breaking changes are logged in `~/notes/living/wac/breaking-changes.md` — check there first if a
program that used to compile has stopped.

## Where things are

    spec/          the language: definition, tour, cli documentation
    bootstrap/     the ladder that builds the compiler from source — five rungs, the lowest
                   hand-written wasm assembly text
    packages/      the packages written in wac, including `wacc`, the compiler ported to wac
    native/        the host with no JavaScript in it: Rust on wasmtime
    harness/       the test harness the packages share
    site/          the website — the only npm subtree; everything else is Deno and Rust
    tools/         repo-wide tooling
    docs/          cross-cutting detail with no home in spec/ — overflow, constant time,
                   the engine features a module needs, how to run things
    design/lang/   design/system/
    issues/lang/   issues/system/

`issues` and `design` are split by category rather than provenance: both trees numbered from 0001
and 79 numbers collide. A reference to "wac 0076" means `issues/lang/`, and "wac-mono 0103" means
`issues/system/`. New issues continue whichever sequence they belong to.

## Running things

    wac task test                                    the suite
    wac task docs                                    the doc checks — a wac phase, then Deno's
    wac task map --check                             MAP.md is generated; staleness is a failure
    ./bootstrap.sh                                   build the `wac` command and install it
    ./bootstrap.sh --no-install                      ...leaving it in the tree — `wac task seed`
    ./bootstrap.sh --host wasmtime                   ...on the engine with no JavaScript in it
    wac self uninstall [--keep-cache]                and take it away again — the command, not a task
    deno test -A --unstable-net packages/<name>/      one package, by hand
    deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts

**`wac task wac:install` is the supported way to *have* the command** — `design/lang/0009` D1. It
builds the seed (fixpoint-checked), installs `bin/wac`, `cache/git/`, `env` and `install.json5`
under `$WAC_HOME` (default `$HOME/.wac`), and adds one marked line to whichever of `.bashrc`,
`.zshrc` and `.profile` already exist. Running it again is how you upgrade: the line is replaced
only if it points somewhere else, and a profile that does not exist is not created.

**`--no-profile` installs and touches no profile at all**, and a profile that exists but cannot be
written is reported beside a complete install rather than failing it. Until 2026-08-26 an unwritable
`.bashrc` aborted the command *after* the binary, the cache, `env` and `install.json5` were all in
place, so it reported failure over a usable installation and re-running could not help — GitHub
wac#26.

**Taking it away is `wac self uninstall`, a subcommand rather than a task**, and it removes exactly those
things and never a manifest, a lockfile, a source file or a build product. There was a
`deno task wac:uninstall` too until 2026-08-26; it went because it was the copy nobody who had
installed the command could reach — a Deno program under `tools/` needs this checkout, and they have
a `$WAC_HOME` and no checkout.

**Rebuild after touching `packages/wacc/` — or after *pulling* someone else's change to it.**

**There is one build command and it always starts from the ladder.** `./bootstrap.sh` builds the
five rungs, builds `wacc` with the top one, then rebuilds `wacc` with *that* until two rounds agree
byte for byte — `design/lang/0009` D2. A build that never settles is refused rather than installed.
Until 2026-08-28 there were two routes: a shell script for the ordinary case, which needed a
working `wac` to rebuild `wac`, and a `--bootstrap` flag on it for when that was the thing that was
broken. The second one subsumes the first, so only it remains.

**`wac task` replaced `deno task` on 2026-08-27.** The names are unchanged; `tasks.json5` holds
them and `wac task` with no argument lists them. 41 of the 78 invoke the `wac` binary and three
are shell, so the registry had been a JavaScript dependency for the sake of a lookup table.
`deno.json` keeps `imports` and `exclude`, which the TypeScript that remains still needs.

**A fresh clone cannot run `wac task` at all**, because the seed is gitignored and there is no
binary to dispatch with. The first command in a new checkout is `./bootstrap.sh`, and that is why it
stays a shell script rather than becoming a task.

**`--host` picks the engine, and that is the whole of the difference.** `v8` is the default and
`wasmtime` is the same command with no JavaScript underneath it — `design/system/0001` D9 is why the
second one is worth having, since it is the only host that tests the claim that a wac program does
not depend on one. Both carry the *same* seed module and answer the same 21 capabilities; the
binaries are 68 MB and 15 MB. Neither is a different product, which is why the wasmtime one stopped
being called `wacland` on 2026-08-28: Wacland is the system, not one of its hosts.

**The wasmtime binary is not built by default and a checkout without one is not quietly short of
coverage.** Eleven test files reach for it; `nativeHostWhyNot()` in `packages/wactest/src/built.wac`
gives them a reason to print, and they skip with it rather than build a Rust crate nobody asked for.
`issues/system/0208`.

**It builds one payload, since 2026-08-25.** The binary used to carry three — a compiler, a shell and
a fetcher, answering `wac build`/`run`/`test`, `wac sh` and `wac update` — and `issues/system/0257c`
put the second and third *inside* the first, because `wac` is one program containing the compiler
plus more rather than a compiler with two modules beside it. The binary lost 1.3 MB and every other
host gained two commands it never had.

That also retires a whole class of mistake: this script wrote only the compiler until 2026-08-20, so
the supported route produced a `wac` answering `unknown command 'sh'` and a red suite for anyone who
ran `wac update` (`issues/system/0216a`). There is no second file to forget now. `wac build` remembers
what it built since 2026-08-24 (`issues/system/0204`), keyed on the compiler, the sources, the grants
and the output name.

**The fixpoint rounds are built with the cache off, and 12.2s was the number for not checking.** The
saving was the fixpoint check not running: every round writes `wacc` into a directory of its own, so
in the steady state round 2's key is round 1's, and `cmp` compared an artefact with a copy of
itself. `WAC_BUILD_CACHE_KEEP=0` is set around the rounds and the honest figure is 27.2s. Each round
also writes to the same *basename* in a different directory, because `wac build -o` records the
output name in the manifest — two builds of one source to two names are never byte-identical, and a
comparison across names can only ever say "never settles".
`packages/wacc/test/wac/selfhost_test.wac` had the same hole and uses the `--no-cache` flag, which it
also *checks* — a hit prints `bytes from cache` and the test refuses one. Reach for either switch if
you ever suspect the cache of serving something stale.

**And it is the one to reach for when an unrelated file stops compiling.** A `wacc` change from
another agent can be one the *current* seed cannot compile, and the symptom is not "your seed is
old" — it is an ordinary file failing to emit with a message about lambdas or about a construct that
was fine yesterday.

**`./bootstrap.sh` is the way out, and the only build command there is.** It starts from the ladder
every time — five rungs whose lowest is hand-written wasm assembly text — so the compiler that is
false-alarming is out of the loop, and it iterates to a fixed point before handing anything over. A
first build and a reseed are the same operation, which is why there is no second command for the
first one.

    ./bootstrap.sh                      # build it and install it into $WAC_HOME
    ./bootstrap.sh --no-install         # rebuild the seed in the tree — `wac task seed`
    ./bootstrap.sh --host wasmtime      # the same command on the engine with no JavaScript in it
    ./bootstrap.sh -o ./wac             # just write a binary here

**Spelled as the script rather than as a task**, because `wac task` is a subcommand of the binary,
and the one situation this line is for is the one where you have not got a binary. There was a task
named for it for a day — a string nobody in that situation could run.

It is needed more often than it sounds: a new checker rule that reports on
`packages/fs/src/proc.wac` cannot build its own successor, since that file is in the seed app's
graph, and the symptom is a seed build failing on a file you did not touch.

**`WAC_APP_FROM=reference` is gone**, along with the compiler it selected. It asked the TypeScript
reference to compile the *app*, and stopped working before it was deleted: the app imports
`packages/platform`, whose `Pending<T>.then` is a lambda, and that frontend had none. There is one
compiler now and nothing to select.

The `wac` binary carries a *prebuilt* compiler —
`native/v8/seed/wacc.wasm`, gitignored, one per agent — so `wac build`, `wac run` and `wac test` keep
compiling with whatever that file is until it is rebuilt. `cargo build` does not do it: the seed is an
input to the build, not an output of it. A seed two days behind produced a coverage report over
`packages/std` that named real files and real lines and was 40% short, and the shape of the evidence
pointed at the profiler rather than the compiler (`issues/system/0160`). `tools/wac/seedfresh_test.wac`
fails when the seed is older than the sources, which is how you will usually find out.

The *pull* half is easy to miss, because nothing you did made it stale: this is a shared repository and
another agent's commit to `packages/wacc/src` ages your seed the moment you merge it. So the rule is
about the file's mtime rather than about your own edits — `git pull` before a gate run and the gate
fails on the seed, which is exactly what happened twice in one day. Rebuild after a merge that touches
that directory, and before running anything that goes through the `wac` binary.

**`--unstable-net` when you run tests by hand.** `wac task test` passes it for you, so it is easy to
not know about until a package fails with `Deno.listenDatagram is not a function` or
`Deno.QuicEndpoint is not a constructor` — messages about a missing API rather than about a flag.
`packages/quic` and `packages/platform`'s datagram tests need it; nothing else notices it, so it costs
nothing to pass always. `tools/mutate.ts` lacked it for a day and quietly stopped measuring whole
packages — `issues/system/0005`.

The site needs its own two flags — `site/src` is a vite project whose
extensionless imports Deno's resolver refuses. Its TypeScript is checked by `npx tsc -b` in `site/`,
which is the checker that agrees with the bundler building it. `site/` is excluded from the
repo-wide Deno walks for the same reason.

**A script under `site/` cannot import from `harness/`.** `site/package.json` puts that subtree in
an npm resolution scope, so a specifier that resolves fine from the repo root is looked up as an npm
package there and fails — which is what makes it confusing. It is why
`harness/waccFromLadder.ts` lives where it does rather than in `site/tools/`, where it was written:
two callers wanted it and only one of them could be in that directory. `site/tools/syncWacc.ts`
re-exports it for the one that is.

`issues/system/0146` is the deploy this cost: the published playground quietly compiled with the
TypeScript reference for a while, because the page fell back when the asset was missing and nothing
said so. There is one compiler in the browser now, and both of that dispatcher's guards are
errors.

**Anyone may change the compiler.** It used to have one owner and a rule that sent everyone else to
the issues directory; that is no longer the case. If you are building something *in* wac and hit a
compiler bug or need a language feature, fixing it is ordinary work.

File an issue when the blocker is a *decision* rather than the work — a change that would make the
shared test suite red for everyone, or one where two reasonable answers exist and picking wrong is
expensive to undo. A reproduction is still worth more than a patch when you are not going to write
the patch.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for how to work here — spec tags, what a test has to
prove, and when a blocker is an issue rather than a patch.
