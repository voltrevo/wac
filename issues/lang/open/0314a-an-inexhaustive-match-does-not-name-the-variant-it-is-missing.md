# 0314a — an inexhaustive `match` does not name the variant it is missing

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-01
- **Kind:** diagnostic
- **Symptom:** the refusal is right and the message is less than the spec states

## Reproduction

```wac
enum Read {
  Data(u8[] bytes),
  End,
  Failed(string why)
}

export i32 len(Read r) {
  match (r) {
    case Data(bytes): { return bytes.len(); }
    case End:         { return 0; }
  }
}
```

    $ wac build cover.wac -o cover
    error: match does not cover every variant
      --> cover.wac:8:3
       |
     8 |   match (r) {
       |   ^
       = help: add the missing arms, or an `else`

Expected, per `spec/spec/enums.md`: `match does not cover 'Failed'`.
Actual: `match does not cover every variant`, which names nothing.

## The spec states the better message and the case records it

`spec/spec/enums.md` shows a three-variant `Shape` with `Rect` left out and says:

> `[§enum-match-inexhaustive]` This is a compile error: `match does not cover 'Rect'`.

`packages/wacc/test/specCases.json` carries the same string as that case's expected `message`,
beside `"ok": false`.

## Why nothing caught it

The case's `message` is not compared. `specclauses_test.wac`'s header says it plainly about a
sibling: the differentials *"compare parse and lex errors by position, not by text"*, which is how
`unterminated string` sat wrong until 2026-08-18. Messages are pinned only where somebody wrote a
bespoke `t.eqStr` for one — `specclauses_test.wac` has several, and this claim has none.

So `ok: false` passes, the refusal happens, and the recorded expected wording is documentation that
nothing holds anybody to.

## Why it is worth fixing rather than restating in the spec

**The compiler already knows the answer.** It computed the uncovered set in order to decide to
refuse, and then printed a sentence that throws that set away. This is not wording — it is a result
being discarded between the check and the message.

The cost scales with the thing exhaustiveness is for. Three variants and it is a nuisance; fifteen
and the reader diffs the arm list against the declaration by hand. The rule exists so that *adding a
variant finds the code that must change*, and it finds it best when it says which one.

## Not the `else` case

`[§enum-match-else-unreachable]` is a separate claim with its own case, and it is not what this is
about.

## What a fix touches

- wherever the uncovered set is computed for the `match` totality check, so it reaches the message
- the plural: two or more missing variants need a form, and the spec does not state one
- a `t.eqStr` for this claim, so the message is held rather than recorded
- `spec/spec/enums.md` only if the decided wording differs from what it already states
