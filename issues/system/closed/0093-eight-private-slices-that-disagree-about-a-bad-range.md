# 0093 — eight private `slice`s, and they disagree about a bad range

- **Status:** closed, 2026-08-07
- **Claimed by:** agent-a, 2026-08-07 — taking the "both, named" answer
- **Reported by:** agent-a
- **Date:** 2026-08-06
- **Kind:** bug
- **Symptom:** wrong answer

Eight packages carry a private `u8[] slice(u8[], i32, i32)`. That much is ordinary duplication. What makes
it an issue is that **they have already drifted into four different answers for an invalid range**, so the
same call with the same arguments traps in one package, returns empty in another, and returns a short array
in a third.

| file | `from < 0`, `to > len` | `to < from` |
| --- | --- | --- |
| `packages/tor/src/microdesc.wac`, `packages/tor/src/relayd.wac`, `packages/ens/src/ens.wac` | traps | traps (negative length) |
| `packages/tls/src/x509.wac`, `packages/tor/src/hsdesc.wac` | returns empty | returns empty |
| `packages/ssz/src/container.wac` | traps on the read | returns empty |
| `packages/http/src/incoming.wac`, `packages/server/src/routes.wac` | traps on the read | returns empty |

Twenty-nine call sites between them.

## Why this is a decision rather than a patch

Which behaviour is right is not obvious, and the answer changes what callers may assume:

- **Trap.** A slice past the end is a bug at the call site, and this repo's stance elsewhere is that a gap
  should fail rather than be approximated. Moving `x509` and `hsdesc` to this would turn a currently
  swallowed bad call into a crash — which is the point, but it is a live behaviour change in a parser that
  reads attacker-controlled bytes, and "it now crashes on input it used to tolerate" is exactly the thing to
  decide deliberately rather than discover.
- **Return empty.** Total, and a parser can carry on — but a caller cannot tell "nothing there" from "your
  arguments were wrong", which is the conflation `packages/mpt`'s `ok`/`present` split exists to avoid.
- **Both, named.** `slice` that traps and `clamped` that does not, so the call site says which it means.
  Most likely right, and the most work: twenty-nine call sites have to be read rather than rewritten,
  because which one each wants is the whole question.

## Where it should live

`packages/bytes`, which is the leaf every one of these already depends on transitively.

## Note

Found while deleting five private `itoa`s for the same reason — those *had* drifted in a way that cost:
the i32-minimum bug was fixed in four copies separately (GitHub wac-mono#6), and two `packages/ssh` copies
still returned `""` for a negative until today. `slice` has not cost anything yet. It is filed rather than
fixed because the fix has to pick a semantics for other people's parsers, and picking wrong is expensive to
undo.

## Closed: two names, and twenty-eight copies gone

`packages/bytes/src/slice.wac` has both, and each says in its own doc comment what it is for:

- **`slice`** requires `0 <= from <= to <= s.len()` and traps otherwise, *before* the read rather than
  during it. The old naive copies trapped by accident, which is not the same thing: a caller could not
  tell a stated precondition from an overlooked one, and an inverted range trapped on a negative
  allocation with nothing to read in the message.
- **`clamped`** takes any two integers and answers with whatever part of the range exists.

**Twenty-eight copies, not eight.** Nine in `src` — `packages/http` had two, and `packages/box`'s
`lib/bytes.wac` exported a tenth that eleven files imported — and eighteen more in test wac files, which
is where a copy is least likely to be looked at and most likely to be pasted from.

**Which one each site got was decided by reading, not by rewriting.** Every `src` caller of the four
clamp-only copies already validates its range: `ssz`'s `rootAt` refuses a span outside `data` before it
slices, `http`'s two body reads compare `input.len() - at` against the length and answer Incomplete, and
`server/routes` scans the same array it slices. Those all take `slice`, where the trap is now an
assertion on the check above it. The two parsers that answered a bad range with an empty array —
`tls/x509` and `tor/hsdesc` — take `clamped`, because a certificate and a hidden-service descriptor are
attacker-supplied and refusing beats aborting. That was already their behaviour; it is now a choice with
a name on it rather than a check hidden inside a helper.

**No behaviour changed anywhere.** Every file kept the semantics its private copy had. What changed is
that the call site says which semantics it is asking for, and there is one implementation to fix if
either is wrong.

`packages/bytes/test/bounds.wac` covers both, one entry point per refusal because a trap ends the
module: the three ranges `slice` refuses, the empty-slice-at-the-end boundary that must *not* trap, and
the same three ranges answered by `clamped`.
