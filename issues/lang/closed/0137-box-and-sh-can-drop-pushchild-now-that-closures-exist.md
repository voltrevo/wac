# 0137 — `box` and `platform` can drop `pushChild`/`popChild` now that closures exist

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
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

## Unblocked and verified against the real type — agent-c, 2026-08-16

When this was filed, the premise was proved only in miniature: `spec/cases/0193` builds a capability
from lambdas, but its operations return plain values. A real capability answers through
`Pending.of`, and that is a **generic static** — which a lambda could not be passed to at all
(`issues/lang/0141`). So the refactor was blocked on something this issue did not mention.

`0141` is closed, and the real shape now works:

```wac
import { Pending } from "../../packages/platform/src/platform.wac";

struct Fake {
  fn[bool(u8[])] write;
  fn[Pending<i32>()] count;
}

export i32 f() {
  i32 total = 0;
  Fake fake = Fake(
    (u8[] b) => { total = total + b.len(); return true; },
    () => Pending.of(total, (i32 id) => id, (i32 id) => true, (i32 id) => { })
  );
  return drive(fake) * 14;   // 42
}
```

Three bytes written, collected into a local the capability's own operations capture, read back through
a `Pending<i32>` built by a generic static. That is every mechanism the refactor needs, against the
real `Pending` rather than a stand-in.

**What remains is the refactor itself**, which is unchanged in shape: `Cli` is 35 `fn[…]` fields, so a
substitute is 35 lambdas, and `pushChild`/`popChild` have callers beyond `shrun`. Still `packages/box`,
`packages/sh` and `packages/platform` together — a real chunk of work, and now one nothing in the
language is stopping.

## Closed: the substitute exists and `box` uses it — 2026-08-17, agent-c

`packages/platform/src/frame.wac`: a `Frame` holds what a child collects, and `childCli`/`childCore`
are capabilities built over it. Thirty-five fields, of which seven are substituted and the rest are
the parent's own capability passed on as a value — tier one, which is why this is a struct literal
rather than thirty-five wrappers.

Both wac-side callers are converted, and no `pushChild`/`popChild` call remains in any package source:

- `packages/box/src/shrun.wac` — `boxRun`, which is every `box` applet run as a shell command;
- `packages/box/src/applets/wget.wac`, which used the same push/pop to collect a body into memory.

**The oracle is a differential against the host frame.** `example/insideValue.wac` is
`example/inside.wac` with the world as a value — the child function copied across unchanged, because
a child that had to be adapted would prove nothing — and `test/wac/frame_test.wac` requires the two
programs' output to be identical byte for byte. Canaried: making `childCore.log` write through
instead of capturing fails it, with the child's line appearing on the parent's stdout, which is
exactly the mistake the host frame's own comments say its first version made.

### What is deliberately not done

**`pushChild`/`popChild` are still in `platform`**, so the title's "can drop" is a *may*, not a
*did*. Two reasons, both worth stating rather than leaving as an unfinished job:

- `example/inside.wac` and `test/wac/inside_test.wac` are the other half of the differential. Removing the
  capability deletes the only independent implementation this work is checked against.
- `issues/system/0166` is open against both implementations: a child inside a frame is told its
  `openOutput` redirection worked and it is silently ignored. `childCli` reproduces that on purpose so
  the two agree. Deciding it is a prerequisite for removing either one, and doing it in one
  implementation only would leave the differential enforcing the bug.

### What it cost, and what it found

Three defects in tier-two capture, all in code I had shipped the day before, none reachable by any
test written over an `i32`: the cell's name for an array type parsed as a type, and both the lvalue
path and the lvalue *type* path ignored cells. Half the shapes trapped; the other half answered the
old value and reported success. Fixed in `2065db3b`, with `spec/cases/0194`.

That is the argument for building the consumer: the feature had fourteen tests and a corpus case, and
the first real use of it broke in three places within twenty lines.
