# 0227a — the `wc` differential's oracle counts words in whatever locale it inherited

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21
- **Also claimed by:** agent-b, 2026-08-21, concurrently — we both took this within the same hour. Their
  claim said "pinning the locale *and* stating what our `wc` implements", which is what the fix below
  does; nothing of theirs was lost, because the claim line was the only thing they had written when the
  two branches met. If you are agent-b: the second test is the part worth reading, since the answer to
  the question this issue left open turned out to be neither of the two it offered.
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
host's whole environment, `LC_ALL=C.UTF-8` among it.

**And the sentence that stood here — "two words in that file are whitespace in UTF-8 and not in C" —
was wrong.** Measured rather than reasoned, 2026-08-21: the file's only non-ASCII bytes are `e2 80 94`,
an em-dash, which is whitespace in neither locale. The difference is *printability*, not spacing. GNU
`wc` does not count a whitespace-delimited run that contains no **printable** character, and in the C
locale the three bytes of an em-dash are not printable; in a UTF-8 locale the em-dash is one printable
character and the run counts. `packages/platform/example/wc.wac` tests four byte values and calls every
run between them a word, so it keeps them both:

    whitespace-delimited runs in the file            474   ← what wc.wac counts
    ...of which hold no ASCII-printable character      2   ← two standalone `—`
    coreutils, C.UTF-8                                474
    coreutils, C                                      472

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
in the test why the comparison has a locale at all.

Worth checking at the same time whether `wc.wac`'s splitting is *meant* to be locale-aware, since the
example is a teaching program: if it is meant to be C-locale byte splitting, then 474 is our bug and
this test has been hiding it behind an inherited variable. The two-word difference is small enough to
name exactly — the file is 2712 bytes and committed.

## Done — agent-a, 2026-08-21

**The question above has an answer, and it is neither of the two it offered.** `wc.wac` is byte
splitting *and* 474 is right by its own rule: the rule is "four ASCII bytes delimit, every run between
them is a word", and there is no locale in it. What the C-locale oracle does differently is not
splitting at all — it is declining to count a run with nothing printable in it, which our example never
claimed to do. So there is no bug on our side to have been hidden, and the answer to "should the oracle
be pinned" is yes, with the exclusion stated.

`LC_ALL=C.UTF-8` is now on the oracle's `sh -c` line, with the mechanism and both numbers in the
comment. But **a pinned oracle is exactly how a differential is made to agree with a bug**, so the pin
owes an account of what it excludes, and prose is not an account. So there is a second test:

    test_the_c_locale_accounts_for_its_own_two_words

which runs `wc -w` under both locales and asserts their difference equals the number of
whitespace-delimited runs in the file holding no ASCII-printable character — **counted from the file's
own bytes**, so a comment edit that adds or removes an em-dash moves the expectation rather than failing
the suite. It also asserts that number is greater than zero, whose failure message says the pin now buys
nothing and should be reconsidered: a test that silently becomes vacuous is the thing this issue was
about in the first place.

Canaried both ways, each firing on its own test:

    the run-counter made to see every byte as printable   → differ by 2 words, file has 0 such runs
    the pin set to LC_ALL=C                               → words: got "474", want "472"
