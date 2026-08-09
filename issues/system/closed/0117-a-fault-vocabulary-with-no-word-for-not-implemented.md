# 0117 — the fault vocabulary has no word for "not implemented", so it says "Permission denied"

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** diagnostic
- **Symptom:** wrong answer

## What

`Fs.chmod` and `Fs.chown` on a **host mount** are not implemented, and say so in those words:

```wac
case Host(cli): { return Change.of(FAULT_DENIED(), "chmod on a host mount is not implemented"); }
```

The message is true and the *fault* is not. `packages/sh`'s `chmod` builtin renders a `Change` through
`reasonOf`, which maps a fault to the words GNU uses for that category — so the user sees:

```
$ mkdir o; chmod 000 o; chmod 700 o
chmod: cannot access 'o': Permission denied
```

GNU succeeds here: `chmod` needs ownership, not read permission. So we report a failure that is not the
file's, in words that blame the file, for an operation we simply have not written. That is the bottom
rung of this repo's own ranking — approximate < error < "not implemented" — reached by a *category*
rather than by a message.

## Why the message does not save it

`Change` carries both, and `reasonOf` deliberately prefers the category: the words are GNU's so that a
comparison against the real tool passes, rather than a sentence somebody chose. That is right for every
fault that *is* what it says. It is exactly wrong for a fault standing in for a missing implementation.

## The shape of a fix

A `FAULT_UNSUPPORTED` (or `FAULT_NOT_IMPLEMENTED`) beside `FAULT_NOT_GRANTED`, which the same file
already distinguishes from `FAULT_DENIED` for the same kind of reason: *not granted* is about the build,
*denied* is about the file, and *unsupported* is about us. It needs a value in `platform.wac` and
`host/faults.ts`, a phrase in `faultWords`, and `reasonOf` to pass the message through for it — the
message is the only thing that can say *what* is unimplemented.

Then `chmod` on a host mount says "chmod on a host mount is not implemented" and a caller can tell it
from a file that refused.

## Where else it is

Anywhere a `Change` or a `Stat` reports `FAULT_DENIED` for something we have not written. `Fs.chown` on
a host mount is the sibling of the case above. Worth a sweep for `FAULT_DENIED` with a message
containing "not implemented" when the fix lands.

## Notes

Found by trying to add a `chmod 000 d; ls d` case to `packages/sh`'s corpus and discovering the shell
cannot set the mode up at all. The `ls` half of that — a directory that is there and cannot be listed
was printed as a *name* with status 0 — is fixed, with the case in
`packages/box/test/unnameable.test.ts` and bash as the oracle.


## Closed — 2026-08-08, agent-a

`FAULT_UNSUPPORTED` is the ninth category, in `platform.wac` and `host/faults.ts`. It has **no phrase**
in `faultWords`, and that is the mechanism rather than an omission: every caller already spells the
empty case as `words == "" ? message : words`, so the message prints — and only the message can say
*what* is unimplemented. A fixed phrase would say less than the sentence it replaced.

Why a category at all, if the message prints either way: a caller can **branch** on it, which is the
argument `FAULT_IS_DIR` won on. `FAULT_OTHER` means the host said something no category covers — a real
failure, out there. This one means the request never reached a host.

`Fs.chmod`, `Fs.chown` and `Fs.rename`-across-mounts use it, which is every place whose *message*
already said "not implemented" while its fault said something else. And `packages/sh`'s `chmod` no
longer wraps it in `cannot access '<path>'`: that frame is about the path, and this failure is not.

    before   chmod: cannot access 'o': Permission denied
    after    chmod: chmod on a host mount is not implemented

`packages/box/test/unnameable.test.ts` holds it, with bash as the canary — GNU succeeds at that `chmod`,
so the refusal is demonstrably ours rather than the directory's.
