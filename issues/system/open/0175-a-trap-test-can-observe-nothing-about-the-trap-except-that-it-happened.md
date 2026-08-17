# 0175 — a `test_traps_*` case can observe nothing about the trap except that it happened

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** missing feature
- **Symptom:** not implemented

## What is wanted

`test_traps_*` inverts the verdict: trapping passes, returning fails with the string the body would
have returned. That is the whole contract, and it is enough whenever *whether* the call refused is
the question.

It is not enough when the refusal has to be **cheap**, and that case is not rare — it is the shape of
every guard against an attacker-controlled size.

## The case that found it

`packages/gzip/test/wac/inflate_test.wac`, moved from `packages/gzip/test/inflate.test.ts` under
`issues/system/0161`. `gunzipBytes` reads ISIZE from the trailer and uses it to size the output buffer
in one allocation. The trailer is attacker-controlled, so `maxSizeHint()` caps the hint at 64 MiB and
the buffer grows normally past that.

The host-side test asserted both halves:

```ts
const started = performance.now();
mustTrap(`ISIZE claiming ${claimed} bytes`, huge);
if (performance.now() - started > 1000) {
  throw new Error(`an ISIZE of ${claimed} took ${took}ms to reject — the hint looks trusted`);
}
```

The bound is what carries the meaning. **A decoder that trusted the hint would also trap** — on the
allocation, a moment later and several hundred megabytes in. Trapping is the wrong evidence; the
evidence is that it trapped without trying.

The three `test_traps_isize_claiming_*` exports that replaced it are therefore weaker than what they
replaced, and the file's header says so rather than leaving it to be discovered.

## Why it is filed rather than done

Same reason as `issues/system/0164`: the runner knows a test by its name and signature, so anything
it learns about a trap has to arrive through one of those, and there is more than one reasonable
spelling.

- **A budget in the name** — `test_traps_within_100ms_*`. One export, no new signature, data in an
  identifier again.
- **A returning test that can catch** — the general answer, and much larger: wac has no `try`, and
  giving it one to make a test assertable is the tail wagging the dog.
- **A per-test deadline the runner enforces**, reported as a distinct verdict from a failure. This is
  the one that generalises: it costs no naming rule, it would catch a wedged test in any file, and a
  budget beside the case is a thing `wac test` could grow independently of traps.

The third is probably right, which is exactly why it should not be decided in passing while porting a
gzip test.

## What it is worth

One assertion today, in one file. But the shape — *refuse an implausible size without paying for it*
— is the reason `maxSizeHint` exists at all, and a test that cannot tell the capped path from the
uncapped one is a test that would go green if somebody deleted the cap. That is worse than not having
it, because `issues/lang/0112`'s argument applies to the guard as much as to the code: a bound nothing
measures is a bound nobody has checked.

Not urgent. Nothing is broken; a real regression here still fails the timing nobody is taking.

## Narrowed, 2026-08-17 — the runner observes the message now

Not the feature this asks for, but one of the two things it lists as unobservable is no longer:
`trap "…"` survives the trap in a global and `$trap$message` hands it back (`issues/lang/0147`), so
`wac test` prints it — `FAIL name — trapped: the ring is full`, and on a `test_traps_*` pass under
`--verbose` too, which is where it matters most: a case passing for the *wrong* trap looks identical
to one passing for the right one. An engine trap writes nothing and the line says only "trapped",
because a bounds check reporting the previous `trap`'s sentence would be worse than reporting none.
`tools/testTrapMessage.test.ts`.

What remains is what this issue is actually about: **cheapness cannot be observed at all.** The
`gunzipBytes` case wants "refused without trying", and a decoder that trusted the hint traps too — a
moment later and several hundred megabytes in. The message does not separate those, and neither does
the verdict. That still needs one of the three spellings above, and the third — a per-test deadline the
runner enforces, reported as its own verdict — is still the one that generalises.
