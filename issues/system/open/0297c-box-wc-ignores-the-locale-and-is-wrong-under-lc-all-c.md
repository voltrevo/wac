# 0297 — box's `wc -w` ignores the locale, and is wrong in the one the repo compares in

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** wrong answer — a word count that disagrees with `wc(1)` under `LC_ALL=C`

## Reproduction

```
$ printf 'a\xc2\xa0b\n' > nbsp.txt        # a, U+00A0, b

$ wc -w < nbsp.txt                        # ambient, C.UTF-8
2
$ LC_ALL=C wc -w < nbsp.txt               # bytes, so no separator
1
$ LC_ALL=C box wc -w nbsp.txt
2                                         # disagrees
```

`box`'s `wc` never reads the environment. `packages/box/src/applets/wc.wac` splits on
`isWordSeparator(cp)` — a fixed table of *"the twenty-three code points GNU ends a word at"* — applied
unconditionally, which is the **UTF-8** answer in every locale.

## Why it matters, and why nothing noticed

`LC_ALL=C` is what this repository compares in, and box says so itself in three places:

- `applets/ls.wac:53` — *"Byte order, which is `ls` under `LC_ALL=C` — the environment every comparison
  in this repo uses"*
- `lib/args.wac:301` — *"`LC_ALL=C` is what this repo compares in"*
- `lib/trset.wac` and `lib/operands.wac` are written to the C locale throughout

So box's applets have silently picked **two different locales**: `ls`, `tr` and the argument parser are
C, and `wc` is UTF-8.

The suite cannot see the divergence because its two halves each avoid it. The `wc` cases in
`appletCases()` are pure ASCII, where C and UTF-8 agree. The one test with non-ASCII input —
`box.test.ts`'s *"wc -w splits words where wc(1) splits them"* — deliberately does **not** pin the
locale, and says why:

> The real one is spawned with the ambient environment on purpose. Pinning `LC_ALL=C` here would make
> this pass without the fix, which is exactly how the gap survived.

That comment is about an earlier bug and is still right, but it also means the only case with a
character that could show this asks the question in the one locale where box happens to be correct.

## The fix

`wc` reads `LC_CTYPE`/`LC_ALL` and splits on bytes when they name the C locale, on scalars otherwise.
`Cli.env` already exists; nothing prevented this.

Two things fall out. The **capture pinning stops being an obstacle** — `tools/wac/appletvectors.wac`
asks bash through `env -i … LC_ALL=C`, and once box honours that, both sides agree and the case can be
captured like any other, which is what `issues/system/0193` wants for it. And the unicode cases can be
captured under an explicitly UTF-8 locale rather than relying on whatever the container's ambient
setting happens to be.

## Worth checking beyond `wc`

`wc` is the applet where the divergence is visible because word-splitting is defined against character
classes. The same question — *does this applet read the locale, and which one did its author assume* —
applies to `sort` (collation order), `tr` (`[:alpha:]` and friends), `grep`, and `ls` (which states C
and means it). This issue is about `wc`; the audit is the follow-up.

## How it was found

Asked while migrating `box.test.ts` under `0193`: the `wc -w` case would not lift into the vector
machinery because the capture pins the locale. The obstacle looked like a property of the capture tool.
It is a missing behaviour in `wc` — the same shape as `0296c`'s chmod gap, where a test that could not
be written turned out to be naming something the platform could not do.
