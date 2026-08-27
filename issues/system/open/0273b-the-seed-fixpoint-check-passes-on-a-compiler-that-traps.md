# 0273b — `deno task seed` reports success for a compiler that traps on its first use

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-27
- **Kind:** missing feature
- **Symptom:** a green reseed followed by every subsequent command failing

`tools/seed.sh` iterates to a fixed point and refuses a seed that is not one. It does not ask whether
the compiler it kept **works**.

## What happened

An emitter change of mine produced a compiler that compiles itself to a fixed point and then traps
the moment it is asked to compile anything:

    $ deno task seed
    seed: 1720664 bytes, and it is a fixed point after 1 round(s)     # green

    $ wac run hello.wac
    wac: packages/wac/src/wac.wac trapped

Both rounds were equally wrong, so they agreed, and agreement is the whole of what is checked. Every
command after that failed with a message about the *program being compiled* rather than about the
compiler, which is the expensive part: the reseed is the last place you would look, because it said
it had succeeded.

## Why the check cannot see it

The header states the property precisely — *"refuse to keep one that is not a fixed point"* — and
that is what it does. A fixed point is a claim about **stability**, not about correctness: `f(x) = x`
holds for a broken `f` as readily as a working one, as long as it is broken the same way twice.

The suite catches it, and the rungs catch it well. But the suite is minutes away and the failure it
reports is not obviously about the seed.

## What would catch it, and it is cheap

Compile and run one trivial program with the new seed before installing it — the same shape as the
fixpoint check, which already builds and compares artefacts:

```
export i32 main() { return 7; }
```

If it does not answer 7, put the previous seed back, exactly as a failed fixpoint already does. That
is one compile and one run on a file with no imports: well under a second against the 27.2s the
rounds already cost.

**It should use the same "put the previous seed back" path** the fixpoint failure uses, and say which
of the two checks refused — otherwise the diagnosis moves from "the reseed lied" to "the reseed
refused and I do not know which half".

## Notes

**Not hypothetical and not rare.** Any change to the emitter's function-table bookkeeping can produce
this: the table is self-consistent, so the compiler builds itself, and the indices are wrong for
anything else. `issues/lang/0274b` is the change that produced it, and `design/lang/0010` records at
length that this class of mistake does not show on small tests.

**`seed:bootstrap` is the way out** once you know — it builds with the reference, so the broken
compiler is out of the loop. `CLAUDE.md` already says so; what is missing is being *told* that you
need it.
