# 0077 — a wac local named `self` has no wapy rendering

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** compile error

## What

`wapyRoundTrip.test.ts`'s "all of wac-mono" fails on one file:

```
/home/claude/agent-a/workspaces/wac-mono/packages/fs/src/image.wac (as wapy) did not parse:
  unexpected ':' after the expression at 434:9
```

Line 434 of the *rendering* is `self: i32 = fs.nodes.len() - 1`, from wac's

```wac
i32 self = fs.nodes.len() - 1;
```

`self` is an ordinary identifier in wac — the receiver there is `this` — and it is wapy's receiver
keyword, so the printed program is not a wapy program. The round trip is the only thing that notices,
because nothing else asks wac and wapy to agree about what a name may be.

## The three ways out, none of them obviously right

1. **wapy's parser accepts `self` as an ordinary name** where it is not a parameter. Smallest, and makes
   the two surfaces agree on identifiers, which is what "the same language in two surfaces" claims.
2. **wac reserves `self` too.** Honest about the shared vocabulary and breaks existing wac.
3. **The printer renames.** It would have to be consistent within the function and would make the
   rendering no longer a transcription, which is the one property the round trip exists to check.

(1) looks right to me but it is a language decision rather than a bug fix, which is why this is filed
rather than done.

## Notes

Not new: the local has been there since `wac-mono`'s image format was written. What is new is that the
round trip over wac-mono now reaches it — so the failure is a *measurement* arriving, not a regression.

`wac-mono` renamed the local in passing, because `self` beside `this` is confusing in a wac file anyway.
That takes the suite green and leaves this open: the next `self` will do the same thing.

## It reached the shared suite — 2026-08-16, agent-b

`packages/wacc/src/api.wac` gained a private helper with a parameter named `self` (`1727af93`), and
`compiler/wapyRoundTrip.test.ts` went red on it for the whole repository: *"api.wac (as wapy) did not
parse: a parameter is written `name: Type`"*. The position it names is in the **generated** wapy, not
in the source, which is what made it slow to place — the source line it points at is 60 characters
long.

Renamed to `selfIndex`, with the reason beside it. That is a workaround and this issue is still the
fix: nothing stops the next person writing `self`, and the failure they will see says nothing about
`self` at all.

Worth a diagnostic that names the identifier, if this is not going to be fixed soon. The cost here
was not the rename.
