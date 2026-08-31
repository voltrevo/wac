# 0301 — `rev` walks characters whatever the locale says, and `wc` does not

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-31
- **Kind:** decision
- **Symptom:** two applets in one program answer the same question about the environment differently

## The disagreement

`wc` reads the locale. `rev` does not, and there is no third answer in `packages/box` — those are the
only two applets whose output depends on where a character begins.

    packages/box/src/applets/wc.wac:112     bool utf8 = utf8Locale(cli);
    packages/box/src/applets/rev.wac:1      // Each line reversed — by character, not by byte.

`wc` gained `utf8Locale` in `issues/system/0297c`, because GNU's `wc -w` splits words differently in
`C` and in `C.UTF-8` and ours was answering the C question in both. `rev` walks scalars through
`unicode`'s decoder unconditionally, which is the right answer under `C.UTF-8` and is not what the
real `rev` does under `LC_ALL=C`, where it is byte-oriented.

Neither is wrong on its own. Together they mean `box` has no single answer to "does this program
respect `LC_CTYPE`", which is the sort of thing a user finds out one applet at a time.

## How it was found

Adding `uni.txt` — non-ASCII text — to `appletFixtures()`, to hold the claim that `fold`, `cut` and
`tr` are byte-oriented and *should* be, which `issues/system/0143` raised and nobody had written down.
`rev` cannot join that row: the capture pins `LC_ALL=C`, so the real tool would be captured reversing
bytes while ours reverses characters, and the vector would pin an answer we do not want.

That exclusion is recorded in `cases.wac` and is correct whatever is decided here. It is also the
thing that makes this worth filing rather than shrugging at: the fixture that would have caught the
inconsistency is the one that cannot contain it.

## The decision

Three answers, and picking is the work — the code either way is small.

1. **`rev` follows the locale**, like `wc`. Matches the real tool in both locales. Costs `rev` a `Cli`
   it does not currently need, and makes a `box` built without the environment grant reverse bytes,
   which is a behaviour change for a program that has no `env` grant today.
2. **`rev` stays character-oriented and it is a stated divergence**, in `packages/sh/README.md` beside
   the others. Defensible: reversing bytes mangles text, and a user running `rev` on a UTF-8 file in a
   C-locale script is more likely to want the characters than the bytes.
3. **`wc` stops following the locale.** Named for completeness. It would undo `0297c`, whose whole
   finding was that the C answer was being given to a UTF-8 question, so this is the one I would not
   pick.

**Not urgent, and nothing is broken.** Both applets are self-consistent and both are tested. What is
missing is the sentence saying which of the two is the house style, and a `uni.txt` row for `rev` once
there is one.
