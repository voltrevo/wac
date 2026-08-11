# 0100 — the boundary names a struct by its spelling, so two same-named structs are one to a host

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** compile error

The two halves left over from **0080**, which fixed the module itself. Both are about the same
thing: the *helper* name is unique per struct now, and everything above it still says `S`.

## Reproduction

```wac
// ---- a.wac ----
export struct S { i32 x; }
export S mkA() { return S(1); }
// ---- b.wac ----
export struct S { i32 y; i32 z; }
export S mkB() { return S(2, 3); }
// ---- main.wac ----
import { S as SA, mkA } from "./a.wac";
import { S as SB, mkB } from "./b.wac";
export SA a() { return mkA(); }
export SB b() { return mkB(); }
```

`spec/cases/0117` is this program; the module is valid and both compilers run it.

### 1. The generated glue declares one class twice

`wacBindgen` on that module writes `export class S` **twice**, so the file does not compile.

The class name comes from the struct's `display`, which is what the author wrote, and both wrote
`S`. Naming the class from the `bind` field would make the two names unique — but it would not make
the glue *right*, which is the second half:

### 2. An exported signature cannot say which `S` it means

`compiled.exports` names types with `typeStr`, and a struct's `typeStr` is the written name. So both
`a()` and `b()` are recorded as returning `S`, and `wacBindgen`'s own table
(`structsByWac = new Map(compiled.structs.map(s => [s.wac, s]))`) is keyed by that name — last one
wins. Generating a file that *compiles* without fixing this would wire `a()` to `b`'s class: a silent
wrong answer in place of a loud duplicate-class error, which is worse.

The fix is for the exported metadata to carry an identity rather than a spelling — the same
qualified name the helpers now use (`S__a`, `S__b`) — with `display` left alone so the class keeps
the author's word wherever it is unambiguous.

### 3. wacc disambiguates with a counter, and the reference with the file

For the same program wacc emits:

```
$bind$s_S_new $bind$s_S_get_x $bind$s_S_set_x $bind$s_S@2_new $bind$s_S@2_get_y …
```

`S@2` is its internal key for a second declaration of a name — a counter, and the *first*
declaration keeps the bare name. The reference now qualifies both by their file (`S__a`, `S__b`).
So the two disagree about what a host should call these, which is a priority-2 parity gap, and
wacc's spelling is order-dependent in exactly the way the native manifest cannot tolerate: it keys a
struct by this name (`packages/platform/native.ts`, `native/src/manifest.rs`) and has no other way to
tell two apart.

wacc already has `qualifiedName(env, name)`, which turns its key into `S__a` — the reference's
spelling — so the change is which name the bind sites pass, plus knowing that a bare name is
ambiguous rather than that this declaration was the second one.

## Notes

Filed rather than fixed because 0080's own symptom — an invalid module — is gone, and each of these
is a piece of work with its own blast radius: the metadata change touches the format both compilers
emit and every generated file, and the wacc change touches its bind sites and its bootstrap.

Nothing in the repository declares the same struct name in two modules that both cross the boundary,
which is why none of this has been felt. That absence is worth distrusting: it is what hid the whole
family until GitHub wac#9 was reported from outside.
