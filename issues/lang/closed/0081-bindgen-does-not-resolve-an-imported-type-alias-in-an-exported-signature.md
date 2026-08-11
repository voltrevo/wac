# 0081 — bindgen does not resolve an imported type alias in an exported signature

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** b1ad3005
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac/issues/10](https://github.com/voltrevo/wac/issues/10)
- **Mirrored by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** compile error

An ordinary imported type alias used in an exported signature is not resolved by bindgen.

**Not reproduced here** — the reporter's example is two files, and the reproduction belongs beside the
fix rather than in a stub. See GitHub for it, and for discussion.

## Reproduction

Reproduced here from the description, since the fix wanted one beside it:

```wac
// ---- lib.wac ----
export struct Point { i32 x; i32 y; }
// ---- main.wac ----
import { Point as P } from "./lib.wac";
export P mk() { return P(2, 3); }
export i32 sum(P p) { return p.x + p.y; }
```

The module is fine. `wacBindgen` writes:

```
mk() — return type 'P' not yet supported in bindgen
```

## Resolution

`typeStr` spelled a struct with whatever the use site wrote, so the export recorded its return type
as `P` — the alias — while the struct table it is looked up in said `Point`. Nothing was unsupported;
the two halves of the metadata disagreed about the name of the same struct.

Every type in the metadata is spelled through one map now, from type index to the name the struct
table is keyed by, so a field, a parameter, an export and the table say the same thing. The map is
the one `0080` introduced for helper names, which is why the second half of `0100` came with it: two
modules each declaring an `S` are `S__a` and `S__b` in every one of those places, rather than `S`
twice.

**wacc had this right already** — `waccx bindgen` on the same two files writes `mk(): Point` and
`sum(a0: Point)` — so this was the reference disagreeing with the other compiler as well as with
itself.

`compiler/wacBindgen.test.ts` is new and is the first thing in the repository that *runs* what
bindgen writes: it generates the glue, imports it as a host would, and calls it. Both of its tests
fail without this change.
