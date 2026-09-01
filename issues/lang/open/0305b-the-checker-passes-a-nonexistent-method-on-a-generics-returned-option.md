# 0305b — `wac check` passes a call to a method that does not exist, when the receiver is a generic method's returned `Option`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** diagnostic
- **Symptom:** compile error — but from the wrong phase, and only after `check` said the file was clean

## Reproduction

```wac
import { Map } from "core/map.wac";
import { hashString, stringEq } from "core/hash.wac";

export i32 main() {
  Map<string, i32> m = Map.create(hashString, stringEq);
  m.set("x", 7);
  return m.get("x").noSuchMethodAtAll(0);
}
```

    wac check probe.wac    ->  probe.wac: 4 file(s), no diagnostics
    wac build probe.wac    ->  wacc: cannot emit probe.wac — the emitter declined: no method Option<i32>.noSuchMethodAtAll

Expected: `error: no such method`, from the checker, pointing at `noSuchMethodAtAll`.
Actual: the checker is silent and the emitter refuses.

## Why it matters more than a missing diagnostic usually does

`wac check` is the command whose whole promise is "this program is well-formed", and this is a
**false clean**. It is also the shape that wastes the most time: the emitter's refusal names the
method but not the file position, and it arrives wrapped in the enclosing methods it walked through —
what I actually saw first was

    wacc: cannot emit tools/wac/langfuzz.wac — a method Gen.program, declined: a method Gen.statements,
    declined: a method Gen.statement, declined: no method Option<i64>.or

which names three methods that are fine and one that is the real subject, with no line number
anywhere. `check` had passed the same file a moment earlier.

## The rule is wider than this title, and simpler — agent-b, 2026-09-01

**It is not about generics, and not about `Option`.** It is that the receiver's type was never
imported into this file, so the checker has no model of it and says nothing.

One line decides it. The reproduction above, unchanged except for adding `import { Option } from
"core/option.wac";`, **is diagnosed**:

    without the import:   probe.wac: 4 file(s), no diagnostics
    with it:              error: no such method ... no Option.bogusChained

`Option` is never written in that program. It arrives only as the return type of `Map.get`, and a type
that arrives that way is unmodelled unless the file happens to have imported it for another reason.

**Every control below is consistent with that and none of them tested it.** A *named* local of type
`Option<i32>` has to import `Option` to be declared at all; the user-defined generics were declared in
the same file. I read the pattern as "generics are exempt" because every case I built happened to have
the type in scope — the controls agreed with each other rather than with the program.

Checked afterwards and all diagnosed, each with its type in scope: a user generic enum chained through
a function, a substituted return type `Opt2<T>` from a one-parameter struct, the same from a
two-parameter struct at both parameters, a method taking a type-parameter argument, and
`Vec.at(0)` — core `Option`, chained, with the import present.

**So the scope is any library method returning a type the caller did not import**, which is a large
surface: a caller writes `xs.at(0).foo()` or `m.get(k).foo()` without naming the intermediate type,
which is the ordinary way to write those, and gets no check on `foo` at all.

### The mechanism: the type table is scope-based, not graph-based

The same file, asked to *name* the type it is already using:

```wac
Option<i32> x = m.get("x");     // without the import
```

    error: undefined type ... unknown type 'Option'

So `Option` is not merely unmodelled, it is **not in scope**. `core/option.wac` is in the graph —
`core/map.wac` imports it — but the checker registers types per *file scope*: `declareEnum` is called
over the declarations a file can see, under `c.renamed(...)`, so a type the file never imported has no
entry at all. A method call on a value of that type then falls through
`if (recv == typeNone() || recv == "" || …) { return; }`, and unknown-is-silent does the rest.

That silence is deliberate elsewhere and right elsewhere: an unmodelled receiver should not produce
false alarms. What makes it wrong here is that the receiver is not unmodelled anywhere — it is fully
declared, one module away, and only unnameable *here*.

**So a fix is a change to the type model, not a missing case.** Either the table becomes reachable
through signatures rather than through imports, or the lookup resolves a receiver's methods in the
module that declared it when the current scope cannot name it. Both are decisions about what a file
knows, which is why this is left filed rather than patched.

## Notes — four controls, all of which had the type in scope

**Read this table with the section above in mind**: it is what I built before finding the rule, and
every row of it had the receiver's type imported. It shows the checker working, not the gap's edge.

| shape | diagnosed? |
|---|---|
| plain struct — `p.notAMethod(1)` | yes |
| `string` — `s.notAMethod()` | yes |
| **named** `Option<i32>` local — `named.notAMethod(1)` | yes, *"no Option.notAMethod"* |
| user generic `Box<T>`, named and chained — `b.self().notAMethod(2)` | yes |
| user generic returning a *different* generic in `T` — `h.wrap().notAMethod(1)` | yes |
| `Map<string,i32>.get(...)` chained — `m.get("x").notAMethod(0)` | **no** |

What I concluded from it — *"whatever `Map.get` returns is reaching the checker in a form that loses
its methods"* — was wrong, and the section above has the real rule. The reason it looked like a
property of `Map.get` is that `Map.get` was the only row whose type the file had no other reason to
import.

`core/map.wac`'s `get` is the one in the table that is both a **core** type and returns a *different*
core generic substituted with the receiver's type argument. `Vec.get` returns `T` rather than a
generic, so it cannot show this.

## How it was found

Writing `tools/wac/langfuzz.wac` (`issues/system/0161` step 6). I guessed `Option.or` from memory —
the real name is `orElse` — and `wac check` told me the file was clean. The mistake was mine; the
issue is that the tool whose job is to catch it did not.
