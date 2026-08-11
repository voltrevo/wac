# 0095 — wacc: a `case` binding takes its type from a same-named variant in another enum

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** compile error

This is `wacc`'s checker, not the reference compiler. It is a **false alarm**, which is the one
direction `packages/wacc` treats as absolute.

## Reproduction

One file that matches on an enum it *imports*, while declaring an enum of its own that happens to
share the variant's name:

```wac
import { Unzipped, zlibDecompress } from "./zlib.wac";   // Unzipped { Ok(u8[] bytes), Bad(string) }

enum Object {
  Ok(Kind kind, u8[] content),      // a local `Ok`, whose first payload is NOT a u8[]
  Bad(string why)
}

export Object readLoose(u8[] file) {
  match (zlibDecompress(file)) {
    case Bad(why): return Object.Bad("not a zlib stream: " + why);
    case Ok(raw): return parseFramed(raw);      // wacc: code 5, argument type mismatch
  }
}
```

Expected: silence. The reference compiles this cleanly, and rung 3's whole-repo test states the
invariant — *"this slice reports nothing that depends on another module, so the import graph is not
needed to know that we should be quiet about all of them"* (`typecheck.test.ts:130`).

Actual: `raw` is typed as `Kind`, and every use of it is reported. Five diagnostics of code 41 (*an
index must be an integer*) when the arm indexes it, or one of code 5 when it passes it on.

## Where

`armBindingType` in `packages/wacc/src/check.wac:3507`. It resolves the arm's variant by **bare
name** against the local table:

```wac
i32 owners = 0;
for (i32 i = 0; i < c.variantCount; i++) {
  if (c.variantNames[i] != variant) { continue; }
  owners = owners + 1;
  owner = c.variantOwners[i];
}
if (owners != 1) { return typeNone(); }
```

The function already guards the two-local-enums case, and its comment says why: *"the table is keyed
by bare name, so `Ok` from two enums is one struct holding both payloads, and a binding typed from it
belongs to neither."* That guard is `owners != 1`. It does not fire here, because the **imported**
enum is not in the table at all — so exactly one enum declares `Ok` as far as this checker can see,
and it is the wrong one.

So the count is not the question. The question is whether the variant belongs to the enum the
*subject* is, and when the subject's type is unknown the answer is not knowable — which makes
`typeNone()` the only sound reply.

## Notes

**This is provenance again**, the shape `5af405d1`, `a6890134` and `87a88d36` all landed fixes for:
an answer keyed on the name somebody wrote rather than on which declaration was meant.

The fix wants the subject's type at the call site — `check.wac:2412` declares the binding, and if the
match subject's type is `typeNone()` then no arm binding in that match can be typed, whatever the
local table says. That is a stronger rule than counting owners and would subsume it.

Worth checking while there: `armBindingType`'s sibling questions — arity (`c.variantArityIn`) and
exhaustiveness — resolve variants the same way and may have the same hole. A file matching on an
imported enum whose variant names collide with a local enum's is the shape to try.

**How it was found.** Writing `packages/git`, whose `object.wac` imports `zlib.wac`'s
`Unzipped { Ok, Bad }` and declared its own `Object { Ok, Bad }`. The package now names its variants
`Read`/`Unreadable`, which is better on its own terms — wac scopes a variant name to its file, so two
*local* enums could not share `Ok` at all, and an imported one clashing is the same problem a step
removed. So nothing is blocked on this. But the next file to hit it will not have that excuse, and
the diagnostic gives no hint: it reports a type error about a name whose declaration is in another
file, at a position where nothing looks wrong.
