# 0292 — a method on a generic host-bound struct exports its binding twice

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** an invalid module, and a `wac` that cannot start

## Reproduction

Add any method to `Pending<T>` in `std/platform.wac` — this one is the smallest that has a body worth
having:

```wac
bool cancel(const this) {
  if (this.sched is null) { return false; }
  return this.sched!.off(this.id);
}
```

`wac check std/platform.wac` is silent. `./bootstrap.sh --no-install` reaches its fixed-point round
and the module is refused:

    WebAssembly.Module(): Duplicate export name '$bind$m_Pending__std_platform$i32_cancel'
      for function 3798 and function 3798 @+166628

**The same function index twice.** So the export is emitted twice for one function, rather than two
functions colliding on a name.

## What narrows it

Three builds, each a full `bootstrap.sh`:

| shape | result |
| --- | --- |
| `Pending<T>.cancel` — generic, host-bound | **duplicate export** |
| `Sched.off(i32)` — host-bound, not generic | fine |
| `Core.cancel(i32)` — host-bound, not generic | fine |
| `Box<T>.ask()` in an ordinary program — generic, not host-bound | fine |

So it is neither genericity alone nor being bound alone. `Box<T>` with a `const this` method compiles
and runs; `Core` and `Sched` take new methods without complaint. `Pending<T>` is the struct that is
both, and it is the one that breaks.

`$bind$` exports are the host-facing surface — `bindgen` emits one per method a host may call, and
the name carries the instantiation (`Pending__std_platform$i32`). The guess this points at is that the
walk which registers those emits once per instantiation *and* once for the declaration, or once per
reachable call site, and that nothing checks for a name it has already written. Not chased further
than the table above.

## Why it matters beyond the method that found it

`Pending<T>` is the type every capability answers with, and it currently has `wait`, `map`, `then`,
`linkedTo` and `on`. Adding a sixth is not an exotic thing to want — this was found adding `cancel`,
the counterpart of `then` for a caller that gives up, which `packages/tor/src/relayd.wac` needs to
drop a connection without leaving reads outstanding on its closed sockets.

The workaround is to put the method somewhere else: `Core.cancel(i32 id)` takes the ticket's `id`
rather than the ticket. It builds, and it is worse — a program that has a `Pending` in hand has to
reach into it for a field to ask the world to do something to it.

## Notes

Third of three found in two days by changing `std/platform.wac`, after `issues/lang/0290c` (a funcref
of the wrong type in a struct field is emitted rather than refused) and `issues/lang/0291c` (a
capability with seven parameters drops the module's entry point). All three share a shape: the
compiler is silent, the module is well-formed enough to reach the engine, and `bootstrap.sh` refusing
to install a compiler that cannot rebuild its own command is what catches them.
