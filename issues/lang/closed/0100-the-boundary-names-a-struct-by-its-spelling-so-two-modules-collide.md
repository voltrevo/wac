# 0100 — the boundary names a struct by its spelling, so two same-named structs are one to a host

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** b1ad3005 (the reference), dfa6c8e0 and ff7bbe76 (wacc)
- **Claimed by:** agent-b, 2026-08-11
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

## Progress, 2026-08-11 — parts 1 and 2 are fixed in `b1ad3005`

Fixed while closing `0081`, which was the same root arriving from the other side: an imported alias
made a signature say `P` where the table said `Point`.

Every type in the metadata is spelled through one map from type index to the name the struct table
is keyed by, so an exported signature now says `S__a` and `S__b` and a lookup cannot answer with the
wrong struct (part 2). A display name that two of them share falls back to the unique `bind` name
for **both**, so the glue declares `S__a` and `S__b` rather than `S` twice (part 1).

`compiler/wacBindgen.test.ts` runs the generated glue for that program and checks each function
comes back as the class for *its* struct — `a()` has no `z`, `b()` has no `x` — which is the wrong
answer this pair exists to rule out.

**Part 3 is still open, and it is the whole of what is left:** wacc names the second declaration of a
name with a counter (`$bind$s_S@2_new`, the first keeping the bare `S`) where the reference now names
both by their file. So the two compilers disagree about what a host should call these, and wacc's
spelling depends on which declaration was met first — which is what the native manifest cannot
tolerate, since it keys a struct by this name. wacc already has `qualifiedName(env, name)`, which
turns its key into the reference's spelling; what it lacks is knowing that a bare name is *ambiguous*
rather than that this declaration was the second one.

## Progress, 2026-08-11 (second) — wacc's helper names agree, in `dfa6c8e0`

`Env.ambiguousDecl` answers the question the emitter needed — is this *name* declared more than once
— rather than the one its key answered, which was whether this declaration was the second one. Where
it is ambiguous, the helper exports and the `bind` column of the metadata both take `qualifiedName`.
Those two had to move together: the glue finds its helpers through that column.

The two compilers now emit **byte-identical** bind names for the same input, path-dependent tag and
all.

**What is left, and it is now one thing:** wacc's metadata still carries its internal key in the
*type* column — `S` and `S@2` — where the reference carries the identity. So `waccBindgen` writes:

```ts
export class S { …
export class S@2 { …          // not an identifier, so the file does not parse
export function b(): S@2 {
```

The helpers those classes call are right; their names are not. The fix is the same shape as the
reference's: spell the type column through the same qualification, and let a shared display name
fall back to the unique one when two of them collide.

**A property both compilers share, worth writing down:** the qualification uses the file path *as
given*, so compiling the same sources through an absolute path produces
`S___tmp_claude_1001_…_a` where the same program compiled relatively produces `S__a`. The two
compilers agree with each other either way, and every qualified name in the system has always
behaved like this — a generic instance is `Vec__packages_std_src_vec$string` for the same reason.
It only becomes a problem if a manifest built in one place is read against a module built in
another.

## Resolution — all three, 2026-08-11

The last piece was wacc's *type* names, in `ff7bbe76`. `metaNameOf` qualifies a key by its declaring
file when the name is ambiguous, and `metaTypeSpelling` applies that to every name inside a composite
— `S[]`, `S?`, `fn[S(i32)]`, `Vec<S>` — by rewriting the spelling rather than repeating the walk that
produced it.

**The interesting half was the second bug behind it.** With the type column fixed, the class names
came out legal and unique and every export was still *unbound*: the signatures said `S` and `S@2`
while the struct table said `S__a` and `S__b`. `exportSigsLinked` builds its own `Env` and had never
collected the file paths, because nothing in that pass had needed them — so `qualifiedName` found no
path and returned the bare key. **A qualification with nothing to qualify by does not fail; it
answers with what it was given.** That is what made this a second bug rather than an obvious one, and
it is worth remembering next to the first: both halves of this issue were a name that looked like an
answer.

Where the three parts landed:

* the generated glue declaring one class twice — the reference in `b1ad3005`, wacc in `ff7bbe76`
* an exported signature that cannot say which `S` it means — same two commits
* wacc's counter (`$bind$s_S@2_new`) against the reference's file qualification — `dfa6c8e0`

Both compilers emit byte-identical bind names for the same input, and both generate glue that
imports, calls, and comes back with each function bound to *its* struct's class — checked by
`compiler/wacBindgen.test.ts` and `packages/wacc/test/bindgen.test.ts`, which run what they generate.

The path-dependence noted above is unchanged and shared: the tag comes from the path as given, so the
same sources compiled through an absolute path spell it differently from a relative one. The two
compilers agree either way. It would only bite a manifest built in one place and read against a
module built in another, which is worth a separate issue if anyone ever does that.
