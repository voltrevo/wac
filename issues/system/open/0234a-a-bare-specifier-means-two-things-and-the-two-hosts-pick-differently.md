# 0234a — a bare specifier means two things, and the two hosts pick differently

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a, from GitHub issue 22's Deno-host case study
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** wrong answer — one host compiles a different file than the other, silently

## What the spec says

`spec/spec/imports.md` says both halves plainly:

> Import paths are relative, using `./` or `../` prefixes — except `core`, which is not a path

> `[§wac-import-mapped-6np2rkq]` A specifier that is neither relative, nor `@/`, nor a built-in **may
> name a mapping** declared in the project's `wac.json5`.

So `dep/lib.wac` is a mapping name or it is nothing. It is not a relative path, because a relative path
starts with `./` or `../`. Nothing in the spec makes a bare specifier fall back to path arithmetic.

## Reproduction 1 — the Deno host compiles a file the manifest did not name

    wac.json5        { imports: { "dep/": { git: "https://example.invalid/dep.git", ref: "main" } } }
    src/dep/lib.wac  export i32 two() { return 99; }
    src/main.wac     import { two } from "dep/lib.wac";
                     export i32 main() { return two(); }

    $ deno run -A packages/platform/native.ts src/main.wac -o m
    m.wasm  4K  0 callback signatures
    $ wac m.wasm ; echo $?
    99

`dep/` is a declared mapping with no lock entry, so there is nothing it can legally resolve to. The walk
joined the name to the importing file's directory instead, found `src/dep/lib.wac`, and compiled it.
**Exit 0, no diagnostic, the wrong file.** `wac build` on the same project refuses and names
`wac update`.

`harness/wacFiles.ts`'s walk is where it happens — the `resolveFrom(fresh[i], spec)` line that every
non-`@/` specifier reaches. `packages/wac/src/wac.wac` chose the other order and says why, in the
comment right where it decided:

> A mapping is tried before the path arithmetic, because a specifier like `dep/lib.wac` is a legitimate
> relative path *and* a legitimate mapping name — and joining it to the importing file's directory first
> would resolve to a file that is usually not there and **occasionally is, which is the worse of the two
> failures**.

This is that failure, in the host that did the joining. Without a `src/dep/` directory it is merely a
confusing message — GitHub issue 22 reported that half: *"No such file or directory (os error 2):
readfile 'src/dep/packages/json/src/json.wac'"*, a path the author never wrote.

## Reproduction 2 — and the binary accepts a bare specifier the spec does not define

    wac.json5        {}
    src/sub/lib.wac  export i32 two() { return 42; }
    src/main.wac     import { two } from "sub/lib.wac";
                     export i32 main() { return two(); }

    $ wac build src/main.wac -o m
    m.wasm: 4447 bytes from 2 file(s)
    $ wac m.wasm ; echo $?
    42

`sub/` names no mapping, so per `§wac-import-mapped-6np2rkq` there is nothing for the specifier to be.
The binary falls through to path arithmetic and resolves it as though it had been written `./sub/lib.wac`.

## Why this is a decision and not just work

The two reproductions pull opposite ways, which is the whole difficulty:

- Fixing 1 by **refusing every bare specifier** in the Deno walk is what the spec says, needs no
  manifest parsing, and breaks nothing in this repository — every bare specifier here is `core…`,
  `core/…` or `std/platform.wac`. But it makes the Deno host *stricter than the binary*, so it trades a
  parity gap for a new one, and GitHub issue 22 is about the two hosts agreeing.
- Fixing 1 and 2 together — both hosts refuse a bare specifier that no mapping declares — is the
  spec-conformant end state and the operator's stated rule (*better to fail something correct than
  accept something incorrect*). It is also a change to what the shared compiler accepts, so it needs to
  be somebody's decision rather than a side effect of a Deno-host fix.
- Fixing 1 by **resolving mappings in the Deno walk** means a second copy of the manifest and lock
  machinery `wacc.wac` already has. `harness/wacFiles.ts` deliberately finds a manifest and never reads
  one — *"what a `wac.json5` says matters for mappings (D9-D11), and `@/` needs only that it is
  there"* — and duplicating the resolver is what `issues/system/0230a` exists to decide.

## Recommendation

**Both hosts refuse, and the binary's fallthrough goes.** It is the only answer where the two agree and
the spec is what they agree on, and the cost is bounded: no file in this repository imports a bare
specifier that is not a built-in, so the sweep is a predicate and a message rather than a migration. Do
it as one change to both, not as a fix to the Deno side that leaves the binary lenient — a bare
specifier resolving relatively in one host and being refused in the other is worse than either
behaviour on its own.

If that is judged too broad, the fallback is to fix the Deno side alone and record the resulting
strictness gap here, because reproduction 1 compiles the wrong file and that should not wait on the
larger question.

## Notes

Found while measuring the two hosts for `issues/system/0230a`; the flag half of that measurement —
`native.ts` accepting `--allow-bogus` and building anyway — was unambiguous and is already fixed, with
`packages/platform/test/wac/nativecli_test.wac` holding it. This half is here instead because it is a
question about the language, not about one host's argument parsing.
