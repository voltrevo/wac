# 0280 — `spawnSelf` from a grandchild fails on the native host, and the child exits 127

- **Status:** closed — fixed 2026-08-29
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** wrong answer — every service exits 127, and the system reports a clean shutdown

## Reproduction

One program, one image, one script. The difference is which builder made the artefact, which is to
say which host runs it.

```
$ wac app packages/box/src/bin/imaged.wac -o imaged --allow-read --allow-write
$ deno run -A -e 'buildApp("packages/box/src/bin/imaged.wac","imaged-deno",{read:true,write:true})'

$ ./imaged x.wacimg -c 'mkdir /etc; printf "%s" "echo hello\nseq 1 3\n" > /etc/init'
$ ./imaged-deno x.wacimg -c init
init: started echo
init: started seq
hello
init: echo exited 0
1
2
3
init: seq exited 0
init: all services have stopped

$ ./imaged x.wacimg -c init
init: started echo
init: started seq
init: echo exited 127
init: seq exited 127
init: all services have stopped
```

Expected: the services run.
Actual: each exits **127** — *a command it could not run* — and `init` then reports a clean
shutdown, because every service did stop.

## What is different about it

`init` starts a service with `spawnSelf`, which runs *this same program* with new arguments. Under
`wac app`, `runBytes` starts the application as a **child** of `wac app-run` — so `init`'s
`spawnSelf` is a **grandchild**, and that is the case that fails. A `build.ts` artefact is the
launcher's own program rather than a child of anything, so its services are children and work.

`packages/platform/host/deno.ts` names this exact hazard on the line beside `selfSource`:

> A grandchild is where this went missing first in the equivalent `selfSource` line's history: a
> capability the top of the tree has and nothing below it does is a capability that works until
> something nests.

That is the JavaScript hosts' version, fixed as `issues/system/0276c` on 2026-08-29. The native host
has the same gap, reached a different way.

## The cause, and it is one argument

`run_as` is the path **every spawned child** takes, and it drops the manifest on the floor:

    fn run_as(m: &Manifest, wasm: &[u8], as_child: AsChild) -> i32 {
        run_as_with(m, wasm, "", as_child)
    }

So a child's `HOST.manifest_text` is `""`. Its own `spawnSelf` then reaches this, in the spawn arm:

    let manifest: Manifest = match serde_json::from_str(&manifest_text) {
        Ok(m) => m,
        Err(_) => { out.finish(); err.finish();
                    let _ = worker.complete(exit_id, Answer::I32(127)); return; }
    };

An empty string is not JSON, so every grandchild is answered 127 before anything starts. The module
bytes were carried correctly — `s.wasm.clone()` — and only the text beside them was not.

There was one call site, `run_as(&manifest, &wasm, child)`, and `manifest_text` was captured by the
very closure containing it. It now calls `run_as_with(&manifest, &wasm, &manifest_text, child)`, which
left `run_as` with no callers — a two-line wrapper whose whole contribution was the `""`. It is gone,
and its note about a child getting its own isolate moved onto `run_as_with`.

    ./imaged x.wacimg -c init    before: started echo / echo exited 127 / all services have stopped
                                 after:  started echo / hello / echo exited 0 / 1 2 3 / …

`packages/box/test/init.test.ts` moves onto `wac app` with it — 7 of 7. 113 box and sh Deno tests,
19 box wac files and 38 platform wac files stay green.

**And the `Err(_)` is worth its own line.** The reason is discarded, so a grandchild that cannot start
says nothing at all — no diagnostic on stderr, just a status. That is what let this read as *the
service ran and failed* rather than *the service never started*, and it is why `init` then reported a
clean shutdown over a boot where nothing ran.

## Why the symptom is worse than the bug

`init`'s trigger for shutting down is *every service has stopped*, and a service that never started
has stopped. So the log ends with `init: all services have stopped` — the line that exists
specifically to distinguish a clean ending from a truncated one — over a boot where nothing ran. The
exit status is 0.

`packages/box/test/init.test.ts` catches it, and it catches it on the *statuses* rather than on the
shutdown line, which is the reason that test asserts each service's output and status in order
rather than only the ending.

## Notes

Found by migrating `packages/box/test/` from `build.ts` to `wac app` for `design/system/0009`, which
is the third and last of the three files that would not move. The other two are not bugs: one is a
`cwd` difference and one is Deno's second permission layer, both written up in the design note.

Fourth in a family found the same day, all of the shape *a capability implemented correctly on one
host and not another*: `0275c`, `0276c`, `0277c`, `0278c`. `issues/system/0279c` is about why the
instrument that should have caught them did not.
