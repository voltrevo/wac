# 0343a — two `IntroPoint`s in one package, one holding public keys and one holding secrets

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** design decision
- **Symptom:** none today — a file that needs both cannot name them

`packages/tor` exports the type name `IntroPoint` from two files, and the two are the client's view
and the service's view of one thing:

```wac
// packages/tor/src/hsintro.wac:56 — "as the descriptor gives it"
export struct IntroPoint {
  u8[] linkSpecifiers;
  u8[] onionKey;         // ntor key of the introduction point relay
  u8[] authKey;          // ed25519, the introduction circuit's identity at that relay
  u8[] encKey;           // ntor key of the *service*
}

// packages/tor/src/hsdescbuild.wac:57 — "as the service holds it"
export struct IntroPoint {
  u8[] linkSpecifiers;   // same field, same meaning
  u8[] ntorOnionKey;     // the intro relay's ntor key
  u8[] authSeed;         // ours: the seed for this circuit's auth key
  u8[] encSecret;        // ours: a clamped curve25519 secret
}
```

Four `u8[]` fields each, first field identical in name and meaning, and **three of the second
struct's four are the private halves of the first struct's public ones.** Both are live:
`hsfetch.wac` imports the client one, `hsserviced.wac` and `genhsdesc.wac` import the service one.

`hsdescbuild.wac`'s own doc comment argues the hazard one level down — *"confusing them produces a
descriptor that decodes perfectly and cannot be used, so they are separate fields rather than two
entries in an array"* — about `ntorOnionKey` against `encSecret` **within** the type. The same
argument applies between the two types and nothing states it.

## Why it is filed rather than fixed

Renaming an exported type in `packages/tor` touches three importing files in a package another agent
may be working in, and the right names are a judgement about that package's vocabulary rather than a
mechanical change. `IntroPointRef` / `IntroPointSecrets`, or moving one behind the barrel, are both
defensible and picking wrong is cheap to undo only before someone builds on it.

Nothing is wrong today, for one reason: **no file has yet needed both**, and if one did the compiler
would refuse the second import as a duplicate name and force an alias at the call site — which is
where the reader is least likely to be thinking about which half of a keypair they hold.

## And the same package does it again, with an unused export

`Publication` is exported from `hsdir.wac:442` — the **plan**, `{periodNum, periodLength,
useCurrentSrv, srv, hsdirs}`, which directories to upload to — and from `hsupload.wac:57` — the
**outcome**, `{uploaded, rejected, unreachable, descriptorRefused}`.

`hsserviced.wac` imports both files and takes `Publication` from `hsdir.wac`; from `hsupload.wac` it
takes only `UPLOAD_OK` and `UPLOAD_REJECTED`. So `hsupload.wac`'s `Publication` and its
`publicationState` **have no consumer outside their own file**, and the name they occupy is one the
package already uses for something else. That half is deletable-or-renameable with nothing to break,
and per `CLAUDE.md`'s *when nothing needs a thing, delete it* the question is whether
`publicationState` should be exported at all.

## Notes

Found by sweeping exported type names across `packages/*/src`: **352 exported types under 312 names,
32 names declared in more than one file, and exactly two of the 32 inside a single package** — these
two, both in `tor`. The 30 cross-package ones are ordinary (`Reader` in five packages, `Parsed` in
four) and are not this.

The sweep is the shipped-tree half of the same check `vision/QUESTIONS.md` records for its own files
under *Twenty-one type names are declared twice*, whose conclusion applies here unchanged: **a
duplicate name is the cheapest signal that two files have solved one problem twice.**
