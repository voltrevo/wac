# 0077 — a wac local named `self` has no wapy rendering

- **Status:** closed
- **Claimed by:** agent-a
- **Closed:** 2026-08-27
- **Fixed in:** the commit closing this
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

## The diagnostic this asked for — agent-c, 2026-08-16

Still open as a language decision; the interim the note above asks for is done.

`compiler/wapyRoundTrip.test.ts` now shows the offending line of the *rendering* with a caret, and
names any wapy keyword appearing on it:

```
/probe.wac (as wapy) did not parse: unexpected ':' after the expression at 3:9
  3 |     self: i32 = xs.len() - 1
    |         ^
  self on this line is reserved in wapy and ordinary in wac — see issues/lang/0077
```

Where it previously gave a position in generated text nobody has open, followed by the whole
rendering — which is how this issue came to be placed by hand twice, the second time against a
60-character source line that says nothing about `self`.

The keyword list is `self`, `None`, `True`, `False`, `def`, `class`, `lambda`, `pass`, `elif`. Only
`self` has bitten so far; the rest are there so the next one is named rather than found the same slow
way. Naming the line is right for every cause and costs nothing; naming the word is a guess, so it is
offered as a possibility rather than asserted.

A test pins the message — the line *and* the word — and says to delete itself if the language decision
lands and `self` starts round-tripping.

## 2026-08-21: the reproduction is gone from the tree — agent-a

`compiler/wapyRoundTrip.test.ts` passes, 21 of 21, and the file this was found in no longer triggers it:
`packages/fs/src/image.wac` mentions `self` three times and **all three are comments or a string**
(`/proc/self/cmdline`). Nothing under `packages/` declares a local called `self` any more — the
declaration that produced `self: i32 = fs.nodes.len() - 1` in the rendering is gone.

So the decision at the top of this page has no live cost: whichever of the three ways out is taken, no
existing program changes. That is worth knowing because two of the three were priced by how much they
would break, and the answer is now nothing.

**What it also means: the round trip cannot see this.** Reproducing it needs adding `i32 self = …` to a
file the sweep walks, so the issue is held by prose rather than by a test — the state this repository
distrusts. A pinning test would be one file with a `self` local asserting the rendering does *not* parse,
in the same style as the ledgers added for `issues/lang/0156`, and it would fail the day option 1 lands,
which is the point.

Not written here, because it belongs with whoever takes the decision: pinning a rendering that is
deliberately wrong is only worth it if the wrongness is going to persist, and that is precisely what is
undecided.

## Closed 2026-08-27 — wapy spells the receiver `this`, and the collision is gone

The operator's ruling, and it is the one option this page did not list: **wapy uses `this`, like wac.**
`self` stops being a wapy keyword and becomes an ordinary identifier on both surfaces, so a wac local
named `self` renders as itself and reads back as itself. `spec/spec/wapy.md`, `wapyLex.ts`'s
`SPELLINGS`, `wapyParse.ts` and `wapyPrint.ts`.

**Why this rather than any of the workarounds above.** `self` was the only one of the six respellings
that could collide, and the reason is structural: `and`, `or`, `not`, `None`, `True` and `False`
correspond to *punctuation and literals* in wac, so no wac identifier can be one of them. `self`
corresponded to a wac **keyword**, and both spellings are legal wac identifiers — so reserving it on
one surface became a rule about identifiers on the other. The cost was real and was being paid in wac:
`packages/wacc/src/check.wac` carried a local it could not name `self` and a comment saying why, and
`packages/wacc/src/api.wac` renamed a parameter to `selfIndex` for the same reason. Both comments now
record the fix instead.

Looking Pythonic is not worth a constraint on the canonical surface, which is what this had become.

**Found while fixing it:** the correspondence table said wac's receiver is `P self`. There is no such
form — wac declares a receiver `this` or `const this` (`spec/tour.wac:425`), and a first parameter
written `P self` is an ordinary parameter, so `p.get()` on it is *no such method*. The row had been
giving the wapy spelling in both columns. `compiler/wapySpec.test.ts` carried the same mistake in a
fixture named *"a method with a receiver"* whose wac input had none — which is why nothing caught it.
Both fixed here.

**Canary.** `compiler/wapyRoundTrip.test.ts` held a test asserting this bug, ending *"if 0077 is
fixed, delete this test"*. It is inverted rather than deleted: the same program now has to round-trip,
so reserving `self` again on either surface goes red on the exact case that used to fail.
