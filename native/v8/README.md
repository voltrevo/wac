# native/v8 — a wac host on V8, driven from Rust

```
cargo build --release
deno run -A packages/platform/native.ts packages/platform/example/wc.wac -o /tmp/wc --allow-read
./target/release/wac /tmp/wc README.md
```

```
194 1474 9335 README.md
```

That is a program from this repository, compiled by wacc, running with no JavaScript layer and no
runtime installed — and its output is **byte-identical** to the same program built by
`deno task app:build`, which is the check that matters: two hosts, one program, one answer.

## Why this and not `native/`

[`native/`](../README.md) is the same idea against wasmtime and is **shelved**. wasmtime's GC costs
2–6× on the workloads wac programs actually run, and switching its collector recovered only part of
it ([`issues/system/0138`](../../issues/system/open/0138-wasmtimes-default-collector-costs-25x-on-escaping-allocation.md)).
V8 driven from Rust matches V8 driven from Deno exactly — [`native/spike-v8`](../spike-v8/README.md)
measured five workloads and every one is within 0.01s. So the engine is not the trade; only the
embedding is. [design/lang/0003](../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md)
records the decision: **rusty_v8 is the primary platform.**

## What runs, and what does not

**Runs.** `packages/platform/example/wc.wac` end to end, and with it the whole shape of a
capability, which is the same for every one of them:

1. an import object built in Rust — one dispatcher per callback signature, each carrying its index
   as external data, because a V8 callback is a bare `fn` pointer and closes over nothing
2. `$bind$fnref_<j>(slot)`, the module turning a slot number into a funcref of that signature — the
   one operation a host cannot do for itself
3. `$bind$sm_Core_of(…)`, the module building its own capability struct from those funcrefs, in the
   field order the manifest gives — never an order this host holds a copy of
4. `wac.cb<j>(slot, …)` arriving back in Rust, and a wac `string` read out of the module's memory
   through `$bind$str_len` / `$bind$mem_ensure` / `$bind$str_to_mem`

and the whole of `Pending<T>`, which is how every capability that takes time answers: a ticket
handed over, three funcrefs the guest calls with it, and a value marshalled back through the
module's memory. Served so far:

| | |
| --- | --- |
| `Core` | `log`, `warn`, `nowMillis`, `monotonicNanos` |
| `Core` | and `randomBytes` from `/dev/urandom`, `waitAny`, `sleepMillis` |
| `Cli` | `argCount`, `arg`, `write`, `writeErr`, `env`, `cwd` |
| `Cli`, reading | `readFile`, `openInput`, `readChunk`, `stat`, `linkStat`, `readDir` |
| `Cli`, writing | `writeFile`, `openOutput`, `outputError`, `rename`, `remove`, `mkdir`, `setExecutable` |
| `Cli`, sockets | `listen`, `connect`, `accept`, `recv`, `send`, `closeSocket` |
| `Cli`, children | `pushChild`, `popChild`, `readStdin`, `spawnSelf`, `exitCode`, `closeFeed` |
| `Core` | `askInterrupt`, which answers *no*: the terminal belongs to whatever started the program |

which is enough for **box's shell**, pipelines and all:

```
$ printf 'seq 1 20 | grep 7 | wc -l\necho $((6*7))\nsha256sum README.md\n' | ./wac /tmp/bsh
2
42
b1c0b10dca90f4432e2dbc96f7bcb257451948438940992a6d2cd810f559c6f7  README.md
```

— the same three lines the website's transcript is checked against, and identical to the shell built
by `deno task app:build`. And for four smaller programs, none of them written for this host:

```
$ ./wac /tmp/wc README.md            →  194 1474 9335 README.md
$ ./wac /tmp/sha README.md           →  b1c0b10dca90…6be03  README.md    (= sha256sum(1))
$ ./wac /tmp/grep wasm README.md     →  the matching lines
$ ./wac /tmp/cp README.md copy.txt   →  a byte-identical copy
```

`sha256sum` *streams* rather than reading whole files, so it exercises `openInput` → `readChunk` →
`Read.Data`/`Read.End` and the loop a program writes around them. `cp` is the one that needs the
write side and needs it in the right order: it writes to a random temporary name and renames, so it
wants `randomBytes`, `openOutput`, `write`, and `rename` — and `write` has to reach the *redirected*
output, or a `cp` prints the file it was copying.

`readFile` is behind the **read grant** and `env` behind the **env grant**, and the difference
between them is worth stating. Reading without the grant is *denied* — `FAULT_NOT_GRANTED`, which
`platform.wac` keeps separate from the operating system's own `FAULT_DENIED` so a caller can tell
"this build cannot" from "this file will not":

```
$ ./wac /tmp/wc-nogrant README.md
wc: README.md: Not granted to this application
```

The write grant reads the same way — `cp` without it says

```
cp: cannot create regular file 'copy.txt': Not granted to this application
```

and creates nothing. `env` without the grant is *absent* rather than refused — the honest answer to "what does this
world's environment say" — and a program cannot tell an unset variable from an ungranted one. With
`WC_VERBOSE=1` in the environment, `wc` built `--allow-env` prints its timing line and `wc` built
without it does not, though both were run from the same shell. That is the capability model doing
its whole job: the grant decides, not the environment.

**`u8[]?` is not `u8[]`.** `cli.env` answers a nullable array and `wc` prints its timing line on
exactly the difference between *unset* and *set to nothing*. This host answered an empty array at
first, so the program took the wrong branch — found by diffing its output against the Deno-built
binary, which is why that comparison is the check this file leads with.

**A real child works.** `spawnSelf` runs this same module with new arguments on **a thread with its
own V8 isolate** — an isolate belongs to one thread, so there is nothing to share and the child
compiles the same bytes again. Its two output streams are byte queues the parent reads with `recv`,
on handles, exactly as it reads a socket: that is what lets `waitAny` watch a child and a socket
together, which `platform.wac` says handles are for. `exitCode` hands back *the child's own ticket*
rather than a fresh one, because two tickets for one fact is how a `wait` comes to block for ever.

A queue's cap is **8 MiB**, the same number `native/src/streams.rs` and `host/children.ts` use. That
is not tidiness: a program that behaves differently on two hosts because their buffers differ is
what that layer exists to prevent, and `packages/platform/example/feed.wac` is the program that
found the difference in the first place.

A child cannot be given more than its parent has — the grant bits it asks for are **intersected**
with the parent's rather than trusted, which is the whole of what a grant means.

**Does not.** `spawn(source, …)`, which hands over a *program's source* — a worker bundle in the
JavaScript hosts, and there is no such thing here, because a second instance comes from this module.
That answers **-1 with a reason, not -2**, and the difference is not cosmetic: -2 means this world
has no `spawn` at all, and a caller reading it gives up on `spawnSelf` too, which works.
`native/src/main.rs` reached that conclusion first; I answered -2 until a background job behaved
differently here than on Deno and reading its comment explained why. The browser shell learned that the hard way — `WACPATH=/b` with a `wc` in it reported
"no handler for capability 27" and hid `packages/box`'s own `wc`, which was sitting right there and
works. So here:

```
$ printf 'echo before\n/bin/echo external\necho after\n' | ./wac /tmp/bsh
before
external
after
```

`/bin/echo` is not spawned; the shell falls through to its own `echo` and carries on, and the
output is the same as the Deno-built shell's.

**One divergence, stated rather than hidden.** A *background* job that names a command the shell
cannot find says nothing here and says `sh: sleep: No such file or directory` on Deno. The cause is
not `spawn`: it is that a background child's error stream is a queue its parent never drains, where
the JavaScript hosts relay it. The foreground form — the one that carries an exit code — agrees
exactly on both: `sh: sleep: command not found`, and `$?` is 127, which is what the cross-host test
compares. What box's pipelines need is `pushChild` anyway, which
is not a process at all: the frame is a stack in the host, the dispatcher re-enters this program
with the frame's argv, and what it writes is collected instead of printed.

Two orderings in that path are wrong-answer bugs rather than missing features, and both bit here
first:

- **An explicit `openInput` wins over the frame's queue.** An applet that opened a file and then
  read the frame's input read what its caller had already finished — `sha256sum README.md` inside
  the shell printed the hash of *nothing*, which is a wrong answer that looks like a right one.
  `native/src/main.rs` carries the same warning about `cat f`; I ordered them the other way and
  walked straight into it.
- **`openInput("")` is standard input**, which is what box means by `-` and by an absent operand.
  Taken as a path it is a file that does not exist, and a pipeline failed with
  `grep: : No such file or directory` — an empty name, because there was none. A capability that is reached says which one it was:

```
$ ./wac /tmp/sha README.md
wac: packages/box/src/bin/sha256sum.wac trapped
Uncaught Error: Cli.openInput is not answered by this host yet
```

and `WACV8_CAPS=1` lists everything unserved on exit — a note for whoever builds the next slice,
behind a switch because a finished program printing thirty capability names it never reached is
noise on the stream a program's own diagnostics use.

**And waiting is real now.** `readFile` runs on a thread, `sleepMillis` is a thread that sleeps,
`wait()` blocks on a condition variable, and `waitAny` parks until one of a list of tickets lands.
`src/tickets.rs` holds it, and two decisions came across from `native/src/tickets.rs` because the
reasoning is worth repeating rather than rediscovering:

- **`waitAny` answers the first ready ticket in the caller's own list**, never the first to finish.
  The obvious implementation makes a program's behaviour depend on how threads were scheduled; this
  one gives the same answer for the same completions, whatever order they arrived in.
- **The deadline lives in the table**, as `Condvar::wait_timeout`, rather than inside a wait
  primitive — so a runtime can see that nothing is runnable *and* when something could become so,
  which is what a virtual clock would need.

The thing that made this a small change rather than a rewrite: an `Answer` was already plain data,
turned into a wasm value only when the guest asks, on the thread that owns the isolate. A V8 isolate
belongs to one thread, so a table holding `v8::Global`s could not have crossed to a worker at all.

`example/inflight.wac` is the check — two reads outstanding at once, `waitAny` over both — and its
output is identical to the same program built by `deno task app:build`.

`accept` is the capability that proves the point rather than merely using it: a server sits in it
until somebody dials, which may be never. `example/echo.wac` listens on a port the kernel chooses,
takes one connection, and sends back what it is told:

```
$ ./wac /tmp/echo 127.0.0.1 0
echo: listening on 33487
echo: 19 bytes back
echo: the client hung up
```

Same output from the Deno-built binary, port aside. `packages/platform/example/greet.wac` runs too,
and reports its peer — `greet: peer 127.0.0.1 (loopback)` — so the client's address crosses the
boundary as well as its bytes.

**Grants are enforced for what is served**, and every capability added here has to keep it that way:
the check is the whole difference between a capability and an ambient authority.

**Nothing here spells `$bind$`.** Every export this host calls is one the manifest named — including
the enum constructors, which used to be the exception: `Read` is what `readChunk` answers with, and
both hosts wrote `$bind$e_Read_Data_new` out because the manifest described struct fields and
methods but no enum variants at all. It carries them now, and corrupting one in a manifest makes
this host fail rather than quietly work, which is how you know the lookup is real —
[`issues/system/0141`](../../issues/system/closed/0141-the-manifest-describes-structs-but-not-enum-variants.md).

## The compiler inside it — one file that compiles wac

Everything above is a *runtime*: it is handed a program. With `seed/wacc.wasm` present at build
time, `build.rs` embeds it and the same binary is a **command**. In one step:

```
deno task app:native-binary packages/wacc/example/wacc.wac --allow-read --allow-write -o wac
./wac compile main.wac main.wasm
```

and that works for *any* wac program, not only the compiler — `app:native-binary` is `app:binary` on this
host, 64 MB against 105 MB because a V8 comes along without the rest of a runtime. Or by hand, which
is what that command does:

```
deno run -A packages/platform/native.ts packages/wacc/example/wacc.wac \
  -o seed/wacc --allow-read --allow-write
deno run -A packages/platform/native.ts packages/box/example/boxsh.wac \
  -o seed/sh --allow-read --allow-write --allow-net --allow-env
cargo build --release

./target/release/wac compile packages/wacc/src/api.wac /tmp/api.wasm
./target/release/wac sh -c 'seq 1 20 | grep 7 | wc -l'
```

`mkdir -p seed` first: the directory is gitignored, so a fresh checkout has none and
`native.ts` will not create one for you.

The shell is built with all four grants because `wac sh` narrows from what the payload carries —
see below.

```
/tmp/api.wasm: 284827 bytes from 11 file(s)
```

That is the compiler compiling **its own sources**, in one 67 MB file, with no Deno, no wasm beside
it and no JavaScript anywhere in the path — and the module is byte-identical to the one
`deno task app:build` produces from the same input, which is the check that matters.
`packages/wacc/test/nativeBinary.test.ts` holds that, opt-in behind `WAC_V8_SEED=1` because each run
rebuilds the crate. It takes **about 1.2s** (best of three: 1.37, 1.18, 1.20), against 1.28–2.05s
through Deno on a machine several agents are sharing. The two are the same to within that noise,
which is the answer to expect: same engine, same module, only the embedding differs.

**One artefact, not a seed format.** `native/`'s equivalent embeds a manifest *and* a module, because
a program there was a pair; a module built by `packages/platform/native.ts` carries its own manifest
in a `wac.manifest` custom section, so what the binary holds is exactly the file that runs when it is
handed over directly. There is no third way to build the compiler.

**What decides a bundle from a command.** The first argument, by what it *is* rather than by a flag:
a `.wasm`, or a stem with a `.json` beside it, is a program to run; anything else is arguments for
the program inside. A name ending in `.wasm` is a bundle claim whether or not the file is there —
`wac nosuch.wasm` says *cannot read*, not *unknown command*, which is what it would say if a typo
fell through to the compiler.

`seed/` is gitignored. Whether the artefact should be committed is
[design/lang/0003](../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md)'s
open question; the build works either way, which is why nothing here decides it. Without it this is
the runtime it has always been, and `wac` with no arguments says so.

**And it runs what it compiles**, which is the command a person actually types:

```
./target/release/wac run --allow-read packages/platform/example/wc.wac README.md
```

```
194 1474 9335 README.md
```

Two programs on one V8: the compiler inside the binary builds the entry into a temporary artefact,
and then this host runs *that* the way it runs any program handed to it. The grants on the command
line are the program's, and they reach it the only way they can — as the grants baked into the
artefact the compiler is asked to write, so `run` without `--allow-read` prints *Not granted to this
application*.

**A grant goes before the entry, and writing one after it is an error rather than an argument.** The
arguments after the entry are the program's, so `--allow-read` there used to be passed straight
through: the program ran **without the capability it asked for**, with a flag as `argv[0]`, and
whatever it said next was about that argument — `issues/system/0177`. It is refused now, naming the
flag and both ways out, because a program may legitimately want the string:

```
wac run p.wac -- --allow-read      # the program's first argument, no grant
wac run --allow-read p.wac         # the grant
```

`wac build` and `wac test` take grants on either side of the entry — `build` reads the entry as the
first argument that is not a flag — so only `run`, where the trailing arguments belong to someone
else, distinguishes the two positions at all.

`run` passes `--quiet` to the build, and that is the whole of what quiet means: the line saying which
file was written would otherwise land in the middle of the program's output. A program that does not
compile still says so, on stderr.

**And it writes the glue a host calls a module through.**

```
./target/release/wac bindgen main.wac --js      # main.gen.js
```

`packages/wacc/tools/waccBindgen.ts` was the last piece of the toolchain that existed only in
TypeScript — `waccx bindgen` wrote glue and this could not. `packages/wacc/src/bindgen.wac` is that
generator in wac, held to the TypeScript one **byte for byte** by
`packages/wacc/test/bindgenWac.test.ts` — over seven small programs in both modes, over
`packages/platform/example/wc.wac` (the whole capability boundary: callbacks in, funcrefs out,
`Pending<T>` and its aliases) and over the compiler's own 431 KB of glue. A one-space change in the
wac generator fails that comparison at the line, which is how you know it is comparing.

**And it runs this repository's own tests.**

```
./target/release/wac test packages/bytes/test/wac/buf_test.wac      # one file
./target/release/wac test packages/std/                             # a directory
./target/release/wac test a_test.wac b_test.wac packages/std/       # any number, mixed
./target/release/wac test                                           # here, and down
```

```
22 passed, 0 failed
```

A file named directly runs whether or not it matches the naming rule — discovery's convention is
for *finding* files, not for refusing the one you pointed at. Given a directory it finds every
`*_test.wac` under it, sorted, and runs each in its own module.
**By name rather than by directory**, because a `test/` folder holds probes and fixtures too — 56 of
the 140 files under `test/wac` here export nothing runnable and exist to be driven from a host, and
walking directories would report every one of them as an error. The suffix is exact where it
matters: of the 84 files here that export a `test*`, 83 end in `_test.wac`, and the one that does
not is `wactest`'s fixture, which fails on purpose and must stay out of a suite.

```
./target/release/wac test packages/
...
83 files: 52 ok, 31 needing a host oracle
```

**A test skipped for want of a grant is counted in that line**, because it is the line anybody reads:

```
./target/release/wac test packages/gzip/test/wac/
15 files: 13 ok, 2 needing a host oracle, 36 test(s) skipped for a grant
```

The same directory with `--allow-read --allow-write --allow-run` is `15 files: 15 ok`, and the
difference is 36 tests that compare against the real `gunzip`. Each file already named its own skipped
tests, once, in a line that scrolls past — and two people measuring that directory hours apart, one with
grants and one without, disagreed by 15× on a single file and did not read their differing test counts as
the answer. `issues/system/0183`.

355 tests in 34 seconds, and **79 MB** — `deno test packages/std/` alone takes 360 MB for the same
four files, because running one wac test there costs a Deno process, a worker isolate and often a
spawned child. This is one process and one V8.

`--filter <name>` runs only the tests whose name contains that substring. Over a directory a file
with no match is passed over quietly — most files will not hold the test you are after, and saying
so for each would bury the one that does — but a filter matching nothing *anywhere*, or nothing in a
file you named yourself, is an error rather than a green run that tested nothing.

```
./target/release/wac test --filter map packages/std/
...
4 files: 2 ok, 2 with nothing matching --filter
```

`--verbose` names each test as it passes, with what it took. A failing test is always named, so the
default is quiet on success — 355 lines of `ok` is not a report — but the timings are worth asking
for now and then:

```
./target/release/wac test --verbose packages/crypto/
ok   test_the_expanded_key_path_agrees_with_the_seed_one (326 ms)
ok   test_rfc_8032_ed25519_vectors (241 ms)
ok   test_a_non_canonical_s_is_rejected (151 ms)
...
```

A run over many files ends with the ones worth going back to, and why — over eighty files a failure
has scrolled well past by the time the summary prints, and "2 with failures" you cannot act on
without running everything again:

```
2 files: 0 ok, 1 with failures, 1 that did not run

   packages/x/test/wac/a_test.wac   did not run
   packages/y/test/wac/b_test.wac   failures
```

With `WAC_PROFILE` set to a directory it also writes **which test reached which line** — the same
env var and the same `{entry, all, tests}` shape `tools/mutate/profile.ts` already reads, so
mutation testing can be driven from here rather than through Deno. Counters are diffed either side
of each test rather than reset: `__cov_init` allocates the array, and asking it to double as a reset
would lean on a detail of the generated code that nothing states.

Checked against the path it replaces over every wrapper in the repository, not one file:
**51 files compared, 51 identical, 0 differing**. A file whose tests all need a host oracle still
writes a profile, with `all` populated and `tests` empty — a reader that saw no file could not tell
*nothing ran here* from *never asked*, and guessing the second way means treating those lines as
unhit, which is the under-selection a profile exists to prevent. That comparison is also what caught
the seed being two days old — see below, because it did not look like staleness, it looked like the
profile under-attributing by 40%.

| exit | meaning |
|---:|---|
| 0 | every test that could run, passed |
| 1 | did not compile, a usage error, or a `*_test.wac` exporting no tests |
| 3 | tests ran and some failed |
| 4 | one file, and every test in it needs an oracle this host cannot supply |
| 5 | one file, and `--filter` matched nothing in it (a skip during discovery, an error when you named the file) |

3 is separate from 1 for the reason `spec/cli/wac.md` gives about traps: a script needs to tell
*did not compile* from *ran and did something wrong*. 4 is separate from both because 31 of the 83
files here are entirely host-oracle tests, and counting those as failures would mean `wac test
packages/` could never be green — which would make the exit code useless for the one thing an exit
code is for.

`harness/wacTestRun.ts` owns the convention — an export named `test*` answering a `string`, empty for
a pass — and there are **125 files** written that way here. Every one of them needed a Deno to run;
`wac test` is the same convention with nothing underneath it. Across the corpus that is **353 tests
in 53 files** passing natively, plus `packages/wactest`'s deliberately failing fixture, which fails —
the check that this reads the report rather than assuming it.

**Every program here compiles through it to the same bytes.** All 73 that `harness/programs.ts`
finds — 14 MB of module — byte for byte against the library, which covers the binary's own I/O path
over the shapes a repository actually has: an import that goes up a directory, a package whose graph
is 179 files, a path with a space in it. Also checked by hand and consistent with the reference: CRLF
line endings, and a UTF-8 BOM, which both compilers refuse the same way.

**And it says what the tests touched.** `--coverage` builds the instrumented module, calls
`__cov_init` before the first test, and reads the counters against the table the compiler writes
beside the module:

```
./target/release/wac test --coverage packages/bytes/test/wac/buf_test.wac
```

```
22 passed, 0 failed

branch coverage: 97 of 341 points (28%)
     53 / 97    packages/bytes/test/wac/buf_test.wac
      6 / 40    packages/wactest/src/assert.wac
     38 / 42    packages/bytes/src/buf.wac
      0 / 25    packages/fmt/src/itoa.wac
      0 / 79    packages/fmt/src/ftoa.wac
```

Per file, because "28%" over a package says nothing about where to look — and the low numbers are the
report working: `buf.wac` is the file under test and is at 38 of 42, while `ftoa` and `bigint` are
what `assert` calls to *format a failure* and a passing run never reaches them. Those two numbers are
what `packages/wacc/test/nativeBinary.test.ts` asserts before comparing, since an all-zero report
would agree with an all-zero harness. Against `harness/wacCoverage.ts` on the same file the two agree
file by file.

**The two runners agree, file by file.** `packages/wacc/test/nativeBinary.test.ts` runs every one of
those files both ways — `wac test` and the module's `test*` exports called directly under Deno —
and compares the pass and fail counts: 354 tests across 53 files, no disagreement. That is the same
check `v8host_test.wac` makes for programs, applied to tests, and it is what makes running them
natively worth anything.

The rest divide into two honest nothings, and the message says which: a `*_probe.wac` is a driver for
a TypeScript test and exports no tests at all, and the tor, TLS and crypto suites are **oracle**
tests — they compare against a real implementation, which arrives as a function argument this host
has nothing to fill. Those are named and skipped rather than dropped, because a runner reporting "4
passed" for a file whose tests never ran is worse than one that says it cannot.

A test file declares no capabilities, so it has no `Core` in its manifest, and `wac test`
deliberately does not build a world for one.

**It rebuilds the file it carries.**

```
./target/release/wac build packages/wacc/example/wacc.wac -o /tmp/re/wacc \
  --allow-read --allow-write
cmp /tmp/re/wacc.wasm seed/wacc.wasm      # identical
```

`build` is `compile` plus the boundary: a native host cannot run a module without knowing which
`$bind$` export builds `Core` and in what order its funcrefs go, so an application is a module *and*
a manifest. That derivation was `packages/platform/native.ts` and is now also
`packages/wacc/src/manifest.wac` — checked against the TypeScript one byte for byte on three
programs, `packages/wacc/test/wac/manifest_test.wac`. So the bundler is in the loop only for producing the
*first* seed, and this binary can produce every one after it.

The stem matters: a manifest names the file it sits beside, so a rebuild under another name is a
different artefact, correctly. The four grant flags are the same ones `app:native` takes and mean the
same thing — whoever packages the program chooses what it may do.

## `wac sh` — the shell as a second payload

`build.rs` embeds `seed/sh.wasm` the same way it embeds the compiler, and the binary answers `sh`
with it. 0.8 MB on a 65 MB file, and a build with either payload, both or neither is legitimate:
without a shell, `sh` reaches the compiler and comes back as an unknown command; without a seed, the
host still answers `sh` and says the compiler is what is missing.

```
$ wac sh -c 'seq 1 20 | grep 7 | wc -l'          →  2
$ wac sh -c 'echo x > /tmp/probe'                →  sh: /tmp/probe: Not granted to this application
$ wac sh --allow-read -c 'wc -l < spec/tour.wac' →  933
$ wac sh                                          #  drops into the shell, reading stdin
```

**Sealed is the absence of grants rather than a mode**, which is why there is no `--sealed`. A flag
that turned sealing *on* would suggest the grants were there to begin with, and the argument of this
whole system is that a program reaches only what it was handed. It also means the short command is
the safe one.

**The flags narrow and cannot widen.** The payload is built with all four grants, and `run_shell`
intersects what the command line asks for with what the payload carries — the same rule `spawn` uses
one layer down. So the module inside is a ceiling, not a default, and a build that embedded a
read-only shell could not be talked into writing by any flag.

Unlike `run`, nothing is compiled: the shell is already a module, so these are not build flags being
passed through to a compiler. They are the world this invocation is handed.

## The one line of JavaScript

`new WebAssembly.Instance(__mod, __imports).exports`. `WebAssembly.Instance` is a JS constructor and
V8 exposes no C++ equivalent — compilation is a plain API call (`v8::WasmModuleObject::compile`) and
everything after instantiation is a direct call to an exported wasm function. Nothing of the program
runs in that line.

## Building

The `v8` crate needs a prebuilt V8 static library, 196 MB. It lives in `~/.cache/rusty_v8/` on this
machine, which is where the crate looks by default, so a build here takes about 30 seconds and no
network. A machine without it downloads it once.
