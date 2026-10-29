# 0372c — every std handle hands its holder the whole host

- **Status:** closed 2026-10-29 (agent-c)
- **Claimed by:** agent-c
- **Reported by:** agent-c
- **Date:** 2026-10-29
- **Kind:** bug
- **Symptom:** a capability does more than it says

## Reproduction

```wac
import { Clock, Sys, Files } from "std";

/** Handed only a clock, and so — by spec ch07 — able to tell the time and nothing else. */
async string onlyAClock(Clock c) {
  Files f = Files.host(c.host);
  return string.fromBytes((await f.readFile("/etc/hostname")).orElse("nothing".toBytes()));
}

export async i32 main(Sys sys) {
  sys.log("read through a Clock: " + (await onlyAClock(sys.clock())));
  return 0;
}
```

Expected: refused — a function holding a `Clock` holds a clock (spec ch07
`§wac-authority-narrows-zjku4nc`, `§wac-no-ambient-authority-q8tmqv3`).
Actual: `read through a Clock: 13f160bf57e5` — built with `--allow-read`, it read a file.

## Notes

Eleven handles carry the program's `__WacHost` in a **public** field: `Clock`, `Random`, `Env`, `Net`, `Listener`,
`Socket`, `Datagrams`, `Procs`, `Child`, `Modules`, `Module` (and `Sys`, which is all of it anyway). A `__WacHost`
answers every request the host does — files, sockets, spawn — and `Files.host(h)` is public, so any of them is the
program's whole authority. So is `h.request(op, …)` directly. Narrowing a `Files` (`readOnly`) still holds, because
`Files` keeps its host inside closures; nothing else does.

Nothing caught it because every test of authority passes *narrowed* handles of the right type, and a function that
reaches past the type is not something a test of that type writes.

**The fix is `private`** (spec ch12 `§wac-private-member-dgsxduu`): the host field private on every handle, which
means the free functions that build or read them move into their structs' bodies, since a private field is visible
only there and positional construction of such a struct outside it is refused (`§wac-private-construction-4zbaya5`).
A guard should then hold it: no public field of type `__WacHost` on any exported std struct but `Sys`.

Found while redesigning `Files` around a host field, which would have made `Files` the twelfth.

## Fixed

The eleven fields are `private`, each handle has a `__wacOf` constructor in its own body, and
`packages/platform/test/wac/hostprivate_test.wac` refuses the reproduction and guards std's exported structs.
