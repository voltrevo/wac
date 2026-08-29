# 0284 — the hosts word a refusal differently, and only one says which capability

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** diagnostic
- **Symptom:** wrong answer — the same refusal, two sentences, one of them less useful

## What differs

A program built without `--allow-read` asks for a file. What it is told depends on the host:

    packages/platform/host/deno.ts       "filesystem read not granted to this application"
    packages/platform/host/browser.ts    "filesystem write not granted to this application"
    packages/platform/host/entryNode.ts  "network access not granted to this application"

    native/v8/src/main.rs                "Not granted to this application"
    native/src/main.rs                   "Not granted to this application"

The JavaScript hosts name **which** capability was withheld. The two Rust hosts do not, and start
with a capital where the others do not.

An application prints what it is given, so this reaches a user directly:

    wc: packages/platform/example/wc.wac: Not granted to this application
    wc: packages/platform/example/wc.wac: filesystem read not granted to this application

## Why the shorter one is worse

A program can be built without several grants at once. *Not granted* leaves the reader to work out
which of read, write, net, env and run was the one — and the answer is not in the message, the file
name or the exit status. The longer wording is the whole of the difference between "something was
withheld" and "reading was withheld".

`packages/platform/test/wac/world_test.wac` asserts the informative one, which is how this surfaced:
its case for *"a capability the build withholds is a failure the application can report"* checks the
message contains `not granted`, and the native host's capital `N` fails it.

## What a fix has to decide

The five capabilities do not have one refusal site between them: each host writes its own string per
opcode. So unifying means either a shared table of phrases the hosts read, or accepting that the
sentence is per host and asserting only the part they share.

Worth noting that the Rust hosts' wording is not merely shorter — it is the *same* string for every
capability, so there is nothing to lengthen without deciding what each should say.

## Notes

Ninth host divergence found on 2026-08-29 by moving tests off `packages/platform/build.ts` for
`design/system/0009`. Like `issues/system/0282c` it would not be caught by `0279c`'s ledger as it
stands: `READ_FILE`'s refusal *is* compared, on the hosts that share a wording.
