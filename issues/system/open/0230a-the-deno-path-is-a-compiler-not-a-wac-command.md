# 0230a — the Deno path is a compiler, not a `wac` command

- **Status:** open
- **Claimed by:** agent-c, 2026-08-21, on the operator's ruling below
- **Reported by:** agent-a, from GitHub issue 22 finding 3 and its acceptance criteria
- **Kind:** decision
- **Symptom:** not implemented — every subcommand exists somewhere, and none of them is `wac`

## What was asked for

GitHub issue 22 built a project without Cargo, successfully, and then said the thing worth quoting:

> The current Deno path is described as "compiling through Deno," and that is exactly all it is. It
> should instead be Wac hosted by Deno: the same command, same project, same resolver and same
> development loop.

The acceptance criteria ask for `check`, `run`, `build`, `test`, `bindgen` and `update` from a
JS-hosted command, sharing flags, exit codes, diagnostics, capabilities and manifest behaviour with the
native binary, over a single project resolver.

## Measured: what a reader can actually reach today

The issue says "none of these except `build` have Deno equivalents". That is not quite it, and the
difference is the whole point — **most of them exist and none of them is a command.** One entry point
each, different spellings, different flags, different exit codes:

| subcommand | the Deno-side thing that does it | how you invoke it |
|---|---|---|
| `build` | `packages/platform/native.ts` | `deno run … native.ts entry.wac -o stem` |
| `check` | `tools/check.ts`, `harness/referenceCheck.ts` | `deno run -A tools/check.ts entry.wac` |
| `run` | `harness/referenceRun.ts` | `deno run -A harness/referenceRun.ts entry.wac` |
| `test` | `harness/wacTestRun.ts` | not documented for an outsider |
| `bindgen` | `tools/emitgen.ts` | `deno task bindgen entry.wac out.gen.ts` |
| `update` | — | nothing |
| run a `.wasm` | `packages/platform/host/driver.ts` | via a built application |

`deno task check` is **the repository's own TypeScript type check**, not this. So a reader following
the documentation finds one of these seven, and the name of the task that sounds most like the second
one does something else entirely.

`issues/system/0229a` is what that arrangement cost in practice: five of those entry points resolved a
`@/` import differently from the other two, because each called the loader itself and two of them
called the better function. That is fixed, and it is evidence for this issue rather than a substitute
for it — the fix works by making one shared function the only way in, which is the same argument one
level up.

## Why it is a decision and not just work

`design/lang/0009` D1 makes `deno task wac:install` the supported way to *have* the command, and the
binary is where `sh`, `update` and the capability model live. A JS-hosted `wac` is not a wrapper around
that; it is a second implementation of the command surface, and the acceptance criteria explicitly ask
for the two to agree on flags, exit codes, diagnostics and capabilities. Agreement between two
implementations is a thing that has to be tested, not asserted, and the repository has no differential
for it today.

So the question is not "should the Deno path be better" — yes — but **what is the shared thing.**

## Options

**1. One dispatcher in TypeScript, hosts underneath.** A `wac.ts` parsing the same arguments as the
binary and dispatching to the existing pieces, with the project resolver behind one function (which
`harness/referenceCompile.ts` now is for the reference side). Cheapest to reach a working command;
leaves two argument parsers to keep in step, which is the thing the issue is complaining about, one
level up.

**2. One dispatcher in wac, hosted by three runtimes.** `packages/wacc/example/wacc.wac` already
parses `check`/`compile`/`build`/`bindgen` and already resolves projects — it is a wac program, so it
runs anywhere wac runs. Give it the remaining subcommands and let Deno, Node and the native binary each
be a *host* that hands it argv and capabilities. This is what the issue's diagram asks for, and it is
the only option where "native and JS hosts share semantics" is true by construction rather than by a
test suite. It is also the largest: `run` and `test` need to start a module from inside a wac program,
which the native host does and the JS hosts do through `driver.ts`.

**3. Document the gap and do nothing.** Say plainly that the Deno path compiles and does not do the
development loop, and that `wac:install` is the route to a command. Honest, cheap, and what
`docs/your-own-project.md` says today after this issue's doc change — but it leaves the stated goal of
"JavaScript/TypeScript projects should use their existing runtime" unmet.

## Recommendation

**Option 2, reached through option 1.** The end state is the wac program being the one command, because
that is the only version of this where the two hosts cannot drift; but the first step that pays for
itself is a single dispatcher with a single resolver, which is most of option 1 and is the scaffolding
option 2 needs anyway. Doing option 1 *as* a step means not writing a second argument parser to throw
away: parse in wac from the start, and let the TypeScript side be argv, capabilities and process exit.

Whichever is chosen, the acceptance criterion that should be built **first** is the differential: one
table of invocations run through both hosts, compared on stdout, stderr and exit code. Without it,
"shared semantics" is a claim, and the two loaders in 0229a are what a claim like that looks like after
a few months.

## Secondary items from the same issue, not yet done

- **`deno bundle` fetches `@esbuild` on first use.** Not new — `issues/system/0228a` item 7 measured it
  while fixing the binaryen half. What is new is that the author hit it as an *undocumented* network
  dependency of something described as offline, in an environment with no network, after 72s. The
  compile paths themselves are clean: `native.ts` and `emitgen.ts` both complete under
  `deno run --cached-only`. Only building a runnable *application bundle* needs the bundler. Documented
  now; removing it means not using `deno bundle`.
- ~~**`wac run` argument passing**~~ and ~~**the byte/string boundary**~~ — done together in
  `docs/your-own-project.md`, since one five-line program crosses both: `cli.argCount().wait()`,
  `string.fromBytes(cli.arg(0).wait())`, `"…".toBytes()`. The prose says *why* each conversion is
  there — a capability answers a `Pending` because the call leaves the module, and it deals in bytes
  because what crosses is not guaranteed to be text — rather than presenting them as ceremony. The
  example was run both ways before it went in.
- ~~**`harness/wacBind.ts` still calls the roots-dropping walk.**~~ **Done 2026-08-21** — see 0229a.
  It was filed here rather than fixed on the argument that it threads `files` through four internal
  functions and a cache key, that this repository has no `@/` import for it to matter to, and that it
  was therefore "the same edit, four times over, for a case no caller has yet". **The cost estimate
  was wrong, and in an instructive direction:** the edit that fixes it is not four repetitions of
  adding two arguments — that is the edit that *caused* the bug twenty times over. Replacing the
  `files` parameter with a `Graph` of files, roots and base is the same size and cannot be dropped by
  a later caller, which is the difference between fixing an omission and re-enabling it.

  `wacTestRun.ts` and `wacCoverage.ts` went with 0229a itself, since `wac test` is one of the six
  subcommands above and a test file in somebody's project imports through `@/` like any other file.

  Doing `wacTestRun` needed one new entry point, `diagnoseFilesIn`, rather than reaching for
  `diagnoseGraphIn`, which was the only `In` variant that existed: the whole-graph walk is a *stricter*
  check than the entry-only one this lane has always done, and swapping them while adding roots would
  have made every wac test file in the repository a subject of a second change nobody asked for.

## Measured on Node as well — agent-c, 2026-08-21

`packages/platform/build.ts` builds `packages/wacc/example/wacc.wac` for the **node** target
(1,357K, all five grants), and it runs. So the JS-hosted half of this is not "a compiler with no
commands": it is **four commands**, and they work.

    node ./wac-node check src/main.wac    ->  src/main.wac: 4 file(s), no diagnostics
    node ./wac-node run   src/main.wac    ->  wacc: unknown command 'run' — check, compile, build or bindgen

The four are `check`, `compile`, `bindgen` and `build`, and `@/` resolves correctly through all of
them from an external project — 0229a's fix holds on this host too, tested from the project root.

**So the split is not compiler-versus-nothing; it is wac-program versus Rust host**, and the boundary
is one capability:

| where | commands |
|---|---|
| `wacc.wac`, which any host can run | `check`, `compile`, `bindgen`, `build` |
| `native/v8/src/main.rs`, Rust only | `run`, `test`, `sh`, `update`, `app`, `uninstall` |

The host side's own comments say why, and they name the same reason three times: *"`run` is this
host's own command rather than the compiler's: the compiler writes a module and cannot instantiate
one"*, and `sh` and `update` are "the host's too… the shell/fetcher is already a module". Every one of
the six is an *instantiate a module* command.

**Which makes the gap smaller than it reads, and points at where to close it.** `Cli.spawn` takes
module bytes, an argv, grant bits and a working directory, and starts a confined module — so
"instantiate a module with these grants" is already expressible *in wac*, on every host that has the
capability. A `run` implemented in `wacc.wac` over `spawn` would appear on the native binary, the Deno
host and the Node host at once, which is what this issue is asking for; `update` is the same shape,
since the fetcher is already a wac program the host merely instantiates.

Not done here, because which commands belong in the shared program and which stay host-specific is
this issue's decision rather than a patch — and `test` genuinely is not in that class, since its
chunking, ranking and module caching are the host's.

## Measured: how far apart the two hosts are, and why the differential above is not the next step

agent-a, 2026-08-21. The recommendation above says the criterion to build **first** is a differential —
one table of invocations through both hosts, compared on stdout, stderr and exit code. **I started
building it and stopped, and the reason is worth more than the test would have been.**

### The differential already existed and was deleted on purpose

`issues/system/0214` closed on exactly this comparison: `native.ts` and `wac build` emit **byte-identical
artefacts, module and manifest both**, on `example/wc.wac` and `example/wacc.wac`. `tools/seed.sh`'s
header records it too. Its own trap is the one I then walked into independently — two different `-o`
stems, because the output name is inside the manifest, and the artefacts came out one byte apart.

And the test that compared them, `packages/wacc/test/nativeBinary.test.ts`, was **deleted, on the
operator's call**, with the reason stated in 0214: *"Deno-driven testing is being removed, not kept on as
the oracle that validates what replaces it."* `CLAUDE.md` says the same thing generally — a differential
that exists to prove the old thing still agrees with the new one goes when the old thing stops being
used, because keeping it makes the retiree an oracle.

So the differential this issue asked for would have re-created a deleted test to re-measure a closed
issue. **What the criterion is actually short of is a second command surface to compare** — comparing
`build` alone is comparing the one thing that was never in question.

That is worth having settled before choosing an option: option 2's argument is that the two hosts cannot
drift, and for the compiler they have not drifted at all. Whatever is chosen, the thing to test is
dispatch — argument parsing, exit codes, which subcommand exists — not compilation.

### What the measurement did find

Driving the host from outside rather than reading it, on the four entry spellings the criteria name
(absolute, absolute two directories down, relative from the project root, relative from inside `src/`,
each importing through `@/`), plus a build carrying `--allow-read --allow-env`:

- **All of them agree, byte for byte** — as 0214 says. The grants are in the manifest, so a host that
  dropped one would change the bytes; they do not.
- **Diagnostics agree on more than they look like.** Same headline, same help line, same
  `file:line:col`. Only the binary renders the source frame and the note on the caret — *"expected i32,
  found string"*. The difference is the renderer, not the diagnostic.
- **Both exit 1 on an entry that is not there** and name the file; **both exit 2 on `-o` with no value**
  and print a usage line. So argument handling does not diverge generally — which makes the two places
  it does much cheaper to state.

### Three defects, two fixed here

- **An unrecognised flag was accepted.** `native.ts … --allow-bogus` exited **0 and wrote the module**,
  because every grant is an `args.includes(…)` and nothing looked at the leftovers. `--allow-network`
  for `--allow-net` therefore produced a program with no network grant and no complaint, and the failure
  arrived at run time as a capability refusal with nothing pointing back at the spelling. `wac build`
  refuses with exit 2 and names the five. **Fixed**, held by
  `packages/platform/test/wac/nativecli_test.wac` — a test about this host refusing what it cannot do,
  not a differential.
- **The usage line named a task that does not exist.** It said `deno task app:native`; `deno.json` has
  `app:build` and nothing else in that family. The first thing a reader gets wrong here was answered
  with a command that does not run, which for an onboarding case study is the worst possible place for
  it. **Fixed** — it now prints the `deno run … --import-map` spelling `docs/your-own-project.md` gives.
- **A bare specifier resolves differently in the two hosts, and one of them compiles the wrong file.**
  `issues/system/0234a`, filed rather than fixed: with `dep/` mapped and a real `src/dep/lib.wac`, the
  Deno walk joins the mapping name to the importing directory and the program answers 99, exit 0, no
  diagnostic. The binary refuses that — but accepts a bare specifier *no* mapping declares, resolving it
  as though it were relative, which the spec does not define either. Fixing one side alone trades a gap
  for a gap, so it is a decision.

## Ruled: option 2 — the operator, 2026-08-21

> option 2 for sure

So the shared thing is **the wac program**, and Deno, Node and the native binary are hosts that hand
it argv and capabilities. Taken with the recommendation above, that means the first step is not a
TypeScript dispatcher at all: parse in wac from the start, and let each host contribute argv,
capabilities and a process exit.

**And the differential comes first**, which is this issue's own strongest advice and the thing that
makes the ruling checkable rather than aspirational: one table of invocations through every host,
compared on stdout, stderr and exit code. Anything else built before it is a claim about agreement.

### What the ruling changes about the cost estimate above — corrected by building it

**First estimate, and it was wrong.** I wrote here that `Cli.spawn` makes `run` expressible in the wac
program "on every host that has the capability — which is the native binary, Deno and Node". Then I
implemented `run` that way — 124 lines, compiles, spawns the emitted module, pumps both streams
through `waitAny` and forwards the exit code — and it is reachable on **no host at all**:

| host | `spawn(moduleBytes, …)` | `run` reaches the program? |
|---|---|---|
| the `wac` binary (V8) | **works** — measured with a probe: child ran, exit 7 came back | no: Rust answers `run` before the payload sees it |
| `wacland` (wasmtime) | *"spawning a program from its source is not implemented in the native runtime; spawnSelf works"* | yes, and then it cannot spawn |
| Deno | *"this host starts JavaScript worker bundles, and cannot start a wasm module here"* | yes, and then it cannot spawn |
| Node | same host code as Deno | same |

**Three of those four rows are obsolete as of 2026-08-21** — see the entry below.

So the code was reverted rather than landed. Unreachable code that compiles is the shape this
repository keeps finding — a capability wired in and never executed — and it would have sat here
looking done.

### The real first step is a host gap, and it already has an issue

`issues/system/0144` — *"a wasm program can be spawned on the native hosts and not on the JavaScript
ones"* — is the prerequisite for option 2 reaching Deno or Node **at all**, not just for `run`: every
subcommand the JS hosts are missing is an instantiate-a-module command. It was filed by agent-b on
2026-08-12 and claimed by me on 2026-08-15, and it is still open, which is worth saying plainly since
the ruling now depends on it.

The wasmtime host has the same gap from the other side: it takes a module as its *argument* and cannot
start one from bytes, so `spawnSelf` works and `spawn` does not.

So the order under the ruling is:

1. **the differential** — done, `packages/wacc/test/wac/commandparity_test.wac`, six invocations
   through the native binary and the Deno host agreeing on exit code and both streams;
2. **0144, and the wasmtime half beside it** — the JS hosts and `wacland` able to start a module from
   bytes. Until then option 2 cannot move a single non-compiler subcommand;
3. **`run` into the program** — the implementation is written and known to work against a V8 spawn;
   it becomes reachable the moment step 2 lands, and its first host is whichever gets there first;
4. ~~**delete the Rust `run`**, with the differential as the proof that the two agreed before the
   swap;~~ **struck 2026-08-22 — this was never the ruling.** The operator ruled option 2 and I wrote
   a deletion step into this order myself, then quoted it back as though it had been decided. Their
   words: *"the goal is that they all work more or less the same way … I don't know why we're talking
   about deleting wac run."* Nothing is being deleted; two implementations held to one output by
   `commandparity_test.wac` is the arrangement, and the native binary's in-process `run` is the one
   that does not pay a relay.
5. `update` the same way; `test` last or never — its chunking, worker scheduling, module caching and
   CPU ranking belong to `tools/runTests.wac`, not to the compiler.

## 2026-08-21: step 2 is done, so option 2 can move

`issues/system/0144` is closed. **All four hosts start a wasm module now**, measured with one runner
and one probe, both `.wasm`, through each host:

| host | `spawn(moduleBytes, …)` |
|---|---|
| the `wac` binary (V8) | works — it always did |
| `wacland` (wasmtime) | works — `Cap::Spawn` builds a `World` from the bytes it was handed |
| a built Deno program | works — the build inlines `host/childWasm.ts` into the stub |
| a built Node program | works — the same, with `host/childWasmNode.ts` |

`packages/platform/test/wac/spawn_test.wac` holds three cases over it, each watched failing with its
own half disabled. So the table above — three of whose four rows said "and then it cannot spawn" — is
history, and the estimate this issue corrected once is now correct: `run` in `wacc.wac` is reachable
everywhere, which is what the 124 reverted lines were waiting for.

**The order stands, and step 3 is next**: move `run` into `wacc.wac`, with `commandparity_test.wac`
widened to cover it. Nothing here is claimed beyond 0144, which is closed.

One thing found while doing it belongs to this issue rather than to 0144: **`wac run <a module>` hangs**
— `issues/system/0239c`. It compiles whatever path it is given, so a `.wasm` goes to the lexer. Now
that every host can *start* a module, `run` recognising the magic bytes and running it is a real option,
and it is this issue that owns which subcommand does what.

## 2026-08-22: step 3 is done — `run` is in the wac program, on all three hosts

`cmd == "run"` in `packages/wacc/example/wacc.wac`: compile, wrap the module in its manifest, `spawn`
it with the grants written before the entry, relay both streams, forward the exit code. The Deno- and
Node-hosted commands answer `run` now, which no host but the native binary could do before.

**Eleven invocations, three hosts, identical stdout+stderr and identical exit codes** —
`commandparity_test.wac`, which grew Node as a third column and five `run` rows. Watched failing:
breaking the exit-code forwarding turns `run src/seven.wac` into `got 0, want 7` on both JS hosts.

### Four of the eleven rows exist because the first attempt disagreed

Measuring found real differences rather than confirming a design, which is the reason the issue asked
for the differential first:

| the case | what differed | which side was wrong |
|---|---|---|
| `run p.wac -- --allow-read` | JS hosts said `unknown flag '--'` | **mine** — `unknownFlag` scans the whole line, right for `build` and wrong for the one command with a tail. `run` has `unknownFlagBefore` now, which stops at the entry |
| `run --nonsense p.wac` | native printed the whole four-command usage block | **the Rust** — its flag loop stops at the first thing it does not know, so `--nonsense` became the entry. It names the flag now |
| `run` with no entry | JS hosts printed the whole block | **mine** — the native already printed `run`'s own line. `usageFor(cmd)` says it on all three |
| `run p.wac --allow-read` | agreed, both refusing | neither — and worth recording, because that is `issues/system/0177`'s rule arriving in a second implementation by being written down rather than by being copied |

### One difference no assertion covers, stated because it is real

The Rust `run` **instantiates the module in its own process**; the wac `run` spawns it and relays.
Same bytes on each stream, same status — and not the same thing to a program that wants a terminal,
or to one whose output is large enough for the relay to matter. That is the honest cost of `run` being
expressible in wac at all: a wac program's only way to start a module is `spawn`.

### What is left

- **Step 5**: `update`, then `sh`; `test` last or never. `test` is the one whose Rust half does real
  work — collecting files, building an aggregate entry, `--filter` — rather than dispatching.
- Still open and unclaimed by me: `issues/system/0239c`, which is `wac run <a module.wasm>` hanging.
  Now that `run` exists in two places, it hangs in both for the same reason: neither looks at the
  magic bytes before handing the path to the compiler. **And `wac <module.wasm>` now works on all
  three**, so the fix is available and small: `run` could recognise the magic bytes and hand over.

## 2026-08-22: `wac <module.wasm>` works on all three, and the goal is restated

**The goal is parity, not migration.** The operator corrected the framing: *"the goal is that they all
work more or less the same way. if that's not possible then talk to me about it."* Step 4 above is
struck. Two implementations of `run` held to one output is fine; what is not fine is a host answering
a question the others cannot.

`wac <prog.wasm>` — "run that program", the most basic thing this command does — worked on the native
binary alone until today. The other two printed the four-command usage block at somebody holding a
built program. Sixteen cases now agree across native, Deno and Node.

### The grant model is where this was interesting

A module run as `wac <module.wasm>` gets the grants **its own manifest declares**. That is not
`spawn`'s rule, where the parent decides — so the obvious implementation, ask for every grant and let
the host narrow, is a **capability hole**: a JS-hosted command built with `--allow-read` would hand
read to a module that declared none. It passes every other assertion in the differential, which is why
`reader.wasm`/`reader-read.wasm` are in it — one program built twice, and with the hole in place the
first prints `read ok` on a JS host and `read denied` on the native binary.

So the wac program reads the section itself: `manifestIn` in `packages/wacc/src/manifest.wac`, the
reader beside the writer, and `declaredGrants` parsing it with `packages/json` — which was already in
this program's graph through `wacpkg`, so it cost a call rather than a dependency.

### Two messages had to be made host-independent to get there

- `cannot read` carried an errno: `No such file or directory (os error 2)` on the native, and Node's
  `ENOENT: no such file or directory, open '…'`. `faultWords` on the wac side and the existing
  `message_of` on the Rust side both give `No such file or directory`.
- A manifest that is *present and not JSON* is still reported with the parser's own text on each side,
  and no wording either could adopt would be the other's. That case is out of the differential rather
  than approximated.

### Where parity stands, measured 2026-08-22

| | native | Deno | Node |
|---|---|---|---|
| `check` `compile` `build` `bindgen` | yes | yes | yes |
| `run` | yes | yes | yes |
| `wac <module.wasm>` | yes | yes | yes |
| `test` `uninstall` `app` `app-run` | yes | no | no |
| `sh` `update` | yes | no | no |
| `validate` | yes | no | no |
| `covdump` `tracestat` `ctcompare` | yes | no | no |

**`test`, `uninstall`, `app` are work with no blocker.** `test` is the big one: collect `_test.wac`
files, build an aggregate entry, spawn it, `--filter`. Nothing in it is host-specific.

**`sh` and `update` need a decision, because the native binary embeds three modules** — the compiler,
`packages/sh` and the fetcher — and a JS-hosted `wac` is built from `wacc.wac` alone, so `wac sh` has
no shell to start. Either `build.ts` learns to embed extra modules, or those two move into the wac
program, or they stay native-only by design. Raised with the operator; not decided.

**Decided on 2026-08-25, and the framing above was wrong.** The operator: "`wac` *contains* the
compiler, plus more stuff. each version of the wac unified binary should do all the stuff", and
separately that "wacc has grown to include things that it shouldn't". There is no third option: the
reason `wac sh` has no shell is that the command is built from `packages/wacc/example/wacc.wac`, the
compiler's own example. `sh` and the fetcher are ordinary wac programs and go in the command, once
there is a command to put them in. `issues/system/0257c` has the ruling, the inventory of what is in
the compiler that should not be, and the order of work.

**`covdump`, `tracestat` and `ctcompare` cannot move at all today.** They read a module's *exports* —
`__cov_get` for the counters, the journal for a trace — and `spawn` hands over a *program*: streams and
an exit code. There is no capability for "instantiate this module and call that export", and adding one
is a bigger decision than parity. The Rust says why nothing in wac can reach it: *"the instrumentation
injects it, so no source names it."*

**`validate` is the odd one and should not be made identical.** It answers whether *the engine* accepts
a module, so three hosts giving three answers is the command working. "Each host answers for its own
engine" is the right goal there.

## 2026-08-23: `Cli.load` exists on all four hosts, so `test` is unblocked

`issues/system/0240c` is closed. A wac program can load a module and call its exports — including one
that traps, which 389 of this repository's 2553 test exports do — on Deno, Node, `wac` and `wacland`
alike. `packages/platform/example/testrun.wac` is forty lines that do what `wac test` does to one file,
and it runs on all four.

That was the blocker under step 5's hardest piece. What is left on that step is the *work*: discovery
(walk for `*_test.wac`, `--ignore`, a named file), the aggregate build, `--filter`, and the report's
exit codes 0/1/3/4/5. None of it needs anything the platform does not now have — except `--coverage`,
which needs `__cov_init`/`__cov_len`/`__cov_get`, and those are three of the four shapes `call` accepts.

Still ahead of it in the order: `update` and `sh`, which need the **payload** question answered. That
one is unchanged and is the operator's: the native binary embeds three modules and a JS-hosted `wac` is
built from `wacc.wac` alone, so `wac sh` has no shell to start. `Cli.load` does not settle it — a
loaded module has to come from somewhere, and "somewhere" is what the question is about.

## 2026-08-24: `wac test <file>` is in the program, on all three hosts

Twenty-one invocations now agree across the native binary, Deno and Node — `commandparity_test.wac`,
22s warm. The five new rows are `test`: the failing-report case, `--filter`, a filter matching nothing,
an unknown flag, and a missing file.

The whole of it is thirty lines, because `Cli.load` did the hard part (`issues/system/0240c`): the
module is already compiled by the lines above it, so wrap it in its manifest, load it, and call every
`test*` the manifest declares. **The names come from the manifest**, not from a scan of the source —
`native/v8`'s `test_exports_of` reads the file with `match_indices("export string test")` because it
runs *before* anything is built and has to decide what to build; here the module already describes
itself, so there is nothing to guess and no comment that can look like a declaration.

### Two bugs in the native host, both found by comparing

- **A trapping test left its exception pending on the isolate.** `run_tests` called the export with a
  bare `f.call` and no `TryCatch`, so V8's default handler printed `Uncaught RuntimeError: unreachable`
  on stderr — once per `test_traps_*`, and there are 389. The noise was the small half: a pending
  exception makes the *next* `compile` hit V8's own
  `Check failed: maybe_compiled.is_null() == i_isolate->has_exception()` and abort the process, which
  the module loop in the same file already documents. Nothing there compiled twice until `Cli.load`
  existed, so it had never bitten.
- **`--filter`'s value was read as a path.** `positionals` skipped `-o` and `--trace-slots` and not
  `--filter`, so `--filter passes src/x_test.wac` answered *cannot read passes* — a sentence about a
  file, about a pattern. That is `issues/system/0177`'s own mistake one level along, in the function
  that fixed it.

And one of mine the differential caught: a filter matching nothing has to be an **error**. `0 passed,
0 failed` reads like a suite that has quietly emptied, and the typo you made is invisible. The native
answers 5 and its caller turns that into 1 for a file somebody named.

### What is left on this step

- **The directory case**: walk for `*_test.wac`, build *one aggregate module* per directory —
  `issues/system/0192` is why one build rather than one per file — and print `N files: …` as well.
  This is the substantial half and it is not blocked by anything.
- **`--coverage`**: refuses explicitly rather than being ignored. `__cov_init`, `__cov_len` and
  `__cov_get` are `void f()`, `i32 f()` and `i32 f(i32)` — three of the four shapes `call` accepts, so
  this is work rather than a gap in the boundary.
- Then `update` and `sh`, which still wait on the **payload** question.

## 2026-08-24: `wac test <directory>` too, so only `--coverage` is left of `test`

Twenty-six invocations agree across the native binary, Deno and Node. The walk, the aggregate, and the
per-file report are in the wac program now: `testFilesIn` walks for `*_test.wac` sorted and skipping
dot-directories, `node_modules` and `target`; `aggregateSource` writes one module for the whole walk
(`issues/system/0192` — sixteen `packages/box` files were 40.9s as sixteen builds and 11.1s as one);
and the wrappers carry an `__f<n>` suffix on the *end*, so `test_traps_` still reads at the start.

### Five rules I would have got wrong by reasoning, and two the native had wrong

Mine, each found by comparing rather than thinking:

- a filter matching nothing is reported **per file**, and then **once for the walk** with a non-zero
  exit — `N files: 0 ok` under a filter reads like a suite that passed;
- `--ignore` emptying the walk says *"--ignore excluded all 4 test file(s)"*, not *"no tests under"* —
  the second sends a reader looking for a naming mistake that is not there;
- a file the filter emptied is not `ok`, and is counted as its own kind;
- a file that ran nothing prints **no tally** — `0 passed, 0 failed` under a line saying why is the
  same fact twice;
- the failing-file list is **column-aligned**, so no line can be printed until every name is known.

And two in `native/v8`, both of which only a second implementation could see:

- **a message naming a temp file**: *"every test in `.cache/wac-aggregate-74784-0_test.wac` wants a
  capability"* — a generated path the caller never typed and cannot open, in a sentence telling them
  what to do about their own file. `AsChild::shown_entry` names the file now.
- **the summary contradicting its own comment**: `run_tests` says "an oracle needs a host; a capability
  needs a flag on this command line, and a reader told 'needs an oracle' would go looking for the wrong
  thing" — and the summary then bucketed both under `needing a host oracle`, because both answer 4 and
  the caller sees only the code. `UNGRANTED_FILES` splits them.

### What is left

- **`--coverage`**, which refuses explicitly rather than being ignored. `__cov_init`, `__cov_len` and
  `__cov_get` are three of the four shapes `Cli.call` accepts, so it is work rather than a gap.
- **`update` and `sh`**, still waiting on the **payload** question: the native binary embeds three
  modules and a JavaScript-hosted `wac` is built from `wacc.wac` alone, so `wac sh` has no shell to
  start. `Cli.load` did not settle it — a loaded module still has to come from somewhere.

### One section of `test <directory>` cannot be written, and it is not `--coverage`

After the summary the native command ranks the files that cost a second or more:

    1 file(s) cost a second or more of CPU to run — the other 4 did not:
        1.1s cpu ( 1.1s here,  0.0s in children)   1.0s wall  src/nested/deep_test.wac

That is **CPU** time, split between this process and its children — `getrusage`, which the platform
does not offer a wac program: `Core` has a wall clock and no accounting. Wall time alone would be a
different number under the same name, which is worse than an absence, so the wac command omits the
section and says so where it would have written it.

It is a diagnostic aid rather than part of the result, and every case in `commandparity_test.wac` runs
under the one-second floor, so the two agree today. If it is ever wanted on the other hosts it is a
capability — `Core.cpuNanos()` or similar — rather than work in the command.

### And the caps that were in the first version of the walk

`testFilesIn`, `testsInSource` and `testExportsIn` each stopped at a fixed size and said nothing: 512
files, 512 tests per file, 1024 exports. For a *test runner* that is the worst shape a bug takes —
fewer tests run and everything reported as passing — and this repository has 386 test files, so
`wac test packages/` was inside the cap and not by much. `issues/lang/0158` is the same bug in
`gather`, and `wacc.wac` states the rule twelve lines from where the violation was written: "the cap is
reported, not skipped". They are `Vec`s now, which has no cap to report.

## 2026-08-25: both reasons the last three commands could not move are gone, and a narrower one is left

The section above says `covdump`, `tracestat` and `ctcompare` "cannot move at all today" and gives two
reasons. Neither holds now:

- *"There is no capability for 'instantiate this module and call that export', and adding one is a
  bigger decision than parity."* — that capability is `Cli.load`/`Cli.call`, added 2026-08-23
  (`issues/system/0240c`), which is what the section below this one records.
- *"the instrumentation injects it, so no source names it"* — `issues/system/0243c`, closed
  2026-08-24. `Cli.call` finds an export's signature in the manifest, and the manifest now lists
  `__cov_init`, `__cov_len` and `__cov_get` for a coverage build: the compiler declares what the
  compiler injected. `wac test --coverage` answers identically on all three hosts and
  `commandparity_test.wac` has the row.

**What actually blocks them is narrower, and was invisible while the two above were true.** All three
commands funnel through one function — `counters_of(path)` — which reads a module file and
instantiates it **with no imports**. None of them touches the manifest. And the modules they are
handed have none: `wac compile` and the trace instrumentation write a plain module, which is what
`issues/system/0221` was about. `Cli.load` refuses one, in as many words: *"this module carries no
wac.manifest section"*.

So one question decides all three:

- **`load` accepts a module with no manifest**, on the ground that a module declaring no capabilities
  should get no world and that is the correct world for it — which is exactly the argument the Rust
  makes for instantiating it with no imports. The catch is that `call` dispatches on the manifest, so
  a module without one has no callable surface and the counters are unreachable again. This answer
  needs a second one to go with it.
- **The producers write a manifest.** `wac compile` and the trace pass emit one, and `sigsWithCounters`
  already puts the counter exports in it, so all three commands move with no change to the capability
  at all. It is a change to what `wac compile` *writes*, which is a decision about the command rather
  than work, and `0221` is the history of why it does not.

The second is the one to want. Recorded rather than taken because it changes an artefact other things
read, and because this issue owns which subcommand lives where.
