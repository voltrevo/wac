# 0137 — `box` and `platform` can drop `pushChild`/`popChild` now that closures exist

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-16
- **Kind:** cleanup
- **Symptom:** no error

`packages/box/src/shrun.wac` explains why an applet cannot be handed a substitute world:

> An applet reads `cli.readChunk()` and writes `cli.write(...)`, which are the *process's* streams. In
> wac there are no closures, so it cannot be handed a substitute `Cli` — a fake capability would have
> nowhere to put what it collected. `platform`'s answer is `pushChild`/`popChild`: the host holds the
> child's world for the duration.

**The premise is no longer true.** `design/lang/0002` tier two landed on 2026-08-16: a lambda captures
by reference, so the place a fake capability puts what it collects is an ordinary local.

## What now works

`spec/cases/0193`, which is this issue's reproduction in miniature — a capability is a struct of
`fn[…]` fields, and a substitute is a value built from lambdas over a local:

```wac
i32 total = 0;
Sink fake = Sink((u8[] b) => { total = total + b.len(); return true; }, () => total);
return run(fake);      // 5 — `run` knows nothing about where its bytes went
```

`Cli` is exactly that shape already (`platform.wac:1095`): `argCount`, `arg`, `readChunk`, `write` and
the rest are all `fn[…]` fields.

## Why this is worth doing

The host holding the child's world is the part `shrun.wac` itself flags as unfaithful:

> The one thing that is *not* faithful is isolation. This is the same wasm instance with the same
> authority: an applet run here can open any file the shell could.

A substitute `Cli` does not fix isolation either — that needs `spawn` — but it removes a *host* round
trip from something that should be a value, and it takes the state out of `platform`'s globals and
puts it where the caller can see it.

## Why it is filed rather than done

It is `packages/box`, `packages/sh` and `packages/platform` together, and `pushChild`/`popChild` have
callers beyond `shrun`. That is somebody else's package and a real chunk of work, which is what this
directory is for.

**Also worth knowing before starting:** two of the three closure workarounds `design/lang/0002` names
turned out not to be closure problems at all. `packages/git`'s `completePack` says appending bases is
*"the better shape anyway, because the completed pack is a file git accepts rather than a value only
this library understands"* — converting it to a callback would be a regression. `packages/stream`'s
`passthrough` takes its `read` and `write` from the host, so there is nothing to capture. This one is
the real instance.
