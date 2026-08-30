# 0290b — a wac program cannot run a host binary in a chosen directory, and 24 call sites need to

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-30
- **Kind:** missing feature
- **Symptom:** not implemented

`Cli.execWith` is the only capability that runs a **host binary** — `/usr/bin/timeout`, `bash`, a
built `box` — and its parameters are:

    fn[Pending<Exec>(string, string[], u8[], string[], bool, bool)] execWith;
    //                path    args      stdin  env       clearEnv  inherit

There is no working directory. Every other way to start a child in this platform takes one:

| capability | takes a directory | can run a host binary |
|---|---|---|
| `spawn` | yes — `dir` | no. `prog` is a wasm module's **bytes** |
| `spawnSelf` | yes — `dir` | no. an applet of this program |
| `pushChild` | yes — a child's `cwd` scope | no. same wasm instance, in process |
| `execWith` | **no** | yes |

So the one that reaches the host is the one that cannot say where. And a program cannot set its own
either: `Cli.cwd` is deliberately read-only — *"there is no `chdir`, because a mutable working
directory is"* — and `pushChild`'s scope is explicitly argued for as the honest alternative, but it
governs an in-process wac child rather than a host process.

## Who needs it

**24 mentions of `cwd:` across 14 files** in `tools/` and `harness/`. Counted honestly, because the
raw number overstates it: one is prose inside a comment and one is `cwd: Deno.cwd()`, which is a
no-op. The remaining 22 are a scratch directory (`dir` in the corpus tools, `work` in `mutate` and
`mutate/profile`), the repository root (`ROOT` in `harness/buildApp.ts` and two `mutate` tests), or a
caller's value plumbed through `harness/bounded.ts`, `appRun.ts` and `appRunMany.ts` — four of which
are the parameter declarations of the corpus tools' own `run` helpers, so the directory is the thing
those tools are built around. The files:

    tools/corpusThrough.ts   tools/corpusRoutes.ts    tools/corpusBackings.ts
    tools/corpusHosts.ts     tools/corpusStderr.ts    tools/ignoredFlags.ts
    tools/mutate.ts          tools/mutate/profile.ts  tools/mutate/native.test.ts
    tools/mutate/nativeShare.test.ts
    harness/buildApp.ts      harness/appRun.ts        harness/appRunMany.ts  harness/bounded.ts

That is not a long tail. It is **all five `corpus:*` tools, `mutate`, and four of the harness files
that run programs** — which is most of steps 1, 4 and 5 of `issues/system/0289b`. The `ROOT` and
`Deno.cwd()` ones would port today; the scratch-directory ones are the block. Found by trying to
port `tools/corpusThrough.ts`, which makes a temp directory and runs every corpus script in it so the
scripts that write files do not write them into the checkout.

## Why the obvious workaround is wrong here, specifically

Wrap it in a shell: `sh -c 'cd DIR && exec CMD -c SCRIPT'`. That fails for the tool that found this,
because **the thing being measured is a shell and the payload is a shell script**. Every corpus script
would be re-quoted through an extra shell, and the corpus exists precisely to contain quotes,
backslashes, `$`, `;` and newlines. `Cli`'s own documentation makes the point one level up — *"`args`
are arguments, **not a shell line**. They are passed as an argument vector, so a value containing a
space, a quote or a semicolon arrives whole and is never re-split or interpreted"* — and a `cd`
wrapper gives that guarantee back.

It is also not free elsewhere: it puts a second process in every measurement, which `mutate` and
`harness/bounded.ts` time.

## This exact omission has been fixed once already, on the capability next door

`spawn` did not take a directory either. Its documentation records why it does now:

> `cwd` is where the child's relative paths resolve from, and what its own `cwd()` reports. Empty
> means "wherever the host already was", which is what a program with no opinion wants. A shell has
> an opinion: without this, `cd sub; prog f` looked in the wrong place, because a spawned program
> inherited the *host's* directory rather than the shell's. **`pushChild` took a directory from the
> start for exactly this reason and `spawn` did not.**

Three capabilities start a child; two of them have now been given a directory, each time after
something inherited the host's and looked in the wrong place. `execWith` is the third, and it is the
one that reaches outside wac entirely — so the failure it produces is not "looked in the wrong place"
but "cannot be written at all", because the caller has no `cd` to fall back on.

## What it probably is

One more parameter on `execWith`, empty meaning "this program's directory", matching `spawn`'s `dir`
exactly — same name, same meaning, same empty-is-inherit rule, so there is one concept rather than
two. That is a signature change on a capability, so it reaches every host: the two native ones,
Deno, Node and the browser. `packages/platform`'s `Cli.exec` convenience keeps its arity by passing
`""`.

The alternative — a `pushChild`-style scope around an `exec` — is worse: `pushChild` is documented as
*"not isolation"* and as a view for an in-process child, and giving it a second meaning for host
processes puts two mechanisms behind one name.

## What this does not block

`tools/wac/coverageall.wac` (ported 2026-08-30) spawns 37 drivers with no `cwd` and did not need one,
and neither did the freshness checks. So the gap is specific to tools that make a scratch directory
and run something in it, rather than to running host binaries at all.

## The obvious fix is blocked by `issues/lang/0291c` — 2026-08-30

"One more parameter on `execWith`" is what this said, and it cannot have one. `execWith` takes six
today, and `0291c` — filed the day before this — is that **a capability with a seventh parameter
silently drops the module's entry point**: a valid module, 1473 wasm exports, an empty `exports` list
in the manifest, and a `wac` built around it that answers every command including `--version` with
`exports no main`. It names the three widest capabilities in the tree as `spawn`, `execWith` and
`drawPixelsIn`, all at six, "so this boundary had never been crossed".

`issues/system/0282c` is already blocked on the same thing for the same reason, and carries the
workaround: **fold two flags into one `i32` and stay at six.**

That works here too, and arguably improves the signature rather than paying a tax to it. `execWith`'s
last two parameters are both booleans — `clearEnv` and `inherit` — and they are the two nobody can
read at a call site:

    cli.execWith(path, args, stdin, env, false, false)   // which false is which?

Folding them into one `i32` of named bits frees the slot and makes the call site say what it does:

    fn[Pending<Exec>(string, string[], u8[], string[], i32, string)] execWith;
    //                path    args      stdin  env       flags  cwd

    cli.execWith(path, args, stdin, env, CLEAR_ENV | INHERIT, dir)

So the shape of the fix changes but not its size, and it stops being blocked. What it costs is every
`execWith` call site — `Cli.exec` covers 342 of them by passing the defaults, so the ones that change
are the handful that pass `true` today.

**Do not do this before `0291c` is understood.** The workaround gets a seventh *value* through six
parameters, which is fine, but `0291c` explicitly records that it is not known whether seven is the
real boundary or something seven crosses — and a capability change that silently produces a compiler
with no entry point is discovered by `bootstrap.sh` refusing to install it, which is the only thing
between it and a broken tree.

### What the fold would cost, counted

- **35** `execWith` call sites in `packages/`, `tools/`, `harness/` and `native/`.
- **8** of them pass a `true` for `clearEnv` or `inherit` — the only ones with a decision in them.
  The other 27 are `false, false` and become the default flag value.
- **398** `.exec(…)` call sites are untouched: `Cli.exec` is the convenience that passes the
  defaults, and it keeps its arity by passing the new flags word and an empty `cwd`.

So the fold is 35 mechanical edits and 8 judgements, against 9 tasks unblocked. That is the size of
the commit rather than an argument against it — but it does mean the change lands in one piece across
five hosts, and `0291c` is the reason it cannot land as the smaller one.
