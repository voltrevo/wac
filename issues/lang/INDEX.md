# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0021](open/0021-wacinstance-cannot-return-a-string.md) | `wacInstance` cannot return a `string` — three workarounds exist instead | bug | trap |
| [0018](open/0018-accept-exponent-without-point.md) | should `1e9` be a float literal? (a decision, not a defect) | missing feature | compile error |

## Known gaps that are not issues

Deliberate omissions from the enum design, recorded in `spec/spec/enums.md` under "What
this is not, in this draft". File an issue if you actually need one; they are listed
here so nobody reports them as bugs:

- `match` as an expression (needs result-type unification across arms)
- nested patterns — `case Node(Leaf(v), r)` is one level too deep
- methods on enums (where a user's method would live is unsettled)
- narrowing outside `match` — `if (s is Circle)` does not narrow `s`
- an integer representation for payload-less enums (an optimisation)
- `br_table` dispatch for `match`, which currently uses a comparison chain like
  `switch` (an optimisation)

## Closed

20 issues, 18 of them found by porting wacc's AST to sum types and by probing shapes
that port does not reach. Twelve of the sixteen typechecked cleanly and failed at
instantiation or ran wrong — which is why `README.md` asks you to run the thing.
