# 0393a — A generic tag function (`T first<T>(T[] kids)`) and markup in a static initialiser are refused

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-21
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

```wac
import { markup } from "core";
enum Tree { Leaf(string t), Many(Tree[] k),
  Tree [markup.text](string t) { return Tree.Leaf(t); }
  Tree [markup.fragment](Tree[] k) { return Tree.Many(k); } }
T first<T>(T[] kids) { return kids[0]; }
static Tree TOP = <>x</>;
export i32 f() { Tree x = Tree.Leaf("a"); Tree t = <first>{x}</first>; return 1; }
```

Expected: both accepted: a tag "calls the function `t` in scope" (`§wac-markup-tag-is-function-vv4pvhq`), and `first([x])` compiles.
Actual: the generic tag is refused with a message saying generic tags are not supported (case 0747); the static says it cannot be evaluated statically yet.

## Notes

Two features: type-argument inference from attributes and children, and static evaluation of markup (tag calls by parameter name, `K.[markup.*]`).
