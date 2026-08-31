# 0306 — `socks` traps on the native v8 host when a client connects and says nothing

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** `wac: packages/tor/src/socks.wac trapped`, and the proxy is gone. Intermittent — about
  one run in four or five, so a single clean run means nothing.

## It is the async proxy on the v8 host, and it is intermittent

**No `$trap$message`**, which narrows it: ordinary wac runtime traps — bounds, null — carry text, so
this is not one of those. And the rate is the single most important fact about it, and the one I did
not have when this was filed.

| arm | trapped |
|---|---|
| async proxy, **v8** host with `0304b`'s fix | 2 of 9 |
| async proxy, **v8** host without it | 2 of 6 |
| async proxy, **Deno** host | 0 of 6 |
| async proxy, **wasmtime** host | 0 of 6 |

**That table is confounded and the conclusion drawn from it was wrong.** The two v8 rows were
measured while gates and another agent were loading the machine; Deno and wasmtime were measured
later, on a quiet one. Re-running the **baseline** — pristine host, no changes — on the quiet machine
gives **0 of 8**. So the arms differ in when they ran, not only in what they tested, and "it is the
v8 host" is not supported by them.

The same confound voids everything else measured in that stretch, each of which looked like a
finding at the time: bounds guards 0 of 14 (with the guard never firing), a host debug print 0 of 4,
`--stack-size=8000` 0 of 8, and `--stack-size=200` 0 of 6. Four "fixes" and one cause.

**What survives is that the trap is load-dependent**, which is a fact about it worth more than any of
the above: it appeared readily while the machine was busy and has not appeared once since it went
quiet. Any future arm has to be measured *interleaved* with its control rather than after it.

Testing the wasmtime arm needed its seed rebuilt — its binary carried one from before `Core`/`Cli`,
which is the gap recorded as "could not ask" when `issues/system/0304b` was closed.
`./bootstrap.sh --host wasmtime` is the price, and it is now paid.

## Correction: `0304b` is not involved, and the first version of this issue said it was

This was filed as the interaction of two changes — the async rewrite and `0304b`'s close fix —
on the strength of four controls that were **one run each**. Against a failure that fires about
20% of the time, a single clean run says nothing, and "no trap without the fix" was a coin landing
heads. Repeated, the two v8 arms are indistinguishable.

That mattered beyond bookkeeping: the mitigation offered was to revert `0304b`, which would have
removed a real fix for a bug it has nothing to do with and left this one exactly where it is.

## What is ruled out, by reduction rather than by argument

A standalone server with the proxy's shape does **not** trap, run repeatedly: an `async` accept pump,
one pump per client, a `Vec<Client>` with `swapRemove`, a `gone` flag, `main` driving `core.drainFor`,
and a pump that closes *other* parked pumps' sockets from inside its own continuation. It is in
`packages/platform/test/wac/` while this is open.

Also ruled out: a nested `waitAny` inside a continuation — `startCircuit` only does
`randomBytes().wait()`; and fixed-size machine state — `asyncsynth` allocates a machine's cells
per call, not from a program-wide table.

## Reproduction

`packages/tor/test/wac/socksnet_test.wac` with a block that opens a TCP connection to the proxy port,
sends nothing, and closes it. Everything before that in the case passes — the network stands up, a
stream is carried, `stream 1 ended: done` is logged — and the trap follows.

That block is **not committed**, because it would make the shared suite red for a bug that is
written down here. The trap is reachable from the pushed tree; it is the test for it that is not.

## What to do next

The Deno host does not trap, so it cannot name the frame. The wasmtime host in `native/` would, and
its binary carries a seed built before `Core`/`Cli`, so `./bootstrap.sh --host wasmtime` is the
price of a real stack.

The other thread worth pulling is the missing `$trap$message`. Whatever traps is not going through
the path that sets one, which is a much smaller search than "somewhere in the proxy".

## Not currently reproducible, and that is the state to hand over

Roughly fifty runs since the last confirmed trap, across every arm above and several more, all clean
— including the pristine host with no changes, and 32 concurrent clients at load 7.4. So the earlier
rates are not something a later reader will be able to reproduce by following the steps.

What the reproductions had in common was **a gate running beside them**: real contention for five
cores between two suites, not a load average. That is not something to manufacture — `push.sh` warns
that three suites at once get killed at about 70% with no failure reported, so loading the box to
chase this would hand the other agents phantom failures.

**The route back to it is not known.** Running the probe while another agent's gate was live —
the contention every reproduction had — gives 0 of 6. So does restoring the probe to the exact shape
that first trapped it: fill to the cap, one connection past it, close them all, then a real request.
That shape had been simplified in between, which was a second uncontrolled change and is why it was worth
putting back; it did not bring the trap with it.

Tally: it reproduced readily for one stretch and has not reproduced in ~70 runs since, across a
pristine host, four host variants, three probe shapes, a quiet machine, a loaded one, and a live
gate beside it.

**Things eliminated along the way**, each by a check rather than an argument, and all still true:
the `0304b` interaction (rates indistinguishable), a stale circuit index (guard never fired), a
nested `waitAny` (`startCircuit` has none), fixed-size machine cells (allocated per call), v8 stack
depth (200KB did not make it worse), and every minimal reproduction of the proxy's shape.

**And one thing not eliminated, only unmeasurable right now**: whether it is host-specific. The Deno
and wasmtime arms were measured after the trap had already stopped appearing anywhere, so they say
nothing.

## The seed is not stale after all, and the paragraph here said it was

This said the measurements were made against a four-hour-old compiler while master moved 37 commits
ahead "including work on the compiler". The second half was written without checking and is wrong:
**none** of those 37 commits touch `packages/wacc/src`, `std` or `core` — they are design notes,
issues, and `packages/box` tests. The seed dating from 01:55 is therefore current with respect to
them, and `wac task seed` had nothing to rebuild.

So there is no "two readings" here: a seed rebuild is not the first thing to try, because there is
nothing to rebuild. Left in rather than deleted because the reasoning was sound and only the premise
was unchecked — `CLAUDE.md`'s warning about another agent's compiler change ageing your seed is real,
it just did not happen this time.

## Reproducible again, and it traps at the point of suspension — agent-b, 2026-08-31

**5 of 5, at load average 1.04.** So it was never load-dependent; that earlier characterisation is
withdrawn. What changed between the clean stretch and this one is the **seed**: the runs that could
not reproduce it used the 01:55 compiler, and these use the 08:44 one rebuilt with `0300a`'s and
`0303c`'s fixes. Whether that is cause or coincidence is not established — but it is the variable
that moved, and "load" was not.

The recipe that reproduces: fill to `MAX_CLIENTS` with connections that say nothing, open one more,
close them all, then make a real request.

**Both pumps trap at `await`, not inside anything of mine.** Traced:

    T accepted 100003 clients=0        G cell done
    T await sock=100003 phase=0        G await
    T woke  sock=100003 phase=0        wac: … trapped
    T accepted 100003 clients=0
    T await sock=100003 phase=0
    wac: … trapped

The last line before the trap is the log immediately *preceding* a suspension, in the client pump in
one run and the guard pump in another. Nothing between that log and the trap belongs to `socks.wac`.
With no `$trap$message` — so an engine-level trap rather than a wac `trap` — that points at the
generated state machine rather than at the proxy.

**One thing this ruled out along the way.** Socket handles are reused the instant they are closed:
the trace shows `100003` accepted twice. `socks` matched clients by `sock`, on a comment of mine
claiming a handle is unique among live clients, and it is not — closing thirty-two at once means the
proxy has not seen every `End` before `accept` reissues the numbers. That is a real defect and is
fixed by giving `Client` an id that is never recycled. It is **not** this bug: with the fix, 5 of 5
still trap.
