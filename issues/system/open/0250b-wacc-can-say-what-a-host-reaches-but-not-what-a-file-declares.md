# 0250b — `packages/wacc` can say what a host can reach, but not what a file declares

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-24
- **Kind:** missing feature
- **Symptom:** not implemented

`tools/docSignatures.test.ts` — *every wac name a README quotes exists, and every signature it prints
is the real one* — walks the reference compiler's AST and collects, in its own words at line 102,
**"every name a wac declaration introduces: functions, types, variants, fields, methods."**

`packages/wacc`'s public API cannot produce that set. It can produce two neighbouring ones:

| `api.wac` | what its own doc comment says it answers |
|---|---|
| `exportSigsFiles` | *"the exported functions and their wac types"* — *"which functions a host may call"* |
| `bindTypesFiles` | *"the structs and enums a host can hold"* |
| `names` | *"the emitted functions in order, so a wasm 'function #N' can be turned back into a name"* |

All three are scoped to **what crosses the host boundary**. None of them mentions a non-exported
function, a method, or an enum variant, and those are exactly what the third row of the table below
is missing.

## Reproduction

Not a program — a set difference. For any package:

```
exportSigsFiles(paths, sources, entry)   -> exported functions only
```

against what a README may legitimately name in prose:

```wac
// packages/anything/src/thing.wac
struct Thing {
  u8[] bytes;                      // a field — `bindTypesFiles` has it
  i32 measure(const this) { … }    // a method — nothing has it
}
enum Answer { Ok, Refused }        // variants — nothing has them
i32 helper(i32 n) { … }            // not exported — nothing has it
```

Expected: an API that answers *what does this program declare*.
Actual: three APIs that answer *what can a host reach*, which is a subset.

## Notes

**Why it matters now.** `issues/system/0161` lists `docSignatures.test.ts` (377 lines) as convertible
"once someone decides on purpose" that holding READMEs to wacc's parser rather than the reference's is
the check we want. That framing is right and incomplete: on today's API the port would keep the
```wac-fence check intact and quietly narrow the **prose** check, which is the half that resolves a
backticked `` `foo(…)` `` against the declaration set. That half is the one that found both original
bugs — a signature that had gone stale and a `gzipBytes` that never existed — and narrowing it is not
the change anyone would be deciding on.

**The rendering half already exists.** `packages/wacc/src/print.wac` exports `printProgram`, and
`parse.wac` produces the AST it prints. What is missing is a public entry that walks a program and
emits one line per introduced name with its rendered signature — the same tab-separated shape
`exportSigsFiles` already uses, so a caller can parse it the same way.

**Not filed as a bug, and not a gap in `docSignatures`.** wacc's API is scoped the way it is on
purpose: it exists to be a compiler and a bindgen source, and neither job needs the private surface.
This is a request for one more thing it happens to be uniquely able to answer.

**Filed rather than done** because it is an addition to another package's public API, and
`issues/system/README.md` is explicit that a package someone else is working in gets an issue rather
than a commit. `packages/wacc` churned 173 lines out and 146 in over eighteen hours the last time
`0161` measured it.
