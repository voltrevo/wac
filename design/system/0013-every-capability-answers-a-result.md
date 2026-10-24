# 0013 — every capability answers a result

- **Status:** shape agreed 2026-10-24 (each fault its own type, a capability's error a union of them; `Pending`
  goes in the same migration); three questions below still open
- **Raised by:** agent-a, 2026-10-22, implementing the operator's ruling on `issues/system/0330a`: *"Every
  capability answers a result, and 'this host does not provide it' is an error — a fault beside
  `FAULT_NOT_GRANTED`, never a trap. Capabilities with an ad-hoc absent answer (`LoadedModule.unavailable()`,
  `Cli.env`'s bare null) move to the same shape."* It also settles `issues/system/0261c`, and finishes
  `design/lang/0016`'s phase 2 (hosts hand out `Ticket`s; `Pending` is deleted).
- **Spans:** `std/platform.wac`, all four hosts (`native/v8`, `native` (wasmtime), `packages/platform/host`
  for Deno/Node and the browser), and every program that calls a capability

## What there is today

Fifty capabilities, `Cli` 42 and `Core` 8, the same set on every host, each answering std's `Pending<T>`. `Sys`
wraps some of them into core's `Ticket` through `Pending.ticket()`, which `std/platform.wac` calls "a bridge, and
a temporary one"; `Pending` is still named 97 times in `std/platform.wac` and in 109 files under `packages` and
`tools`. Failure is said three ways:

| group | capabilities | how failure is said |
|---|---|---|
| a struct with a `fault` | `readFile` (`FileResult`), the eight `Change`s, `stat`/`linkStat`, `connect`/`listen`/`accept`/`bindDatagram` (`Socket`), `exec` (`Exec`) | `fault` is one of seventeen `FAULT_*` integers |
| an ad-hoc absence | `env` (`u8[]?`), `readDir` (`string[]?`), `load` (`LoadedModule.unavailable()`), `spawn`/`spawnSelf` (`Child`, handle -2), `recv`/`readChunk` (`Read.Failed`) | a sentinel, each its own |
| a bare value | `argCount`, `arg`, `readStdin`, `write`, `writeErr`, `send`, `sendTo`, `outputError`, `exitCode`, `cwd`, `pushChild`, `nowMillis`, `monotonicNanos`, `sleepMillis`, `randomBytes`, `log`, `warn`, the `close*` and `unload` | none — a host without it throws |

And the fourth axis, which is the issue: a host that has not built a capability **traps** on every one but
`load`, `call`, `unload` and `validated`.

Call sites, counted 2026-10-22 (method-name matches, so inflated): `readFile` ~550, `writeFile` ~490, `exec`
~450, `arg` ~270, `cwd` ~250, `write` ~170, `readDir` 130, `argCount` 128, `send` 110, `recv` 96, `randomBytes`
85, `nowMillis` 81, `env` 71. Several thousand edits.

## The shape

### Each fault is a type

One struct per existing code, each carrying the host's own sentence:

```wac
export struct NotFound    { string message; }
export struct NotGranted  { string message; }
export struct Unsupported { string message; }
export struct Other       { string message; }
// … Denied, Exists, NotEmpty, NotRepresentable, IsDir, NotADir, ReadOnly, NameTooLong, Loop, NoSpace,
//   Refused, Unreachable, TimedOut — the seventeen FAULT_* codes less FAULT_NONE
```

**`Unsupported` is "this host does not provide it".** `FAULT_UNSUPPORTED` already means *the request never
reached a host* (wac-mono 0117), which is the ruling's fault; a second code would make programs tell apart two
things nobody could act on differently.

### A capability's error is the union of what it can raise

```wac
async Result<u8[],  union<NotGranted, NotFound, Denied, IsDir, NotADir, NameTooLong, Loop, Unsupported, Other>> readFile(string path)
async Result<u8[]?, union<NotGranted, Unsupported>>                                                            env(string name)   // Ok(null): not set (0261c)
async Result<i64,   union<Unsupported>>                                                                        nowMillis()
```

So the signature says what can go wrong, and a `match` must cover it (`§wac-union-match-type-rj837up`):

```wac
match (await sys.readFile(p)) {
  Ok(b):  use(b),
  Err(e): match (e) { NotFound: …, NotGranted: …, default: fail(e) },
}
```

and `try` widens a narrower union into the caller's wider one. Both were probed on 2026-10-24 and work today.

`Unsupported` is in every signature, since any host may lack any capability. `Other` is in every signature that
reaches an OS, for the error no category names — a host answering a code outside a capability's set is mapped to
`Other` with its sentence, never trapped.

### Hosts are unchanged at the boundary

A host still answers an `i32` code and a sentence. std turns the code into the struct, once per capability, in
the function that builds the capability's `Ticket`. The `FAULT_*` integers stop being exported once nothing
outside std reads them.

### `Ticket`, not `Pending`

`Core` and `Cli` answer core's `Ticket<Result<T, union<…>>>` directly; `Pending`, `Pending.ticket()` and
`waitAny`'s id plumbing behind it go. A host default arm stops throwing and answers
`Err(Unsupported("<name> is not provided by <host>"))`.

## Staging

Each capability moves **once** — its `Pending<X>` becomes `Ticket<Result<T, union<…>>>` and its callers follow in
the same commit — so no caller is edited twice.

1. **The fault types and the code-to-type mapping**, and hosts answer `FAULT_UNSUPPORTED` instead of trapping for
   the capabilities that already carry a fault. No program changes.
2. **`env`** (settles `0261c`), then the rest of `Core` (`nowMillis`, `monotonicNanos`, `sleepMillis`,
   `randomBytes`), which have the fewest callers.
3. **`Cli` by family**: process (`argCount`, `arg`, `cwd`, `readStdin`, `write`, `writeErr`, `exitCode`), files
   (`readFile`, the `Change`s, `stat`, `readDir`), modules (`load`/`call`/`unload`), children
   (`spawn`/`spawnSelf`, `recv`/`readChunk`), sockets.
4. **Delete** `Pending`, `FileResult`, `Change`, `Socket`'s fault fields and the exported `FAULT_*`.

Each stage is its own commit through the gate, with its breaking-change log entry.

## Open questions

1. **`write`/`writeErr`/`send` answer `false` for a closed peer**, which is not a fault but a fact `yes | head`
   is written to notice. `Ok(false)`, or a `Closed` fault?
2. **`log`/`warn`** are `void` and every host has them. Exempt, on the ground that a world with no way to say
   anything has nothing to report a fault through?
3. **Synchronous callers get two layers.** `Ticket.wait()` answers `Result<T, string>` (`Err` when nothing can
   settle the ticket), so `cli.readFile(p).wait()` becomes `Result<Result<u8[], union<…>>, string>`. Fold the
   ticket's own failure into the capability's union (as `Unsupported`, or a new `Stuck`), or keep the layers?
