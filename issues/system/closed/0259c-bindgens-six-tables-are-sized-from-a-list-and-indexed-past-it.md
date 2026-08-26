# 0259c — bindgen's six tables are sized from one list and indexed past it

- **Status:** closed — not a bug, 2026-08-25
- **Reported by:** agent-c, 2026-08-25
- **Kind:** bug
- **Symptom:** none. The sizing is exactly right and this issue was wrong

Found while looking for the table that made `issues/system/0257c` step 4 trap. That one was in
`emit.wac` and is fixed; this is the same defect class, in `bindgen.wac`, and was on the way past.

`bindgen` builds a `G` with six groups of parallel arrays, every one of them sized from the length of
the worklist it is about to walk:

    G g = G(js,
            string[wl.len()](fill: ""), ...          tName tBind tKind tPayload, cursor tCount
            string[wl.len()](fill: ""), 0,           mLines,                     cursor mCount
            ... four more groups ...
            string[sl.len()](fill: ""), ...          sName sRet sParams,         cursor sCount

Six cursors advance, and **not one of them is checked against the array it indexes.** `emit.wac` has
twenty-four cursors and every one is guarded — `ranOut` declines with a sentence naming the table,
which is `issues/lang/0158`'s rule. These six do not, so the failure is an engine trap: `array
element access out of bounds`, which arrives with **no message at all** (`issues/lang/0254c`) and
prints as `wac: … trapped`.

## Whether it can actually happen

`wl.len()` is a *worklist* length, and each entry can contribute more than one row. That is the whole
question, and it is the reason this is filed rather than fixed: the sizing is only correct if every
group's cursor advances at most once per worklist entry, and that is a property of six separate walks
rather than something the constructor says. `tCount` — the group at `bindgen.wac:308` — advances once
per `wl[i]` that carries a tag, which looks safe. The others were not read as carefully, because the
trap I was chasing turned out to be elsewhere.

**The precedent is against assuming it is fine.** `bindtables_test.wac` exists because this exact
table was fixed at 64 and a program overflowed it, losing every `Pending<T>` and producing a shell
that built, loaded and printed nothing. That one at least truncated; this one trapping is worse to
diagnose and better to hit.

## Why it is here and not just fixed

`wac bindgen` is not on the build path — nothing in a `wac build` reaches this file — so no amount of
compiling this repository will find it, and the fix is not one line. Sizing from `wl.len()` is
already a guess at a bound; the honest version is a guard per cursor with a `ranOut` naming its
group, which is six edits to a file I have not otherwise read, plus a generated interface wide enough
to be a failing case first. `issues/system/0257c` is mid-flight and this blocks nothing.

The shape to copy is `emit.wac`'s `addFunc` as of today: one guard, at the single place the cursor
advances, checking *every* array that cursor indexes.

## Closed: the bound is exact, and I filed on the absence of a guard rather than on a bound

Reading the loop answers the question this issue left open, and the answer is no.

It is **one pass over `wl`**, the branches are mutually exclusive `else if`s, and each advances its own
cursor by exactly one. So the six cursors *sum* to at most `wl.len()` — never mind each staying under
it — and every array they index was sized `wl.len()` in the constructor immediately above. The `sl`
loop is the same shape, with a `continue` that can only advance less.

So there is nothing to overflow, and a guard would be dead code that implies the bound is uncertain
when it is the same expression as the array's size.

**What I actually had was "six cursors advance and none is checked", from a script.** That is a
description, not a defect: an unguarded cursor is only a bug when the array's size is not the walk's
own bound. `emit.wac`'s cursors need guards because their tables are fixed constants and their walks
are program-sized; these are sized *from the walk*. My enumeration could not see the difference and I
filed on the low bar without reading twenty lines.

The comparison to `bindtables_test.wac` in the text above is also wrong in the way that matters: that
table was a fixed 64, which is exactly the case this is not.

Left behind: a comment at the loop stating the invariant, so the next reader — quite possibly me —
does not re-file this. The finding was worth ten minutes; the wrong issue would have cost somebody an
afternoon.
