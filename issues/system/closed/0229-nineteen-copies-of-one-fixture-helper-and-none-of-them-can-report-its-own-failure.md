# 0229 — nineteen copies of one fixture helper, and none of them can report its own failure

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21
- **Fixed in:** `packages/wactest/src/host.wac` — `freshDir` and `madeDir` — with 21 test files rewritten
  onto them and the `scratch` collision resolved by renaming the directory-making one
- **Reported by:** agent-b
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** no error — the fixture fails and the tests report the consequence

## Measured

Twenty functions named `scratch` across `packages/`. **Nineteen are the same four lines**, differing
only in a path prefix:

```wac
string scratch(Cli cli, string name) {
  string dir = root(cli) + "/.cache/<prefix>-" + name;
  cli.remove(dir, true).wait();
  cli.mkdir(dir, true).wait();
  return dir;
}
```

`mkdir` and `remove` each answer a `Change` carrying a fault and the host's own words. **Every one of
the nineteen throws both away.**

| file | prefix |
|---|---|
| `packages/http/test/wac/interop_test.wac` | `.cache/httpinterop-` |
| `packages/platform/test/wac/echod_test.wac` | `.cache/echod` |
| `packages/platform/test/wac/inside_test.wac` | `.cache/inside-` |
| `packages/platform/test/wac/native_test.wac` | `.cache/native-` |
| `packages/platform/test/wac/node_net_test.wac` | `.cache/nodenet-` |
| `packages/platform/test/wac/optimize_test.wac` | `.cache/optimize-` |
| `packages/platform/test/wac/pipeline_test.wac` | `.cache/pipeline-` |
| `packages/platform/test/wac/runtimes_test.wac` | `.cache/runtimes-` |
| `packages/platform/test/wac/spawn_test.wac` | `.cache/spawn-` |
| `packages/platform/test/wac/v8host_test.wac` | `.cache/v8host-` |
| `packages/platform/test/wac/world_test.wac` | `.cache/world-` |
| `packages/ssh/test/wac/fixture.wac` | `.cache/` |
| `packages/tls/test/wac/client_test.wac` | `.cache/tls/` |
| `packages/tor/test/wac/ctor_live_test.wac` | `.cache/ctor-` |
| `packages/tor/test/wac/network_test.wac` | `.cache/network` |
| `packages/tor/test/wac/network_tor_test.wac` | `.cache/tornet-` |
| `packages/wacc/test/wac/bindgenwac_test.wac` | `.cache/bindgenwac-` |
| `packages/wacc/test/wac/program_test.wac` | `.cache/` |

The twentieth is `packages/platform/test/wac/native_shell_test.wac`, fixed on 2026-08-20 and the
reason this was counted.

## What it costs

`native_shell_test.wac` failed a gate with **sixteen** failures, every one of them

    native echo [$HOME] [$PATH] [$USER]: /bin/sh: 1: cd: can't cd to
      …/.cache/hostshell-seal

Sixteen shells blaming themselves for a directory the fixture never created. A `mkdir` that fails
leaves every script in the test running with a cwd that does not exist, so what reaches the screen is
the *consequence*, repeated once per case, with no mention of the directory. It passed on its own
afterwards and the cause was never established — which is the second cost: nothing in the output points
at the fixture, so the diagnosis starts from the wrong end.

Eighteen files can still do this today.

## There is also a name collision worth resolving with it

`packages/wactest/src/host.wac` exports a *different* function called `scratch`:

```wac
export string scratch(Cli cli, string name) {   // only computes a path
  string who = agentDir(cli);
  return "/tmp/wac-" + name + (who == "" ? "" : "-" + who);
}
```

It computes `/tmp/wac-<name>-<agent>` and creates nothing. Ten-plus files import it. So `scratch` means
"a path" in one place and "a fresh directory, made now" in nineteen others, and a reader moving between
them has no way to tell which they are looking at.

## The decision in it, which is why this is filed rather than done

The path each test wants is legitimately its own — `.cache/world-`, `.cache/tls/`, `/tmp/wac-`. What is
identical nineteen times is *make it fresh, and say so if you cannot*. So the shared thing is that, not
the path:

```wac
/** Empty `dir`, creating it, and say which host call refused and in whose words. */
string freshDir(Cli cli, string dir) { … }   // "" when it worked
```

**The open question is how the reason reaches the reader.** `core.warn` needs a `Core`, and nineteen
local helpers take only a `Cli` — their callers almost all have a `Core` in scope, so threading it is
mechanical but touches every call site rather than nineteen functions. The alternatives are a returned
reason each caller must check, or a trap, which loses the message and is the thing being fixed. Whoever
takes this should pick one and apply it everywhere; a mixture is worse than either.

`remove` is allowed to fail for exactly one reason — the directory not being there, which is the
ordinary first run and is what `Change.absent()` asks. That distinction is already written out in
`native_shell_test.wac` and is the model.

## Why filed and not swept

`issues/system/README.md`: "A package someone else is working in: file it." This reaches into `tor`,
`ssh`, `tls`, `wacc`, `http` and `platform`, and three agents were committing to those tonight. Nineteen
files half-converted is worse than nineteen unconverted, so it wants one pass by whoever can do it
uninterrupted.

## Closed — `freshDir` and `madeDir`, and the name collision is gone, 2026-08-21

**The reason is returned, and that answers the open question.** `core.warn` needs a `Core` the nineteen
helpers do not take; a `trap` takes the rest of the file's cases down and loses the message, which is the
thing being fixed. A returned reason becomes one `t.isTrue` in the caller, which has a `T` — so the
fixture's failure is a *named test failure*, in front of the consequences rather than absent from them.

Canaried by making `freshDir` fail unconditionally and running `pipeline_test`:

    FAIL test_stdin_through_two_children_and_out_again — 3 failed:
      CANARY could not create …/.cache/pipeline-pipe — no such device: expected true;
      pipe.wac built — error: Uncaught NotFound: No such file or directory …

The fixture is the first line. Before, that program produced only the second kind, once per case.

**The collision is resolved by renaming, which turned out to be the load-bearing part.** `scratch` meant
"a path" in `wactest/src/host.wac` and "a fresh directory, made now" in nineteen files, and **thirty files
call one or the other** — so a mechanical rewrite of `scratch(cli, …)` would have hit both. The
directory-making one is `freshScratch(T t, Cli cli, string name)` now; the path-only one keeps the name
and its ten-plus importers are untouched. 67 call sites across 21 files, including five in `packages/ssh`
that import the helper rather than declare it — those are not in the table above, and a sweep driven by
the table alone would have broken them.

### Two of them must not be emptied, which is why there are two functions

`echod_test`'s build directory and `network_test`'s `shared` are created and deliberately *not* cleared —
the second has a comment saying the first case builds and "the other twelve reuse". Both were listed
above and neither had the four-line shape; both `mkdir` at the point of use. Putting them on `freshDir`
would have wiped a build cache on every case, turning twelve reuses into twelve rebuilds — silently, and
looking like a slow test rather than a wrong one. So `madeDir` creates and keeps, `freshDir` empties
first, and the destructive one has to be asked for by name.

`startPeer` in `echod_test` has no `T` and returns a `Peer`, so its fixture reason goes **in front of the
daemon's error** rather than returning early with a `Daemon` the function would have to invent — a `start`
into a directory that is not there fails anyway, and what was missing was any mention of the directory.

### What is left, named rather than implied

**144 bare `cli.mkdir(…).wait();` calls remain** across `packages/` and `tools/`, in probes, tools and
tests that were never part of the nineteen. Each throws the same answer away. That is a much larger sweep
than this issue scoped and it is now a one-line change per site, since the helpers exist — worth doing
incrementally rather than filed as one job, and worth knowing the number.

### Swept since, and what is left — agent-a, 2026-08-21

Two batches, both the `remove`-then-`mkdir` shape, which is `freshDir`'s:

    122 sites converted  21 in tools/wac tests, 22 across 17 package tests, 77 bare in 37 more,
                         then the two `writeTree` fixtures by hand
    27 remain            on their own line, in helpers with no `T` at the site

### The count, wrong twice, and the second time was mine correcting the first

The original **144** came from `^\s*cli\.mkdir\(…\)\.wait\(\);\s*$` — a site on a *line of its
own* — so it could not see the 73 written inline. I corrected the residue to ~101 on that basis.

**That correction was worse than the number it replaced.** Sampling the 73 shows they are overwhelmingly
*correct code*: `return cli.mkdir(dir, true).wait().ok();` checks the answer, so does
`if (!cli.mkdir(…).ok()) { return false; }`, `Change made = cli.mkdir(…)` captures it,
`packages/fs/src/fs.wac:772` returns it to its caller, and one "site" was
`packages/fs/test/cov_ledger.wac` *quoting source text in a coverage pin*. Counted properly — a call whose
`Change` nothing reads — it is **28 own-line sites and five inline**, the five being one copied helper.

So: the first count was bounded by its regex, and the second was inflated by one. Three of my counts went
that way today, which is the thing `corpus_probe.wac`'s docstring says and `issues/system/0235a` came down
to: an extractor bounds the invariant it feeds. The fix is not a better regex, it is reading a sample of
what the regex matched.

### The second duplicated helper: `put`, five copies, byte for byte

`bool put(Cli cli, string path, string text)` — make the directory above, write the file, answer whether
the write worked — was in `nativecli_test`, `declined_test`, `mappedspec_test`, `projectspec_test` and
`stdspec_test`, identical by md5, with 53 call sites between them. One of the five I wrote myself today, by
copying it.

It is the same finding as this issue's `scratch`, with a smaller cost: the discarded `mkdir` answer was not
*lost*, because `writeFile` failed too and the `bool` carried that — so a failure was **misattributed**
rather than silent, reported as "could not write x" when the directory above it was what could not be made.

`putFile` in `wactest/src/host.wac` is the one implementation now and names the real cause; the five locals
delegate to it and keep their `bool`, because 53 call sites assert on it. The reason therefore still stops
at that boundary for those callers, which is stated where they are.

The bare ones split further than that. **31 of them had a `T` after all** and took `madeDir` — which is
the right helper for a bare `mkdir` because it creates without emptying, so the behaviour is unchanged even
where a `remove` of the same path happened a line earlier. `mappedspec_test.wac` is that case: it removes
`home` between the remove and the mkdir, which is why batch two's same-variable match skipped all nine.

What is left really is the harder kind: **29** sites with no `T` at the site, in `bool`-returning helpers
like `writeTree` that have nothing to report through. Each needs a decision about how the reason
reaches the reader, which is the question this issue answered once and would have to answer again in a
different shape. (This paragraph said 69 while the sweep was still running, and contradicted the table
above it for half a day — a count written mid-sweep in a second place is a count that goes stale in one
of them.)

### And there is no third `put` — checked, 2026-08-21

The two wins here were both *duplication*: one helper copied nineteen times, then another copied five
times, each fixed once for every copy. So the residue is worth the same question before anyone starts
on it one site at a time — and the answer is no. Grouping the 29 by enclosing function gives **25
distinct names**, each appearing once or twice, and the only pair with an identical body is `populate`
twice *in the same file*. `scratchDir`, `writeTree`, `builtProgram`, `startTor`, `serveOnce`,
`builtByDeno`, `measure` — different fixtures for different packages that happen to share one bad habit.

That is the useful thing to know: the cheap form of this issue is finished, and what remains is 25
separate judgements rather than one more helper waiting to be found. Whoever picks it up should expect
to change signatures, not to delete copies.

### What one of those judgements looks like — the two `writeTree` fixtures

Done rather than described, because the shape is worth more than the advice. `readfail_test.wac` and
`collide0234_test.wac` each had `bool writeTree(Cli cli, …)` — an unchecked `mkdir`, then writes whose
answer was the return value — called as `t.isTrue(writeTree(…), "wrote the tree")`.

Three changes, and the third is the one to copy:

* **`bool` becomes `string`**, empty for success, and the call site asserts `whyTree == ""` with
  `whyTree` as the message. The reason now crosses the boundary the `bool` stopped at.
* **The `mkdir` disappears** rather than becoming a checked one, because `putFile` already makes the
  directory above the file it writes. Two sites left the residue by being deleted.
* **`cli.writeFile(...).wait().fault == 0` goes with it.** Every one of these fixtures had hand-rolled
  what `putFile` does, which is why the helper existing is what makes the judgement small.

Canaried by pointing the fixture at `/proc/nowhere/readfail`, which no `mkdir` can create:

    before   FAIL … wrote the tree: expected true
    after    FAIL … could not create /proc/nowhere/readfail/app — No such file or directory

The old message names the fixture's *writes* on a test whose entire subject is a message naming the
right file. That is the cost being paid 27 more times.

The 9 skipped pairs are named rather than silently left: `crypto/tools/ct.wac` and `tools/wac/covledger.wac`
are tools with no `T` at all, and the rest are sites inside helpers that do not take one —
`platform/test/wac/arrival_test.wac`, `frame_test.wac` (mixed, so left whole), `native_examples_test.wac`,
`quic/test/wac/peer.wac`, `server_test.wac`, `tls/test/wac/interop_test.wac`.

**Two things the batches taught, both about the checking rather than the editing.** A `T` can arrive as a
*parameter* rather than an assignment, so a file-level check passes where a site-level one is needed —
three of batch one's sites were that shape. And an import inserted after "the last line starting with
`import`" lands in the middle of a multi-line import list: `webrtc/test/wac/ice_test.wac` stopped
compiling, which is how I found out.

Verified: the 21 rewritten files all compile; `pipeline`, `inside`, `optimize`, `node_net`, `bindgenwac`,
`privatekey` and `echod` run green. The heavy ones — `tor` on real ports, `ssh` against real OpenSSH,
`tls`, `v8host`, `world` — go through the gate.

## What the residue actually is — 2026-08-21, and it is not 25 judgements

Grouping the remaining sites by their **helper's return type** rather than by its name says the thing
the earlier note missed. 26 sites, 19 distinct return types:

    Boundary  Built  Daemon  Identity  Journal  Measured  Node  Ours  Programs  SClient
    Said×2  Server  Shells  Turn  World  i32×2  string×5  string[]×2  void

Exactly **one** was the `writeTree`/`put` shape — a `bool` saying whether the fixture worked — and it
is done: `filecap_test.wac`'s `writeProgram` wrote 512 files and answered one `bool` for all of them,
so a failure anywhere reached the reader as *"wrote the over-cap program"* failing, naming neither the
file nor the reason. It returns the reason now and has no `mkdir`, `putFile` making each directory.

**Every one of the other 26 is a factory whose return type is the thing it makes.** `Server`,
`Daemon`, `Turn`, `Built`, `Identity` — and the five `string`s are paths, not reasons:
`scratchDir(cli, name)` answers *where*, `builtProgram(...)` answers the built path. There is no spare
channel in any of them, which is why they discard the `mkdir` answer: not carelessness, no place to put
it.

So the remaining work is one decision, not twenty-six:

* **Return `""` for failure and check at the call sites.** Convention-conforming — `wactest/src/fixtures.wac`
  says a helper should hand back what *"the caller should fail on with its own message, and a trap says
  only where it happened"*. Measured cost: `scratchDir` has 40 call sites, `builtProgram` 21,
  `workspace` 13, `builtByDeno` 8. About eighty, across every package's tests.
* **Take the `T` and assert inside.** Cheapest at the call sites and against the grain:
  `wactest/src/host.wac` records that these helpers deliberately take neither `Core` nor the harness.
* **Trap.** Also written down, and the convention says when: `wactest/src/repo.wac` traps deliberately
  because *"a guard whose corpus came back empty reports a clean"* result — silence that looks like
  success. A fixture directory that cannot be made does **not** look clean, because the assertions after
  it fail. So the rule the repo already follows says not here.
* **Leave them.** The failure is misattributed rather than silent: the next `writeFile` or `wac build`
  fails and says so, just about the wrong step.

No recommendation, because the first option's eighty call sites are a real cost against a real but
small benefit, and that trade is the operator's. What is settled is the shape: the cheap half of this
issue is finished, and what remains is a single question asked twenty-six times.

