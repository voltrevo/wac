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

