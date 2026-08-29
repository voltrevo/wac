# 0291 — a capability with seven parameters silently drops the module's entry point

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** a valid module whose manifest lists no exports, and a `wac` that answers every command
  with `exports no main`

## Reproduction

Add one parameter to `spawn` in `std/platform.wac`, taking it from six to seven, and update the two
functions stored into that field (`noSpawn` in `packages/wac/src/grants.wac`, `fakeSpawn` in
`packages/sh/test/wac/probe.wac`) and the eleven call sites to match. Change nothing else — every
caller passes `false` for the new parameter and no host reads it.

    fn[Pending<Child>(u8[], u8[][], i32, string, bool, bool, bool)] spawn;

Then `./bootstrap.sh --no-install`:

    wacc built packages/wac/src/wac.wac: 1692480 bytes
    bootstrap: fixed point, round 1 of at most 4
    wac: packages/wac/src/wac.wac exports no `build`. It exports:

    bootstrap: the compiler it built cannot rebuild its own command — refusing to install it

No diagnostic. The module is **valid** and has 1473 wasm exports; what is missing is in the manifest:

    good     "exports": [ { "name": "main", "params": [ "Core", "Cli" ], "ret": "i32" } ]
    seven    "exports": []

So `main(Core, Cli)` was declined, and because `wac` carries its own command as a payload, the
binary built around it answers every invocation — `--version` included — with `exports no main`.

## That the parameter count is the cause was measured, not assumed

The change above began as a real feature (`issues/system/0282c`, giving `spawn` an `inheritOut`), so
the first run also altered `wac.wac`, `runprog.wac` and three hosts. To separate the two, every
behaviour change was reverted and **only the seventh parameter kept** — all callers passing `false`,
no host reading it. The build fails identically. Nothing else in that diff matters.

Six is the widest capability in the tree — `spawn`, `execWith`, `drawPixelsIn` — so this boundary had
never been crossed.

## What is not established

- Whether it is *seven* specifically or some other property that seven crosses. Only 6 (works) and
  7 (fails) have been run.
- Whether other capabilities behave the same, or something about `spawn` in particular. `spawn` was
  the one widened because a feature needed it.
- Where the decline happens. `emit.wac` has the machinery to name a declined export — *"an exported
  function the settling declined, named — or `""` when every export survived"* — and it printed
  nothing here, so either that path is not reached or the drop is elsewhere. The propagation rule is
  the suspicious part: *"a call to an unemittable function is itself unsupported, so removing one can
  remove its callers"*, which is exactly how a widened capability deep in the graph could take
  `main` with it.

## Why the silence is the defect

The module is well-formed and passes validation; it simply has no entry. Every check between the
compiler and the user therefore passes, and the first thing that notices is the *next* build, by
which time the compiler that produced it is installed and the failure names a file the reader did not
touch. `bootstrap.sh` refusing to install a compiler that cannot rebuild its own command is what
stopped this going further, and it is the only thing that did.

## Notes

Found while implementing `issues/system/0282c`, which is blocked on it: the fix there wants a seventh
parameter on `spawn`, and cannot have one. The workaround available to that issue is to fold two
flags into one `i32` and stay at six.

Filed alongside `issues/lang/0290c`, which is the *other* silent failure the same work turned up —
a funcref whose type does not match its struct field is emitted rather than refused. The two are
independent: 0290c was a mismatch between the field and the function stored in it, fixed by updating
the stubs; this one survives with every signature in agreement.

## It is not parameter count in general — it is capability fields

Added after filing, because the title as first written invites the wrong fix.

**87 ordinary functions in `packages/**/src` already take seven or more parameters**, the widest being
`emitFunctionOf` at **17**, in the compiler's own emitter. So wacc handles wide functions fine, and
nothing here is a general arity limit.

What is unusual about `spawn` is that it is a **`fn[…]` field of a capability struct** — a host call
rather than a wac function. Six was the widest of those (`spawn`, `execWith`, `drawPixelsIn`), and
the failure appears at seven.

So the search is the capability path: the glue that emits a host call, the bind types written into
the manifest's `"callbacks"`, or whatever `settleEmittable` consults about them. Ruled out on the way:

- `callbackSlots()` is 16, and is a count of *slots a host may hold callbacks in*, not an arity.
- There is no `params.len() > N` bound anywhere in `emit.wac`.

The mechanism by which `main` disappears is at least clear. `exportSigsOf` skips a function whose
`env.funcIndex[at]` is negative, and that index is set by the emit fixed point — whose rule is *"a
call to an unemittable function is itself unsupported, so removing one can remove its callers"*. So
something that calls the widened capability was declined, and the cascade reached `main(Core, Cli)`,
which is the module's only export.
