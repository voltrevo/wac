# 0184 — a run program's exit status cannot tell a trap from an answer of 1

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** missing feature
- **Symptom:** wrong answer

## What happens

`wac prog.wasm` exits **1** for three different facts:

1. the file did not compile, or could not be read — `spec/cli/wac.md`'s table
2. the program ran and `main` returned 1
3. the program ran and **trapped**

A caller reading only the status cannot tell them apart. The trap is announced on stderr —
`wac: /t/t.wac trapped` followed by the engine's own line — so the information exists; it is just not
in the status.

## Reproduction

Two modules, built with `emitFilesSelfDescribing` and run by the binary:

```wac
export i32 main() { i31ref r = 2147483647 as! i31ref; return r as i32; }   // traps
export i32 main() { return 1; }                                           // answers 1
```

```
$ wac .cache/rantrap.wasm
wac: /t/t.wac trapped
wasm://wasm/5792a0f2:428: Uncaught RuntimeError: unreachable
status=1

$ wac .cache/ranone.wasm
status=1
```

Expected: a status that distinguishes "it refused" from "it answered 1".
Actual: both are 1, and so is a program that never built.

## Why it matters here

`spec/cli/wac.md` already argues this case against itself. `[§wac-cli-status-8kz4rp6]` gives 3 rather
than 1 to a failing test **for exactly this reason**:

> a script needs to tell "did not compile" from "ran and did something wrong", and one code for both
> makes a red suite indistinguishable from a typo.

The same sentence applies one level down. It was written about `test` and the run path kept the
collision.

It is load-bearing for `issues/system/0161`: twenty-six of `packages/wacc`'s sixty-one TypeScript
tests instantiate the module they emitted and call an export, and the conversion route for them is
`packages/wacc/test/wac/artifacts_probe.wac`'s `runEmitted` — emit self-describing, write, run,
read the status. Every one of those tests that asserts a refusal has to read stderr for the word
`trapped` instead, which is a message rather than a contract and will break the day it is reworded.

## What the missing half costs, measured — and what it does not

There is no way to ask whether a module is well-formed without running it, so `WebAssembly.validate`
had to become a fork per module. `packages/wacc/test/wac/corpusemit_test.wac` compiles every file in
the repository and validates each one, and it came out at **193s against the TypeScript's recorded
51s**.

**The forks were not the cause, and this issue said they were.** Adding `wac validate <module…>` —
one isolate, a list of modules, one process per chunk — moved that test from 193s to **194s**. The
time was somewhere else entirely:

| what | cost |
|---|---|
| building a manifest per file (`emitFilesSelfDescribing` over `emitFiles`) | **~66s** |
| `namesFiles`, a further link per whole file | ~18s |
| a fork per module, which this issue blamed | ~13s |
| the emitting itself | ~95s |

Validating never needs a manifest, so dropping it took the test to **128s**. The rest is the emitter.

The command is still worth having and is still the right shape — it is one fork per chunk rather than
per module, and it gives `wasRejected` a contract instead of a message to match on. It is just not
where the time was, and the correction is the useful part of this section.

**The remaining gap is not understood.** 128s here against a recorded 51s for the same work under
Deno, on a box three agents share, comparing against a number measured elsewhere under unknown load.
That is not a like-for-like comparison and should not be quoted as one.

## And it is eight bits wide

The same channel, the same conversion, found the day after: `main`'s answer is truncated to a byte.

```
export i32 main() { return 300; }   ->  exits 44
export i32 main() { return 255; }   ->  exits 255
export i32 main() { return 256; }   ->  exits 0
```

That is POSIX rather than a bug in this repository, and it would be unremarkable except that **256
exits 0**, so a wrong answer reads as success. A test comparing a checksum through the status is
comparing `sum & 0xFF` and saying nothing about the rest.

There is no way around it from inside a program that has to stay compilable by **both** compilers:

- **stdout** needs `Cli.write`, which needs `packages/platform`, which the reference cannot parse at
  all — `Pending<T>.then` is a lambda and the reference has none. A driver used for a two-compiler
  differential therefore cannot print.
- **there is no output intrinsic.** `print` is not a builtin; the only way out of a wac program is a
  capability or the status.

So `packages/wacc/test/wac/bootstrapemit_test.wac` folds its answers into one checksum and reads it
**a byte at a time**, four runs per compiler. That works and is the wrong shape: the cost is linear
in the width of an answer, and a test wanting sixteen numbers back has to choose between sixteen
processes and a checksum that cannot say which number moved.

Both halves want the same fix — a channel from a run program that is not the exit status.

## Notes

Not the same as `0175`, which is about what a `test_traps_*` case can observe **within** `wac test`.
This is the `wac prog.wasm` path, where the program is a separate process and the status is the only
structured channel there is.

Two shapes that would fix it, and picking is the decision this is filed for:

- **a reserved status for a trap**, as 3 is reserved for a failing test. Cheap, and it costs one
  value out of the range a program can return — which is the same objection that was accepted for 3.
- **a status that says "the program's answer follows on stdout"**, leaving the range untouched.

Neither can be chosen without deciding what `main` returning that value should then do, which is why
this is an issue rather than a patch.
