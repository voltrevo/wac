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

| what | cost | now |
|---|---|---|
| building a manifest per file (`emitFilesSelfDescribing` over `emitFiles`) | **~66s** | gone — validating never reads one |
| `namesFiles`, a further link per whole file | ~18s | gone — the module's own export section is read instead |
| a fork per module, which this issue blamed | ~13s | one fork per chunk of 64 |
| the emitting itself | ~95s | unchanged |

193s → **114s**, and the export check got *more* independent on the way: it compared the source
against `namesFiles`, which answers from the link and is the emitter's account of what it emitted, so
a dropped function could be named on both sides. It reads the artefact now.

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

## The obvious fix is not available, and it is worth saying why — agent-a, 2026-08-20

"Give a trap its own exit code" is the first thing anyone will reach for, and there is no code to give
it. `spec/cli/wac.md`'s own words:

> `run`'s status is the program's own answer — `export i32 main()` returning 3 exits 3 — so these are
> what the toolchain says **before the program starts**.

So 1, 2 and 3 are pre-start codes, and once `main` runs the status belongs to it. `main` returns `i32`
and a process status is eight bits, so **the program's range is the whole of 0–255** — measured today by
accident: a `main` returning 511 exits 255, because the status is masked. There is no value a trap could
take that some program could not also answer, which makes this the sentinel-from-the-value's-own-range
problem rather than an unassigned-number problem.

That leaves the ways out looking different from "pick a code":

1. **Reserve one anyway** — say 134, as a real `SIGABRT` death would give — and document that a `main`
   returning it is indistinguishable from a trap. Cheap, and it makes the spec sentence above false in
   one case, which is the kind of exception that is remembered for a year and then forgotten.
2. **Die by signal instead of exiting.** A trap is a crash, and the process API already distinguishes a
   process that *exited with a code* from one that was *signalled* — `WIFEXITED` against `WIFSIGNALED`.
   That is a different field, not a reserved value, so it collides with nothing a program can return.
   Every caller that asks gets an unambiguous answer, and a caller that only reads `$?` sees `128+N` and
   is no worse off than today. This is what a real segfaulting process does and what tooling already
   understands.
3. **A machine-readable line rather than a status** — the run path already prints `wac: … trapped`, and
   the issue's objection is that a message is not a contract. It becomes one if the spec says so and a
   test pins it, which is cheaper than either of the above and keeps the status honest.

**(2) looks right to me**, because it is the only one that adds no exception to the sentence the spec
already commits to: the status stays the program's answer, and "it did not get to answer" is expressed by
not having exited at all. I have not implemented it — whether the host may signal itself is a question
about every host, not just this one, and `packages/platform`'s `Exec` would need a way to report it, which
is the same fourth-parameter conversation as `issues/system/0182`.

Recording it rather than doing it because the constraint above is the part that was missing: without it,
the first attempt is a reserved code, and the reason that is wrong is not obvious until you look up what
`main` may return.
## Option 2's missing half exists now, and building it found a bug — agent-a, 2026-08-24

The section above recommends **dying by signal** and says why it was not done: *"`packages/platform`'s
`Exec` would need a way to report it"*. It has one. `Exec.signalled()` is `status == -1`, and `-1` was
already what three of the four hosts wrote for a child that died by a signal — a safe sentinel because
a POSIX status is eight bits, so no child that *exited* can produce it. What was missing was that the
convention had a name, a docstring and a test; it was four `code ?? -1` expressions with four identical
comments and nothing comparing them.

**Comparing them found that one was wrong.** `packages/platform/test/wac/exec_probe.wac` now spawns
`/bin/sh -c 'kill -9 $$'` and `runtimes_test.wac` holds the two JavaScript hosts to the same answer:

| host | before | after |
|---|---|---|
| native (v8), native (wasmtime) | `-1` | `-1` |
| Node | `-1` | `-1` |
| **Deno** | **`137`** | `-1` |

Deno fills `code` in for a signalled child with the shell's `128 + signal`, so `?? -1` never fired and a
`SIGKILL` arrived as an ordinary exit 137 — indistinguishable from a program that returned 137. The
fallback was dead code, with a comment above it describing behaviour it did not have. `signal` is the
field that knows, so `statusOf` asks it.

That is worth recording beyond the fix: **the differential found it on its first run**, which is the
argument for the test rather than for the convention. The convention was right in three places and
written down in none.

What this does *not* settle is this issue's own question. A wasm trap inside `wac prog.wasm` is still
an exit of 1, and making it a signal is a change to the run path rather than to `Exec` — but the
caller's half is now able to see the answer, which was the stated blocker.

## One of the two build targets already reserves a code — agent-a, 2026-08-24

This issue's central argument is that there is no code to give a trap: *"once `main` runs the status
belongs to it … the program's range is the whole of 0–255 … There is no value a trap could take that
some program could not also answer."* That is sound, and it is worth knowing that **the Deno target
already picked one anyway**.

The same program, built both ways and run:

| | `wac app` (native) | `build.ts --target deno` |
|---|---:|---:|
| `main` traps | exit **1** | exit **70** |
| `main` returns 7 | exit 7 | exit 7 |
| `main` returns 0 | exit 0 | exit 0 |

So option 1 from the list above — *"reserve one anyway … and document that a `main` returning it is
indistinguishable from a trap"* — is not hypothetical. Half of the toolchain does it, undocumented, at
70; the other half returns 1 and collides with the ordinary failure this issue was filed about. A
caller cannot rely on either, and the two disagreeing is worse than either choice made on purpose.

That does not settle the decision, and it is not an argument for 70 — it is an argument that the
decision is already being made by default, in one host, and that whatever is chosen has to land in
both. Found while measuring `issues/system/0197`'s conversion; the *stdout* half of the same
comparison was a plain defect and is fixed.
