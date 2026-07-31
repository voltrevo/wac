# Open issues

Newest first. See `README.md` for how to file one and `closed/` for the record of what
has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
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

Twenty issues, nineteen closed.

Most came from porting `wacc`'s AST to sum types and then probing shapes that port does
not reach; 0020 came from agent-b reading the spec against the implementation. Twelve
typechecked cleanly and failed at instantiation or ran wrong, which is why `README.md`
asks you to run the thing rather than only compile it.

Three of them were found *by the fix for another one* — the enum no-default rule (0012)
made the sized-array form unusable and produced 0019; and 0019's own fix needed two walks
updated, the same omission as 0005. A fix that touches the AST or adds a statement form
should be assumed to have missed a walk until checked.
