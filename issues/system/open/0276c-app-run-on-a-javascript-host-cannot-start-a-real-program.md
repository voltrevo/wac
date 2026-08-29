# 0276 — `wac app-run` on a JavaScript host cannot start a real program

- **Status:** open — one of the two faults is fixed; the second is what remains
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** not implemented — a command that works natively and fails on the other hosts

## Reproduction

One artefact, two hosts. The native binary runs it; the JavaScript-hosted `wac` from
`bootstrap.sh --host deno` does not.

```
$ wac app packages/box/src/bin/sealedsh.wac -o /tmp/app

$ wac app-run /tmp/app -c 'seq 1 5 | /bin/wc -l'      # native
5

$ ./wac-deno app-run /tmp/app -c 'seq 1 5 | /bin/wc -l'
wac: at most 16 distinct fn[void(i32)] functions can be passed to this module
```

A *trivial* app — one `core.log` — runs on both. So this is about what the program needs, not about
`app-run` being absent.

## The first fault, fixed

`packages/platform/host/driver.ts` pushed **every** function into a callback slot without checking
whether it was already there, so a callback handed over on each call burned a slot each time. The
word in its own error message is *distinct*, and that was not true of what the code did.

Deduplicating by identity — `indexOf`, not equality, because two closures over one body are two
functions to the module and must stay two — fixes it. `packages/platform/test/` stays green (123
tests) and a `build.ts` deno-target shell still streams.

Worth noting that `host/layout.ts` already described this shape from the other end:

> the obvious way — build a new `Bridge` and new capabilities over it — dies at the *fifth* run with
> "at most 16 distinct fn[void(i32)] functions can be passed to this module": bindgen registers one
> wasm function per host function, sixteen live per signature, and each rebuild of `Core` and `Cli`
> burns another batch.

That note is about *rebuilding* capabilities, where the identities genuinely differ and
deduplication cannot help. This was the other case, and it failed on the **first** run.

## The second fault, fixed

With the slots fixed, the same command gets further and then:

```
$ ./wac-deno app-run /tmp/app -c 'seq 1 5 | /bin/wc -l'
wac: Cannot read properties of undefined (reading 'Failed')
```

`cls.Read.Failed` — `packages/platform/host/provider.ts:434` and two lines beside it. So `cls.Read`
is `undefined`: the host is building a capability whose *enum constructor the loaded module does not
export*.

It was simpler than that. `drive()` builds `classes` from `manifest.structs` and skipped any type
with neither a static `of` nor a `create` — which is every **enum**. `Read` is one, so `cls.Read` was
never set. The manifest had the variants all along, each with its own `make` export; nothing read
them.

Building a constructor per variant fixes it, and `wac app-run` on a JavaScript host now starts
`packages/box`'s shell: `echo hello` answers. 123 platform tests and 33 box tests stay green.

## The third fault, open

A *pipeline* still does not work, and the shape is different again:

```
$ ./wac-deno app-run /tmp/app -c 'echo hello'
hello
$ ./wac-deno app-run /tmp/app -c 'seq 1 5 | /bin/wc -l'
wacc: unknown command 'seq' — check, compile, build, bindgen, run, test…
```

That is the *host* answering, not the shell: a stage re-executed the JavaScript `wac` and handed it
`seq 1 5` as a command line, rather than re-entering the application.

**The cause is one field.** `spawnSelf` has no source argument — its whole point is that the host
already has this program, because it is what started it. `entry.ts` supplies that as
`selfSource: workerSource`, and `workerSource` is the *launcher's* worker bundle. That is right for
an ordinary built application, where the launcher and the program are the same thing.

Under `app-run` they are not. The launcher's program is the `wac` command; the program actually
running is a module loaded out of the file it was pointed at. So `selfSource` starts `wac`, with the
stage's argv, and `wac` says it does not have a command called `seq`.

The machinery for the right answer is already there and already passed in beside it: `moduleEntry` is
the generic entry for starting a *module* as a child, which is exactly what a loaded module's
`spawnSelf` needs — that entry plus the app's own bytes. So this is a matter of the world built for a
loaded module carrying its own `selfSource` rather than inheriting the launcher's, not of new
machinery.

The native host never meets this because its `spawnSelf` re-enters the program inside the binary.

## What it means for `design/system/0009`

Step 5 is done and this qualifies it rather than undoing it. A JavaScript-hosted `wac` **compiles,
checks, runs and tests** — it builds itself to a fixed point, and `packages/ts/test/wac/bootstrap_test.wac`
holds that for both Deno and Node. What it cannot do is `app-run` an application that needs more of
the platform than a trivial one.

That gap matters most for `issues/system/0275c`: the plan there is to compare the two hosts by
running one artefact under each, and this is why that comparison could not be made.

## Notes

Found while trying to isolate `0275c` — whether an unbounded producer into `head` hangs because of
the *host* or because of the artefact — by running the same app under both. The comparison failed for
a reason unrelated to the question, which is its own answer about how little the two hosts are
actually compared.
