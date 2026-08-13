# 0148 — an `app:wacbin` binary re-enters its own entry when the program spawns, so a shell has no applets

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-13
- **Kind:** bug
- **Symptom:** wrong answer, no error

`app:wacbin` builds a wac program into one native executable — the program inside `native/v8`. It is
right for a single-entry program and wrong for one that spawns.

```
$ deno task app:wacbin packages/box/src/bin/imaged.wac --allow-read --allow-write -o imaged
$ ./imaged i.wacimg -c 'echo one two three'
one two three                                    # a builtin: fine
$ ./imaged i.wacimg -c 'seq 3'
usage: imaged <image.wacimg> [-c script | script]
$ ./imaged i.wacimg -c 'sort /dev/null'
usage: imaged <image.wacimg> [-c script | script]
```

Builtins answer. **Anything that spawns an applet prints the binary's own usage** — the spawn
re-enters `imaged`'s entry point with the applet's argv, which `imaged` does not recognise, so it
prints usage and exits 0. Silent: the shell reports no failure and the pipeline yields nothing.

The same program built the other way is correct:

```
$ deno task app:build packages/box/src/bin/imaged.wac --allow-read --allow-write -o imaged-deno
$ ./imaged-deno d.wacimg -c 'seq 1 5 | sort -nr | head -1'
5
$ ./imaged-deno d.wacimg -c 'mkdir /data; seq 1 5 > /data/n'   # 118-byte image on disk
$ ./imaged-deno d.wacimg -c 'cat /data/n | sort -nr | head -1'
5                                                # a new process, the writes survived
```

So the defect is in the `wacbin`/`native/v8` path rather than in `imaged` or the shell.

## Why this matters more than a broken example

`design/system/0001`'s image story — a session's filesystem is a file, and it moves between hosts —
is exercised by `imaged`, and `app:wacbin` is the way to ship it as one file on the primary
platform. Today that combination silently does nothing useful. It is also the case that most wants
a native binary: a shell with applets is the thing you would hand somebody.

`ec5e4e99` made `spawn` take a program's *bytes*, and on the V8 host those bytes are wasm. A
multicall binary spawns *itself* with a different applet name, so the entry dispatch is the suspect:
the child appears to run the embedded seed's `main` rather than resolving the applet.

## Two smaller things found beside it

- The `wacbin`-built `imaged` needs an inherited environment. Under `env -i` it prints usage for
  every input, where a `wacbin`-built `wc` runs fine with nothing inherited.
- `native/v8/seed/` is gitignored, so the invocation `native/v8/build.rs` documents —
  `deno task app:native … -o native/v8/seed/wacc` — fails on the missing directory in a fresh
  checkout until it is created.

## What "done" would mean

1. `./imaged i.wacimg -c 'seq 1 5 | sort -nr | head -1'` answers `5`, built either way.
2. A test that spawns from a `wacbin` binary, since `packages/platform/test/v8host.test.ts` covers
   the host being *handed* a program and not the binary that carries one.
3. A decision on the environment dependency above, or an issue of its own for it.

The oracle is `app:build`, which is correct today.
