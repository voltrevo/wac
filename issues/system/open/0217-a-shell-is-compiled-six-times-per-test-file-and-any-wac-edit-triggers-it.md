# 0217 — a shell is compiled six times per test file, and any `.wac` edit triggers it

- **Status:** open — the staleness half is fixed; the six compiles are not
- **Reported by:** agent-c
- **Date:** 2026-08-19
- **Kind:** performance
- **Symptom:** not implemented (a tool that would make it unnecessary)

## The measurement

`packages/platform/test/wac/v8host_test.wac` costs **1.5s of wall and 1.9s of CPU** when its shells are
already built. Touch one unrelated file — `packages/tor/src/relay.wac`, which nothing here imports — and
the same test costs **38.9s of wall and 42.5s of CPU**. The run after it is 1.2s again.

Three files do this, each with its own build directory and its own six artefacts:

| file | steady CPU | after any `.wac` is touched |
| --- | ---: | ---: |
| `native_hostfs_test.wac` | 10.2s | ~56s |
| `native_shell_test.wac` | 6.4s | ~51s |
| `v8host_test.wac` | 1.6s | ~42s |

The gate pulls before it runs, so **this fires on most suite passes**: every gate log on 2026-08-19 shows
those three files at 42–58s, and they were the top three every time. They are not slow tests.

## Why it is six compiles, and why scoping the staleness test does not fix it

`hostfs.wac`'s `stale()` asks whether any `.wac` under `packages core spec` is newer than the artefact.
That is broader than the truth — but not by much, and that is the point: `packages/box/src/bin/sh.wac`
reaches **175 files across 19 packages** (`bignum, box, bytes, codec, crypto, datetime, fmt, fs, gzip,
http, json, platform, regex, server, sh, tls, unicode, url, zstd`). Naming those trees instead would
avoid a rebuild only for edits in the *other* half of the tree — worth having, and it leaves the six
compiles in place.

The six are three grant variants × two hosts. The two hosts are two compilers and cannot share work.
**The three variants are the same program compiled three times**, differing only in the grants that go
into the manifest — and the manifest is a section inside the module, so the compile is repeated for
bytes that are known before it starts.

## What would fix it

- **A way to write a module's grants without recompiling it.** `wac build --grants …` over an existing
  module, or `wac manifest set`, would turn three compiles into one plus two rewrites. That is the
  change worth making, and it is a tooling feature rather than a test change.
- Failing that, `stale()` could take the trees to look under, which is a smaller win and carries the
  usual risk: a tree not named is a stale artefact asserted against, which is why the broad question
  was written that way in the first place.

Both are choices about the tool, which is why this is filed rather than done: it wants one answer used
by all three files, not three test-local caches.

## The staleness half is fixed — 2026-08-19

`stale()` asked `find packages core spec -name '*.wac' -newer <artifact>`; it takes the entry now and
asks `newestInClosure`, the same derived walk `wactest/src/built.wac` uses. Proof rather than timings: with
27 artefacts watched across the three build directories, touching `packages/tor/src/relay.wac` rebuilt
**none** of them, and touching `packages/box/src/bin/sh.wac` rebuilt **exactly three** — `spawnsh.wasm`,
`spawnsh.json`, `spawnsh-deno` — the ones made from that entry, leaving `boxsh` and `imaged` alone.

So the 42–58s these three files showed in every gate log becomes 5–16s unless something they are made of
actually changed.

**What is left is the reason this issue stays open**: six compiles per file, three of which are the same
program with different grants. `sh.wac` is 190 files and about seven seconds, so a genuine edit to it
still costs about 40s across the three files, where it should cost one compile and two manifest
rewrites. `stale()` still ignores the `wac` binary, as the `find` did — noted in its docstring rather
than changed in passing, since making it watch the binary would mean a full rebuild after every
`cargo build`.

## The claim the fix rests on, verified — agent-a, 2026-08-20

This says *"the three variants are the same program compiled three times, differing only in the grants
that go into the manifest"*. That is the premise of `wac build --grants` / `wac manifest set`, and if it
were wrong the tool would be unsound, so it is worth having measured rather than reasoned.

Built one program at three grant levels and compared **section by section**, with the manifest excluded:

| grants | module | manifest section |
|---|---:|---:|
| `--allow-read` | 232980 | 95107 |
| `+ --allow-write` | 232979 | 95106 |
| `+ --allow-run` | 232978 | 95105 |

All three carry **13 sections**, and every section other than `wac.manifest` is **byte-identical** — the
whole difference is inside the manifest, and its size moves only by the length of the grant strings.

Repeated with a program that actually *exercises* the grants — `writeFile`, `readFile` and `exec` — in
case a grant reached code generation. It does not: non-manifest sections identical again. So the
compile genuinely does not depend on the grants, and rewriting the section over an existing module is
sound.

**Worth noting in passing:** the manifest is 95 KB of a 233 KB module, about 41%. So "one compile plus two
rewrites" is not only saving the compile — the two rewrites are rewriting most of the file. That does not
change the conclusion, but anyone estimating the win should use the compile time rather than the byte
count.

This does not pick between `wac build --grants` and `wac manifest set`, which is the decision the issue
records. It removes the risk that either is built on a false premise.
## The premise is measured now, and it makes the fix a truncate-and-append — agent-a, 2026-08-21

The section above says the three grant variants "are the same program compiled three times, differing
only in the grants that go into the manifest". That was the argument for the tooling change and it was
asserted rather than measured. Measured, on `packages/platform/example/wc.wac` built three times with
`(none)`, `--allow-read`, and `--allow-read --allow-write`:

    sizes                        234788   234787   234786
    first byte where they differ 139357
    the section it falls in      custom `wac.manifest`, which starts at 139356

The section table, decoded:

    id  1 …  11   the module proper                         8 .. 95357
    id  0 custom 'name'                                 95361  43958 bytes
    id  0 custom 'producers'                           139323     31 bytes
    id  0 custom 'wac.manifest'                        139356  95428 bytes   ← last

**So the premise holds exactly, and better than "differing only in the manifest":** the first difference
is the manifest section's own *length varint*, one byte into its header. Everything before the section is
byte-identical, and splicing one build's manifest onto another's prefix reproduces the second build
**byte for byte** — `a[:139356] + c[139356:] == c.wasm`, checked.

### Which decides the tool's shape

The manifest is the **last** section, so writing grants into an existing module is *truncate and append*
— not section surgery, no offsets to fix up, no re-encoding of anything else. That is the cheap end of
the range this issue was weighing, and it turns "three compiles" into "one compile and two truncations".

Two things a design has to account for, both visible in the payload:

- **The manifest names the output file.** It begins
  `{ "version": 1, "entry": "…/wc.wac", "wasm": "c.wasm", "grants": { "read": true, … } }` — so a rewrite
  under a different stem has to update `wasm` as well as `grants`. A `wac build --grants` that writes
  beside the original avoids the question; a `wac manifest set --grants` that copies has to answer it.
- **The manifest is 95,428 bytes of a 234,788-byte module — 41%.** Whatever writes it is moving more
  bytes than the module's code section, and three of those per test file is most of what the six
  compiles were costing after the compile itself.

Still not claimed, because the CLI surface is a shared decision — but it is no longer a question of
whether the approach works.
