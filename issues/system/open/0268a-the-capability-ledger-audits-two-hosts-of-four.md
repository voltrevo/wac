# 0268a — the capability ledger audits two hosts of four

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-26
- **Kind:** missing feature
- **Symptom:** wrong answer — two Node capabilities were broken and every instrument said covered

## What happened

Building a `wac app` on the Node-hosted command, by hand, outside this repository:

    node wac app src/main.wac -o thing
    wac: cannot make thing executable — this filesystem has no mode bits to set

and a two-line probe calling `Cli.linkStat` on a file that is there:

    deno host   isFile=yes size>0=yes
    node host   isFile=no  size>0=no

Both were `packages/platform/build.ts`: the Node launcher injected an fs object short of `lstat` and
`chmod`, which `runLauncherNode` declares as **required** — an `as unknown as` cast is what let it
compile. Fixed the same day. The Deno target has neither bug, because it reaches `Deno.*` directly and
injects nothing, so this was never a difference between what the hosts *are*.

**The defect is not the point. The point is that nothing would ever have told us.**

## Both capabilities are marked covered

`packages/platform/test/wac/conformance_test.wac` is the ledger of which capability opcodes have a
two-host comparison. `LINK_STAT` and `SET_EXECUTABLE` are both `where` — covered — and not `gap`:

    where("LINK_STAT",
      "native_hostfs: `test -h` over a real symlink and a real dangling one, against GNU on both
      hosts, with `test -e` beside each …")

    where("SET_EXECUTABLE",
      "setexecutable: a program built for both hosts, run on a file whose starting mode the test pins
      with `chmod`, and the resulting mode compared … **This entry was a gap and the gap was real.**")

`SET_EXECUTABLE`'s note even names the host that was wrong: *"where Deno, **Node** and the wasmtime
host all do `mode | ((mode & 0o444) >> 2)`"*. Node is named in the prose and is not in the comparison.
`packages/platform/test/wac/setexecutable_test.wac:36` says which two hosts there are — *"Build for the
**Deno** host, as `runtimes_test.wac` does"* — against the native binary. Two.

There are four: `native/v8`, `wacland` (wasmtime), Deno and Node.

## This is the ledger's own argument, turned on the ledger

Its header makes the case better than this issue can:

> An unaccounted-for surface is the failure this repository keeps finding in its own measurements: a
> suite that covers twelve of thirty-eight and reports twelve passes reads exactly like one that
> covers everything.

and, about its own first draft:

> The table was filled in from memory of tests one agent had written, and then each claim checked
> against the file it named. … `LINK_STAT` was an embellishment. **A ledger of remembered coverage is
> worse than none, because it reads like an audit.**

`LINK_STAT` was an embellishment a second time, in a second way. The first was "a test that calls
`stat` is not a test of `linkStat`". This one is "a test on two hosts is not a test on four", and the
entry says *two-host* in as many words — so the ledger is not lying, it is answering a narrower
question than its readers ask. **`compared: true` means "two hosts agree", and is read as "the hosts
agree".**

## The command differential does cover Node, and could not have caught these

`packages/wacc/test/wac/commandparity_test.wac` runs 41 invocations across all three hosted forms and
its comment is explicit: *"Node is the third host and not an afterthought."* True, and it did not help,
for two reasons worth separating:

1. **It compares command output, not capability behaviour.** A zeroed `Stat` is a wrong answer inside a
   program, not a different stdout from `wac`.
2. **Its rows stop short of the newest commands.** The table has `check`, `bindgen`, `run`, `test`,
   `<prog>.wasm`, `tracestat`, `covdump`, `ctcompare` — and **no `app`, `app-run`, `sh`, `update`,
   `validate` or `uninstall` row.** `app` is the one that calls `setExecutable`, and it became the
   program's on 2026-08-26 (`issues/system/0257c`), so the command that would have exposed the bug
   arrived after the table stopped growing.

So the two instruments have complementary holes: one asks four commands of three hosts, the other asks
many capabilities of two hosts, and `wac app` on Node was in neither.

## What to do

**1. Make the ledger say how many hosts.** `Cover.compared` is a bool answering "is there a
comparison"; it should say *which hosts*, so a row reading `native+deno` is visibly not `all four`. The
totals line then reports something that cannot be misread — `37 of 44 compared, 6 of those on all four
hosts` is an honest sentence and `37/44` is not. This is the cheap half and it makes the rest
self-directing, which is the ledger's stated reason to exist.

**2. Add parity rows for the commands that arrived since the table was written** — `app`, `app-run`,
`sh`, `update`, `validate`, `uninstall`. `app` first: it is the one with a capability behind it, and
the round trip is `wac app` then run the artefact, which is a byte comparison plus one line of output.
Note that this would *not* have caught `linkStat`; only the ledger reaches that.

**3. Then the four-host question for the fs capabilities.** `setexecutable_test.wac` already builds a
probe for a target; a third and fourth target is an argument to `build.ts` and a row in the assertion.
Whether `wacland` belongs in every row is a real question — it has no compiler and a different world —
and answering it per capability is the work.

## Why this is filed rather than fixed

The fix to the *defect* is pushed. The fix to the *instrument* is a change to what
`conformance_test.wac` reports, and that file is the audit several other things are read against —
`0161` moved it host-side, and its totals appear in prose. Changing what `compared` means changes a
number that is quoted elsewhere, which is the shape that wants agreement before the edit rather than
after. See `[[spec-changes-have-tests-that-read-the-spec]]`-style breakage: the count is checked
against the directory by a test a whole suite away.

**Related:** `issues/system/0230a` (the hosted command, and where this was found),
`issues/system/0257c` (the commands that moved into the program), `issues/system/0161` (the ledger's
move host-side).
