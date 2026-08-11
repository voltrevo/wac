# 0095 — a struct whose name matches some enum's variant resolves to that enum

- **Status:** closed — fixed 2026-08-11 by agent-b
- **Fixed in:** the commit adding `spec/cases/0094`
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

Two files, because one file cannot hold both names — `spec/cases/0073` says a variant
is a file-scope name and a struct beside it would collide:

```wac
// lex.wac
export enum Kind { Word, Op }

// parse.wac
import { Kind } from "./lex.wac";
export struct Word { i32 n; }
```

Expected: `Word` is the struct `parse.wac` declares.

Actual: in `packages/wacc/src/emit.wac`, `Env.canonType` maps *any* name that some
enum declares as a variant to that enum:

```wac
string canonType(const this, string name) {
  string e = this.enumOf(name);
  return e == "" ? name : e;
}
```

`structType("Word")` therefore answers `Kind`'s type index, while `fieldCountOf("Word")`
still counts the struct's own fields. A `$bind$s_Word_new` built from the two produced a
`Kind` with the wrong number of arguments, which wasm rejects with *"not enough arguments
on the stack for struct.new (need 1, got 0)"* — a diagnostic naming a helper the source
never wrote.

This is `packages/sh` today: `lex.wac` has `enum Kind { Word, … }` and `parse.wac` has
`export struct Word`. `packages/ssh` reaches it the same way.

## Notes

**`canonType` asks a name what it is and gets one answer for two questions.** A variant
is reachable as a bare name, which is why the mapping exists — `is Circle` and `case
Circle:` need it — but a *type* position wants what was declared, and the enum's variant
should not shadow a struct in another file. The fix is for the lookup to take what it is
resolving *for*, or for the variant table to be consulted only where a variant is legal.

Found while emitting the bind-helper families (`issues/lang/0089`): the helper set walked
into it because it asks for a struct's type and its fields separately. `bindableStruct`
now skips a name whose `canonType` differs from itself, so no module is invalid — the
cost is that such a struct gets no `$bind$s_*` helpers at all, which is the right
trade for a host but wrong for the language.

Note `spec/cases/0073` is the one-file version of this collision and is refused. Nothing
refuses the two-file version, so the checker has a matching gap: `§wac-type-name-scope`
would be the clause to read before deciding whether the program is legal at all.

## Fixed — 2026-08-11, agent-b

**The diagnosis above named the wrong thing.** `canonType` is not wrong: it maps a *key* to the enum
that owns it as a variant, and every caller in the emitter resolves a written name to its key first
— `env.keyAt`, which returns `Word@<file>` for a bare name another file already took. Exactly two
callers did not, and they were mine, added the day before this was filed: the `export struct` and
`export enum` roots of `collectBindStructs` read the declaration's token instead of resolving it. So
`packages/sh/src/parse.wac`'s `struct Word` entered the bind set as `Word`, which in that module is
`lex.wac`'s `Kind.Word`, and the helper built a `Kind` out of a `Word`'s fields.

The roots resolve now, and the `bindableStruct` guard that was skipping such names has been narrowed
back to what it is actually for — the two field counts disagreeing — which the corpus confirms is no
longer reachable: 350 files, 342 whole, **0 invalid**, with `sh`'s `Word` getting its helpers rather
than being skipped.

`spec/cases/0094` keeps a struct named like another file's variant working end to end. It passed
before this change as well as after, and it is kept deliberately: it is the program a naive fix to
`canonType` — teaching it to ignore variants — would break, and it says so in four lines.

Worth stating for whoever reads 0096 next to this: the two issues are *not* the same shape after all.
0096 was a checker resolving a bare name it could not see the declaration of; this was an emitter
caller not asking for the key it already had. The lesson they share is narrower than "provenance":
**a table keyed by resolved names will answer an unresolved one, and the answer will look reasonable.**
