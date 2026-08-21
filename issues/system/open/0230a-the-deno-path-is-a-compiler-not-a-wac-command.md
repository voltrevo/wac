# 0230a — the Deno path is a compiler, not a `wac` command

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
