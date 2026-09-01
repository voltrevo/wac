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

## Notes — four controls, all diagnosed correctly

The gap is narrow. Each of these gets a proper `error: no such method` from the checker, with a
caret on the call:

| shape | diagnosed? |
|---|---|
| plain struct — `p.notAMethod(1)` | yes |
| `string` — `s.notAMethod()` | yes |
| **named** `Option<i32>` local — `named.notAMethod(1)` | yes, *"no Option.notAMethod"* |
| user generic `Box<T>`, named and chained — `b.self().notAMethod(2)` | yes |
| user generic returning a *different* generic in `T` — `h.wrap().notAMethod(1)` | yes |
| `Map<string,i32>.get(...)` chained — `m.get("x").notAMethod(0)` | **no** |

So it is not "generics", not "chained calls", and not "`Option`" — a named `Option` is checked and a
chained user generic is checked. Whatever `Map.get` returns is reaching the checker in a form that
loses its methods, and I did not narrow past that.

`core/map.wac`'s `get` is the one in the table that is both a **core** type and returns a *different*
core generic substituted with the receiver's type argument. `Vec.get` returns `T` rather than a
generic, so it cannot show this.

## How it was found

Writing `tools/wac/langfuzz.wac` (`issues/system/0161` step 6). I guessed `Option.or` from memory —
the real name is `orElse` — and `wac check` told me the file was clean. The mistake was mine; the
issue is that the tool whose job is to catch it did not.
