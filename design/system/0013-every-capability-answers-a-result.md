# 0013 — every capability answers a result

- **Status:** proposed — the shape and the staging want the operator's eye before the migration starts
- **Raised by:** agent-a, 2026-10-22, implementing the operator's ruling on `issues/system/0330a`: *"Every
  capability answers a result, and 'this host does not provide it' is an error — a fault beside
  `FAULT_NOT_GRANTED`, never a trap. Capabilities with an ad-hoc absent answer (`LoadedModule.unavailable()`,
  `Cli.env`'s bare null) move to the same shape."* It also settles `issues/system/0261c`.
- **Spans:** `std/platform.wac`, all four hosts (`native/v8`, `native` (wasmtime), `packages/platform/host`
  for Deno/Node and the browser), and every program that calls a capability

## What there is today

Fifty capabilities, `Cli` 42 and `Core` 8, the same set on every host. Their answers fall into three groups:

| group | capabilities | how failure is said |
|---|---|---|
| a struct with a `fault` | `readFile` (`FileResult`), the eight `Change`s, `stat`/`linkStat`, `connect`/`listen`/`accept`/`bindDatagram` (`Socket`), `exec` (`Exec`) | `fault` is one of `FAULT_*`, `FAULT_NOT_GRANTED` among them |
| an ad-hoc absence | `env` (`u8[]?`), `readDir` (`string[]?`), `load` (`LoadedModule.unavailable()`), `spawn`/`spawnSelf` (`Child`, handle -2), `recv`/`readChunk` (`Read.Failed`) | a sentinel, each its own |
| a bare value | `argCount`, `arg`, `readStdin`, `write`, `writeErr`, `send`, `sendTo`, `outputError`, `exitCode`, `cwd`, `pushChild`, `nowMillis`, `monotonicNanos`, `sleepMillis`, `randomBytes`, `log`, `warn`, the `close*` and `unload` | none — a host without it throws |

And the fourth axis, which is the issue: a host that has not built a capability **traps** on every one but
`load`, `call`, `unload` and `validated`.

Call sites, counted 2026-10-22 over `packages`, `tools`, `std`, `site` and `spec` (method-name matches, so the
common names are inflated by other types' methods): `readFile` ~550, `writeFile` ~490, `exec` ~450, `arg` ~270,
`cwd` ~250, `write` ~170, `readDir` 130, `argCount` 128, `send` 110, `recv` 96, `randomBytes` 85, `nowMillis` 81,
`env` 71. A change of shape is several thousand edits.

## The proposal

### One error type

```wac
export struct Fault {
  i32 code;        // FAULT_NOT_GRANTED, FAULT_UNAVAILABLE (new), FAULT_NOT_FOUND, …, FAULT_OTHER
  string message;  // the host's own sentence
}
```

A struct rather than an enum because the codes already exist, are compared by programs (`f.fault ==
FAULT_NOT_GRANTED`), and cross the boundary as an `i32`; an enum would add a mapping on every host for no new
information. `FAULT_UNAVAILABLE` is the new code: *this host does not provide the capability* — distinct from not
granted (a grant could change it) and from failed (it was tried).

### Every capability answers `Result<T, Fault>`

`Pending<Result<u8[], Fault>> readFile(string)`, `Pending<Result<u8[]?, Fault>> env(string)` (Ok(null) for not
set — `0261c`), `Pending<Result<i32, Fault>> argCount()`, `Result<bool, Fault> write(u8[])` and so on. The fault
structs collapse into it: `FileResult` is `Result<u8[], Fault>`, `Change` is `Result<void-ish, Fault>` (see
open question 1), `Socket` keeps its fields as the `Ok` payload. `LoadedModule.unavailable()` becomes
`Err(FAULT_UNAVAILABLE)`, and `Child`'s handle −2 the same.

A host's default arm stops throwing: it answers `Err(Fault(FAULT_UNAVAILABLE, "<name> is not provided by
<host>"))`, which every capability can now carry. D6's *"it says so in those words"* survives as the message.

### What a caller writes

```wac
Result<i32, Fault> count(Cli cli, string p) {
  u8[] bytes = try cli.readFile(p).wait();     // an Err returns from count
  …
}

i32 main(Sys sys) {
  u8[] b = sys.cli.readFile(p).wait().orElse(u8[]());   // or match, or unwrap()
}
```

`try` already exists and is the point of the shape: a program that wants to pass a fault on writes four
letters. Most of the several thousand sites are tests and tools that today ignore `fault` — they become
`.unwrap()` (a trap with the message, which is what they effectively assume now) or `try`.

## Staging

1. **`FAULT_UNAVAILABLE` and no more traps, for the first group.** Hosts answer the fault instead of throwing for
   every capability whose answer already carries one. No program changes. Small, and it is most of the
   ruling's spirit on its own.
2. **The ad-hoc absences**, one at a time, each with its callers: `env` first (it settles `0261c`), then
   `load`/`call`, `spawn`/`spawnSelf`, `readDir`, `recv`/`readChunk`.
3. **The bare values**, `Core` before `Cli` because there are fewer callers and `nowMillis`/`randomBytes` are
   the ones a sandboxed host is most likely to lack.
4. **The fault structs collapse into `Result`** last, since by then every caller is already reading a result
   and this is a type rename with a field map.

Each stage is its own commit, through the gate, with the breaking-change log entry. Stage 1 needs no decision
beyond this note; stages 2–4 change what programs write.

## Open questions

1. **`Change`**: `Result<void, Fault>` needs `void` as a type argument, which wac does not have. `Result<bool,
   Fault>` with an always-`true` Ok, or keep `Change` as the one fault struct with a `.result()`?
2. **`write`/`writeErr`/`send` answer `false` for a closed peer**, which is not a fault but a fact `yes | head`
   is written to notice. Keep it as the `Ok` payload (`Result<bool, Fault>`), so a closed pipe and an
   unavailable capability stay distinct?
3. **`log`/`warn`** are `void` and every host has them. Exempt, on the ground that a world with no way to say
   anything has nothing to report a fault through?
