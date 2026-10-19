# 0383a — a lambda written as a markup attribute is not emitted

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-19
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Sys } from "std";
import { Node, html.li, html.ul } from "core";
Node Row(Node[] kids, string name, fn<void()> onremove) { return <li>{Node.Text(name)}</li>; }
export i32 main(Sys sys) {
  string removed = "";
  Node n = <ul><Row name="milk" onremove={() => { removed = "milk"; }}/></ul>;
  return 0;
}
```

Expected: compiles; `onremove` is the lambda.
Actual: `wacc: cannot emit … — the function \`__wacMain\` is not in the module the emitter produced — a
lambda (this module has 129, 1 in a position the walk does not type yet, 0 sharing a position key)`.

## Notes

The same lambda bound to a local first and passed as `onremove={f}` works, and so does the rest of the
component — typed attributes, a nullable one left out, children. A markup attribute is a named argument
to the tag's function, and the positional lambda walk does not type that slot; 0382a is the same walk
missing an index assignment. `design/system/0012` writes every event handler in this position.
