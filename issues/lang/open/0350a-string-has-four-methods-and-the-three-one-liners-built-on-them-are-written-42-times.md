# 0350a — `string` has four methods, and the three one-liners built on them are written 42 times

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** missing feature
- **Symptom:** none — 42 declarations of three functions, under twelve names

`packages/wacc/src/check.wac`'s builtin table is the authority on what a `string` can do:

```wac
if (name == "len")      { return "i32"; }
if (name == "indexOf")  { return "i32"; }
if (name == "slice")    { return "string"; }
if (name == "toBytes")  { return "u8[]"; }
```

Four, plus the statics `fromBytes` and `fromCodepoint`. **There is no `startsWith`, no `endsWith` and
no `contains`** — and all three are one line on top of what is there:

```wac
bool contains(string s, string t)   { return s.indexOf(t) >= 0; }
bool startsWith(string s, string p) { return s.len() >= p.len() && s.slice(0, p.len()) == p; }
```

Swept `packages/*/src` and `tools/` for a `bool` or `i32` function taking a `string` or a `u8[]` whose
name is one of those three ideas: **42 declarations across 33 files, under twelve names.**

```
holds 9   startsWith 8   contains 7   endsWith 5   endsWithSlash 3   hasSuffix 3
mentions 2   startsWithPath 1   hasDotName 1   namedInTable 1   hasSegment 1   hasPrefix 1
```

By tree: `tools/` 24, `tor` 5, `wac` 3, `wactest` 3, `wacpkg` 2, `box` 2, `wacc` 2, `ssh` 1.

## The compiler's own type checker is one of them

`packages/wacc/src/check.wac:38` imports `endsWith` from `./path.wac`, and uses it to decide whether a
type name ends in `?` or `[]`:

```wac
bool isNullableName(string n) { return endsWith(n, "?"); }
if (endsWith(core, "[]")) { core = dropLast(core, 2); suffix = "[]" + suffix; }
```

So the file that decides what methods a `string` has is itself working around three of them being
absent.

## Why it is a decision

Two places it could go and they are not equivalent:

- **Builtins**, beside `indexOf`. They are emitted as internal wasm functions
  (`spec/spec/strings.md`: *"indexOf) are emitted as internal wasm functions in the module. Unused
  string …"*), so three more is three more in every module that uses them and nothing in one that
  does not. It makes them available to `packages/wacc` itself, which a library cannot — the compiler
  may not import `core`.
- **A library**, which is where `CLAUDE.md`'s *when nothing needs a thing, delete it* would point,
  except that nothing needs a thing **42 times**. `core` is the natural home and is the one place
  `wacc` cannot reach, so a library answer leaves the compiler's two sites unfixed and splits the
  convention.

The second question is `u8[]`. Five of the 42 take bytes rather than a string, and `u8[]` has no
`indexOf` at all, so the one-line derivation does not exist there. A `Bytes`-shaped answer is a
different piece of work and `vision/core/slice.wac` is where this exercise put it.

## Notes

The count is names-based and is a floor: a predicate spelled as an inline `s.indexOf(t) >= 0` at the
call site is not a declaration and is not counted. `tools/` holding 24 of the 42 is the same
concentration `issues/system/0348a` found for duplicated bodies there, and both have the same cause —
`tools/wac/` has no shared module.

Found while asking what a same-name diff between the two trees cannot see, which is a method nobody
ever wrote. `issues/lang/0347a` is the other answer to that question.
