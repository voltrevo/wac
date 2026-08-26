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

## 2026-08-26: which two hosts, per row — and it is never the same two, and never Node

This page says "two hosts of four". Counted, by reading what each backing test actually spawns:

| backing test | entries | hosts it compares |
|---|---|---|
| `native_hostfs_test.wac` | 17 | **wasmtime + deno** (plus GNU coreutils as a third oracle) |
| `native_shell_test.wac` | 7 | **v8 + deno** |
| `native_examples_test.wac` | 6 | **wasmtime + deno** |
| `setexecutable_test.wac` | 1 | **v8 + deno** |
| `datagram_test.wac` | 1 | **v8 + deno + wasmtime** |
| `EXEC_WITH` | 1 | **v8 + wasmtime** |
| `as CONNECT` / `as BIND_DATAGRAM` | 4 | whatever the entry they name compares |
| named gaps | 7 | — |

37 comparisons over 44 opcodes. The helpers are unambiguous about which binary is which:
`nativeHost` is `native/target/release/wacland`, `wacBinary` and `binaryPath` are
`native/v8/target/release/wac`, and `denoBatch`/`builtByDeno` are the Deno host.

**Three things that are worse than "two of four".**

1. **Node is in none of them.** Not one entry compares the Node host, which is why `LINK_STAT` and
   `SET_EXECUTABLE` read as covered while Node answered a zeroed `Stat` and *no mode bits to set*.
2. **The two are not the same two.** Seventeen rows omit `native/v8` — the binary everybody here
   actually runs — and seven omit `wacland`. So no host is in every row, and a reader who assumed
   "two hosts" meant a fixed pair would be wrong about which fact each row establishes.
3. **The summary line is honest and the entries are not.** It already prints *"two-host conformance"*,
   which is exactly right. `Cover.compared` is a bool, so an entry cannot say the same thing, and
   `where(...)` reads as *covered*.

## The fix should derive the hosts, not record them

My first plan was to widen `Cover` to carry a host list and fill in all 44 entries from the table
above. **That would rebuild the defect one layer up**: a hand-written host set is remembered coverage,
and this page exists because remembered coverage reads like an audit. The first entry to have its
backing test changed would be wrong, silently, exactly as `LINK_STAT` was.

So `Cover` should carry the **backing test's path as data** rather than inside prose, and the hosts
should be computed from that file — `nativeHost` present means wasmtime, `wacBinary`/`binaryPath`
means v8, `denoBatch`/`builtByDeno`/`--target deno` means Deno, `--target node` means Node. The
conformance test already reads files to extract opcodes and capability fields, so the machinery is
there.

Then the totals line can say something that cannot rot: *37 of 44 opcodes have a comparison; 0 of them
include Node; 17 exclude the v8 binary* — each number derived from the tests as they are today.

It also makes the entry that names a test which no longer spawns what it claims fail, rather than
quietly meaning less. That is the property this ledger was written to have and does not yet.

## 2026-08-26: derived, and the derive corrected me twice before it printed a number

`Cover` carries the backing test's **path** now, and `hostsOf` reads that file. `where(op, test, note)`,
`sameAs(op, other, note)` for the four entries that borrow another's test, `gap(op, note)`. Printed by
an ordinary run:

    conformance: 37 of 44 opcodes have a comparison; 7 are named gaps
                 0 include the Node host; 8 do not include the V8 binary

**The hand-written table in the section above is wrong, and that is the argument for this change.**
It says `native_hostfs_test.wac` compares wasmtime and Deno. Line 113 of that file spawns
`root(cli) + "/native/v8/target/release/wac"`. It drives *three* hosts, and I read it wrong forty
minutes before writing this. The count of rows omitting the V8 binary is 8, not the 17 I published.

**The floor test caught its own tool twice**, which is what it is for:

- First derive: 26 rows without V8, because the pattern list had three helper spellings and
  `native_test.wac` reaches the binary as a **literal path** with no helper. Its own note says *"run by
  both native binaries"*, so the entry contradicted the derive, loudly.
- The pattern list gained the literal path and `cli.exec("deno"`, and the number went 26 → 8.

A derive that under-reports silently is no better than a list that over-reports silently. What makes
this an instrument is `test_every_entry_names_a_file_that_says_which_hosts_it_drives`: an entry that
derives **no** host fails, and the ledger as a whole must derive at least three distinct hosts. Without
those, both wrong numbers above would have shipped looking fine.

`sameAs` is checked as well, which nothing did while it was the sentence `"as CONNECT"`: the opcode
borrowed has to exist and has to be a `where`.

### The Node figure means something narrower than it looks

`0 include the Node host` is true of the **entries**. It is not true of the repository: five tests
under `packages/platform/test/wac/` drive Node — `runtimes_test.wac`, `spawn_test.wac`,
`load_test.wac`, `node_net_test.wac`, `echod_test.wac` — and **no ledger entry names any of them.**

So the next step is not "write Node tests". It is: go through those five, and for each opcode they
exercise, either point the entry at them or add the entry. Some of the surface is very likely Node-
covered already and recorded as though it were not — which is the same failure as `LINK_STAT`, in the
opposite direction.

### The five, and what their headers claim — a work list, not a finding

Read from each file's header only, so this is where to *look* rather than what is true. Confirming any
row means reading the body, which is the same discipline that turned my hand-written host table into
a wrong one.

| test | header claims | opcodes it plausibly settles on Node |
|---|---|---|
| `runtimes_test.wac` | one application, two JavaScript runtimes, the same program built twice | the filesystem and stdio surface its program uses |
| `node_net_test.wac` | *"The Node host's sockets, against the Deno host's, with a real client attached"* | `CONNECT`, `LISTEN`, `ACCEPT`, `SEND`, `RECV` |
| `spawn_test.wac` | a child is a handle — `send`, `recv`, `closeFeed`, `exitCode`, `waitAny` | `SPAWN_SELF`, `CLOSE_FEED`, `EXIT_CODE` |
| `load_test.wac` | loading a module and calling its exports, `issues/system/0240c` | the `load`/`call` pair |
| `echod_test.wac` | a wac program echoing datagrams, foreign UDP peer | `BIND_DATAGRAM`, `SEND_TO`, `RECEIVE_FROM` |

`node_net_test.wac`'s header also explains why the ledger reads the way it does: *"`platform.test.ts`
builds the same program for both runtimes and compares them, which is the right shape — but the
program it uses is `wc`, so it covers the filesystem and stdio and nothing else."* The two-runtime
comparison has existed for a while and is narrow; the entries point at the wider native ones instead.

## 2026-08-26, step 3: Node was covered all along — 0 → 14

    conformance: 37 of 44 opcodes have a comparison; 7 are named gaps
                 14 include the Node host; 8 do not include the V8 binary

Verified by reading each test's body and following into the program it builds, not by its header:

| test | builds for | the program calls | opcodes |
|---|---|---|---|
| `runtimes_test.wac` | deno **and** node, `t.eqStr` on stdout *"byte for byte, the same answer from both runtimes"* | `wc.wac`, `roundtrip.wac`, `exec_probe.wac` | `READ_FILE` `WRITE_FILE` `STAT` `READ_DIR` `REMOVE` `RENAME` `ARG` `ARG_COUNT` `ENV` `READ_STDIN` `EXEC_WITH` |
| `node_net_test.wac` | deno **and** node | `greet.wac`: `listen`, `accept`, `send`, `closeSocket` | `LISTEN` `ACCEPT` `SEND` `CLOSE_SOCKET` |
| `echod_test.wac` | deno **and** node, foreign UDP peer | `echod.wac`: `bindDatagram`, `receiveFrom`, `sendTo` | `BIND_DATAGRAM` `RECEIVE_FROM` `SEND_TO` |

`CONNECT` and `RECV` deliberately stay: in `node_net_test.wac` those are the harness's own client
calls, not the program being compared.

### An opcode has two tests, so `Cover` holds two

`BIND_DATAGRAM` is `datagram_test.wac` — v8, wasmtime and Deno through the handler table — **and**
`echod_test.wac`, a real program on Deno and Node. Neither is the better test; they answer about
different hosts. A single field forces a choice between two true statements and understates whichever
loses. So `where2`/`sameAs2` carry a second test and the hosts are **unioned**, and a `sameAs` inherits
the borrowed entry's *full* set rather than its first file.

### The pattern list was wrong three times, and the third was invisible

Each failure under-reported silently, in the direction that looks like less coverage rather than a
broken tool:

1. `native_shell_test.wac` read as Deno-only — reaches the binary through `nativeBinaryPath`.
2. `native_test.wac` read as wasmtime-only — reaches it by literal path, with no helper at all.
3. **Every Node-driving test read as Deno-only** — they build through a helper taking the target as a
   *variable*, so `"--target", "node"` never appears in the source. `cli.exec("node"` is the marker.

The first two failed the floor loudly, because those entries derived a host set that contradicted
their own note. **The third did not**, and that is the lesson: a floor refusing *no hosts at all*
cannot see an entry that found one of two. It passed while reporting zero Node coverage across a
repository with three Node-comparing tests in it.

So the derive is now cross-checked against an independent scan — any backing test whose source spawns
a host must be credited with it. Different question, different signal, and the two must agree.

**And that check was itself wrong on the first try**, which the canary caught: it read only the `ref`
file, and every Node answer lives in `also`, so it stayed green while the number went back to zero.
Fixed to scan both, and re-canaried — removing the `cli.exec("node"` pattern now fails 12 entries by
name.
