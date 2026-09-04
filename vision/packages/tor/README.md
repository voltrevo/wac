# tor — measured, not rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/tor`: **16,291 lines** across `src/`, the largest in the tree after the
compiler. Nothing here rewrites it. One type is written out —
[`src/verdict.wac`](src/verdict.wac) — because it is the one that carries the whole argument.

Same form as [`box`](../box/) and [`crypto`](../crypto/): a count and a proposal rather than a
package.

---

## Why this one, and why not a rewrite

Fifteen packages have been rewritten here and the largest original was 2,544 lines. `../README.md`
says the exercise is good at finding *"a rule that turns out to be unusable at scale"* — and it has
never been at scale. Sixteen thousand lines is where a rule that costs a little per site starts
costing.

Rewriting it would take a week and produce a sketch nobody would read. Counting it took an hour and
produced a number.

## What a failure is worth in the largest package in the tree

Across `packages/tor/src`:

| | |
|---|---:|
| lines | 16,291 |
| `trap` sites | 41 |
| result types carrying `bool ok;` | 13 |
| failure paths that collapse into one of those bits | **64** |
| failures that carry a **reason** | **1** |

Sixty-four places where the code knows exactly what went wrong and answers `false`.

**`parseExtend2` is the case to look at**, in `relaycircuit.wac` — 47 lines with eleven distinct
refusals, all `return bad;`:

    payload.len() < 1              a truncated cell
    n == 0                         no link specifiers
    at + 2 > payload.len()         a specifier header past the end
    at + 2 + length > …            a specifier body past the end
    length != 20                   a legacy identity the wrong size
    length != 32                   an Ed25519 identity the wrong size
    type == LS_IPV4 && length != 6 an IPv4 specifier the wrong size
    legacyCount > 1 || edCount > 1 a duplicated identity
    at + 4 > payload.len()         no handshake header
    at + hLen > payload.len()      a handshake past the end
                                   — and one more

Its header says why it matters that this is a *relay* refusing: *"a relay that could read it would be
able to impersonate the hop it is extending to."* A relay that refuses an EXTEND2 cannot tell a
truncated payload from a duplicated identity, and those are different facts about the peer — a bug,
an attack, or a version skew. Eleven of them arrive as one bit.

## The one that carries a reason is a sum type written by hand

`Verdict`, in `consensus.wac`:

```wac
export struct Verdict {
  bool ok;
  i32 goodSignatures;
  i32 needed;
  /** Empty when the document is current; otherwise why it is not. */
  string stale;
}
```

Four fields, and which two mean anything depends on which failure happened. `relayd.wac` knows that
and writes the discrimination out:

```wac
string why = v.stale != "" ? v.stale
                           : itoa(v.goodSignatures) + " good signature(s), " +
                             itoa(v.needed) + " needed";
```

`stale != ""` is a tag. The two integers are one variant's payload and the string is the other's.
Nothing checks that a reader looks at the matching pair, a third reason is a third field and a
longer ternary, and a caller that forgot the new branch would print a signature count for a document
that was never about signatures.

**So the demand is not hypothetical and it is not a matter of taste.** Somebody needed two failure
reasons kept apart, had no way to declare that, and built one out of a boolean and an emptiness
test. [`src/verdict.wac`](src/verdict.wac) is the same information as `Result<void, Invalid>` with
the compiler holding the correspondence, and it is shorter.

It also surfaces something the shipped struct hides: `goodSignatures` is meaningless when `ok` is
true and is only ever read on the failing path. **A field that means nothing in the success case is a
payload in the wrong place**, and the struct-with-a-flag shape is what let it sit there.

## The counter-evidence, which is the honest half

**Nobody has complained.** `packages/gzip`'s `issues/system/closed/0102` is a filed issue about
exactly this loss — a caller that cannot tell a broken disk from a corrupt archive — and its
resolution priced the fix at *"threading a status back through every symbol read"*. There is no
0102 for tor. Sixty-four sites, sixteen thousand lines, a working onion router, and not one issue
saying the bit was not enough.

Three readings, and they are not equally likely:

- **The reasons genuinely do not matter.** A relay that cannot parse a cell drops it, and which way
  it was malformed changes nothing it does next. This is the strongest case and it is real for
  perhaps half of the sixty-four.
- **They matter and nobody has hit it yet.** A relay with no diagnostics is fine until someone has
  to debug an interop failure against C tor, and then eleven refusals reading as one bit is exactly
  the wrong shape. `Verdict` exists because that moment arrived once.
- **They matter and the cost of carrying them stopped anybody trying.** Which is what 0102 says
  happened in `gzip`, in as many words, and is unprovable here because nobody wrote it down.

**The measurement supports the demand and not the harm.** Sixty-four is a real number about how
often the language's answer to failure is one bit; one filed issue is a real number about how often
that has cost anybody. Both belong in the argument and the packages README had only the first kind.

## What could not be written

**How wide an error set gets at this scale, which is the question I came to ask and did not answer.**
The plan was to find out whether `try`'s membership rule survives sixteen thousand lines — whether a
`connectRelay` at the bottom and a `bootstrap` at the top end up with a fifty-member union in every
signature between them. It is unanswerable from this tree, because **there are no error values to
propagate.** You cannot measure how a union composes across twelve layers when eleven of them return
a boolean.

That is a finding about the exercise rather than about tor: *the scale test needs a codebase that
already types its failures*, and this repository does not have one. Answering it means writing the
propagation, which is the rewrite this file declines.

**Whether a relay should carry reasons at all** is a security question and not mine. A refusal that
says *why* is a refusal that tells a prober which of eleven checks it failed, and an onion router is
the one program in this tree where that is a real consideration rather than a hypothetical one. The
answer is probably "log it, never send it", which is a distinction `Result` does not make and the
type would need a convention around. Nothing in `vision/` discusses a fault that is safe to record
and unsafe to return.

**`trap` at 41 sites went uncounted against anything.** Whether those are the *right* 41 — a trap
being correct where a program genuinely cannot continue, per `Result.orTrap`'s comment — needs
reading all of them, and reading 41 trap sites in an onion router to classify them is a day's work
with no instrument behind it.
