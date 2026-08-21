# 0227a — the `wc` differential's oracle counts words in whatever locale it inherited

- **Status:** open
- **Claimed by:** agent-b, 2026-08-21 — pinning the locale *and* stating what our `wc` implements
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** untested behaviour
- **Symptom:** no error — the test passes, and passes for a reason it does not state

## Measured

`packages/platform/test/wac/world_test.wac` compares a wac `wc` against the real one, twice —
`test_an_application_written_entirely_in_wac_runs_and_agrees_with_wc` and
`test_wc_reads_standard_input_when_given_no_file`. The oracle is

```wac
cli.exec("/bin/sh", string[]("-c", "wc < '" + WC + "'"), u8[0]())
```

on `packages/platform/example/wc.wac`, and its word count depends on the locale the child inherited:

    LC_ALL=C.UTF-8   72  474  2712        ← what the container has, so what the test compares against
    no environment   72  472  2712        ← the C locale

Our `wc` answers **474**. So the differential agrees today because `Cli.exec` hands the child the
host's whole environment, `LC_ALL=C.UTF-8` among it, and `wc -w` splits on what that locale calls
whitespace. Two words in that file are whitespace in UTF-8 and not in C.

## Why it matters

The test asserts our `wc` matches the system `wc`, and what it actually asserts is that it matches the
system `wc` **in the container's locale** — which nothing in the test says, and which the test does not
control. Change `LC_ALL` in the image and two of these fail with a two-word discrepancy that reads as a
bug in our word splitting.

It is also the wrong way round from the usual trap: the danger is normally *pinning* an oracle's
environment so it agrees with our bug (`LC_ALL=C` on the real tool). Here the oracle is unpinned and
agrees by inheritance, which is the same fault — an oracle whose answer depends on something the test
neither sets nor mentions.

## How it was found

By closing the environment leak in `issues/system/0198` as an experiment: with the child getting only
`PATH`, these two tests failed at 474 against 472. The failure is the finding — nothing else in
twenty-four exec-using directories was locale-sensitive.

## What to do

State the locale rather than inherit it: pass `LC_ALL` explicitly on the oracle's `sh -c` line, and say
in the test why the comparison has a locale at all. That is not pinning the oracle to agree with a bug
— UTF-8 word splitting is what our `wc` implements, and the assertion is about that — it is making the
comparison say which question it is asking.

Worth checking at the same time whether `wc.wac`'s splitting is *meant* to be locale-aware, since the
example is a teaching program: if it is meant to be C-locale byte splitting, then 474 is our bug and
this test has been hiding it behind an inherited variable. The two-word difference is small enough to
name exactly — the file is 2712 bytes and committed.
