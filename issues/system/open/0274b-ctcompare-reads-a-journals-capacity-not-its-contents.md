# 0274b — `wac ctcompare` read a journal's capacity rather than its contents, at 15.7s a call

- **Status:** open — the cheap half is fixed; the remaining half is p256 and needs a bulk read
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** performance
- **Symptom:** no error — the gate's single largest cost

## The measurement that found it

The suite's floor is its longest chunk. `packages/crypto/test/wac` was **334s** of a 415s floor, and
timing its files one at a time says it was one file:

    265s  constanttime_test.wac
      6s  rsa_test.wac
      2s  and below, every other file

`constanttime_test.wac`'s own header says it costs **6.8s** and that "this file is its builds". Both
were true in 2026-08-19 and neither is now. Its builds are fine — a traced build of a p256 driver is
**261ms**, and 28 of them is the 7.6s the header describes. What is not fine is `ctcompare`:

    ctcompare, sha256 driver     1,543 events   15,745ms
    ctcompare, p256 driver   8,190,814 events   16,448ms

**The same time for four thousand times the work**, which is the shape of a cost that is not about
the work at all.

## Why

`packages/wac/src/counters.wac` pulls the journal out one slot per host call:

```wac
CallResult n = cli.call(m.handle, "__cov_len", 0);
for (i32 i = 0; i < n.value; i++) {
  CallResult v = cli.call(m.handle, "__cov_get", i);
```

`__cov_len()` is the journal's **capacity** — `api.wac` says so — which is 2²² by default. So every
comparison made ~4.19 million host calls per module and ~8.4 million per call, at about 1.9µs each,
whatever the routine did. Running the module is 71ms; the reading was everything.

And the journal already says how much of it is live: **slot 0 is the cursor**, which is exactly what
`compareJournals` reads first. The loop had the number it needed in the slot it fetched first.

## Fixed, for everything that does not fill its journal

`read` takes a `traced` flag and stops at the cursor, then fetches the last slot — the two things
`compareJournals` uses. Not for `covdump`, where the journal is a counter table and every slot is a
real number.

    sha256 comparison        15,745ms  ->  64ms      same answer, `same 1543`
    constanttime_test.wac       265s   ->  150s      10 passed, 0 failed
    packages/crypto/test/wac    334s   ->  155s      22 files, 22 ok

## What is left, and it is p256

The 150s that remains is the routines whose cursor really does reach the end. `p256PublicKey` is
8.19 million events and its test doubles the journal to hold them, so the loop reads every slot and
the fix cannot help it: 8.4 million host calls is the honest cost of the current interface.

Making that cheap needs a **bulk read** — one call that hands back a range of slots rather than one
call per slot. The journal is a GC array rather than linear memory, so it cannot simply be mapped;
`cli.call` returns a scalar, so the shape of the fix is a new host entry rather than a loop tweak.
That is a decision about the host API and is why this stays open rather than closing here.

Worth knowing before designing it: the comparison itself is fast. `ctcompare` answered about 8.19
million events in the **0.7s** that remained once the reading stopped dominating, which is what the
file's header claimed for it all along.
