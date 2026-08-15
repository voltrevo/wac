# 0148 — the V8 native host re-enters the program's own entry when it spawns, so a shell has no applets

- **Status:** closed
- **Claimed by:** agent-c
- **Closed:** 2026-08-15
- **Fixed in:** the commit closing this
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

## It is not `app:wacbin` — it is the host, and that makes it cheap to reproduce (2026-08-15)

`app:wacbin` embeds `native/v8`; it does not *cause* this. Built with **`app:native`** instead and
run through the `wac` binary directly, the same program fails the same way:

```
$ deno task app:native packages/box/src/bin/imaged.wac --allow-read --allow-write -o imaged
$ ./native/v8/target/release/wac imaged.wasm n1.wacimg -c 'echo one two three'
one two three                                    # a builtin: fine
$ ./native/v8/target/release/wac imaged.wasm n2.wacimg -c 'seq 1 5 | sort -nr | head -1'
usage: imaged <image.wacimg> [-c script | script]
usage: imaged <image.wacimg> [-c script | script]
usage: imaged <image.wacimg> [-c script | script]
```

Exit 0, and **once per stage of the pipeline** — `seq`, `sort` and `head` each re-enter `imaged`'s
entry rather than resolving as applets. That repetition is itself the evidence: the count tracks the
number of spawns, not the number of commands typed.

Two things follow.

**The reproduction no longer needs a 64 MB build.** `app:native` writes an 800 KB `.wasm` and a
manifest in a few seconds, against `app:wacbin` linking a whole runtime. Anything written for "done"
below — a test especially — should use `app:native` plus the host binary, which is also the pair that
isolates the fault to the host rather than to the packaging around it.

**And the JavaScript hosts are all correct**, not just `app:build`. The runtime path answers too:

```
$ deno task app packages/box/src/bin/imaged.wac --allow-read --allow-write -- r.wacimg \
    -c 'seq 1 5 | sort -nr | head -1'
5
```

So the split is not built-vs-interpreted and not one build target: **every JavaScript host resolves
the applet and the V8 native host does not.** That is one code path to read.

## First layer, found and fixed: the child was started with no arguments at all (2026-08-15)

`WACV8_TRACE=1` shows the parent reading its own two arguments and then a child asking `argCount`
and being told **0**. Not a wrong applet name — no argv whatsoever. Box's shell, asked for nothing,
exits 0 in silence; `imaged`, asked for nothing, prints its usage.

The cause is a type confusion in the host. The three capabilities that take an argument list do not
agree on its type: `pushChild` takes `string[]`, while `spawn` and `spawnSelf` take **`u8[][]`** —
`packages/platform/src/stream.wac` says why, that an argument is bytes and not text (wac-mono 0065).
All three were read with `read_string_array_bytes`, which calls `$bind$arr_string_len` on whatever it
is given. On a `u8[][]` that call fails, and **every** failure path in that reader returns an empty
`Vec`, so the argv was silently empty. `pushChild` was right by accident of being the one that really
does take text.

The module had always exported what the host needed. `$bind$arr_u8Arr_len` and `$bind$arr_u8Arr_get`
are emitted for any `u8[][]` the boundary reaches; nothing on the Rust side ever asked for them.
Fixed by adding `read_bytes_array` and using it in the two spawn arms only. The trace now reads
`argCount -> 3`, `arg(0) -> "seq"`, `arg(1) -> "1"`, `arg(2) -> "3"`.

**Why `wac sh` always worked, and why that hid this.** The embedded seed is
`packages/box/example/boxsh.wac`, which dispatches applets **in-process through `pushChild`** — the
one caller whose type matched. `packages/box/src/bin/sh.wac` and `imaged` use `spawnSelf`, which is
the broken one. So the shell in the binary and the shell in the tests exercised the good path, and
the sealed/applet tests stayed green throughout. Anything written to cover this has to spawn, not
push.

## Second layer: `PARENT_FS` is a channel number, and this host allocated it as a socket

With argv arriving, a second fault became reachable for the first time — every applet trapped:

```
$ wac boxsh.wasm true
wac: packages/box/src/bin/sh.wac trapped
Uncaught Error: recv on something that is not a connected socket or a child
```

**No spawn is needed to see it.** `wac boxsh.wasm true` is one process running one applet, which is
what shrank the reproduction from a shell, a pipeline and a child to a single command. `pwd` — not a
box applet — behaves, because it never reaches the applet path at all.

`boxApplet` calls `Fs.fromParentOrHost`, which asks on `Chan.of(cli, PARENT_FS)` precisely to find
out *whether there is a parent to ask*; `packages/fs/src/fs.wac` reads a null back as "use the
host's filesystem". `PARENT_FS` is **1**, a number wac reserves as a channel — the JS host calls it
`n_HANDLE` in `packages/platform/host/children.ts` and checks for it *before* consulting its socket
table. This host did neither, and worse, its socket allocator began at `next_handle: 1`, so the
first handle it ever handed out was that same number.

Two faults from one collision, and the quiet one is worse:

- before any spawn, `recv(PARENT_FS)` found nothing and **threw**, so every applet trapped;
- after a spawn it would have found the child's *stdout queue* and read that instead, with nothing
  anywhere to say so.

Fixed by reserving the numbers — `next_handle` now starts above both `STDIN` and `PARENT_FS` — and
by answering `ReadAnswer::End` for `PARENT_FS` rather than throwing, which is the "ended or absent"
this host can honestly give until it serves a parent filesystem at all.

## Closed: all three criteria met (2026-08-15)

```
$ deno task app:wacbin packages/box/src/bin/imaged.wac --allow-read --allow-write -o imaged
$ ./imaged k1.wacimg -c 'echo one two three'
one two three
$ ./imaged k2.wacimg -c 'seq 1 5 | sort -nr | head -1'
5
$ ./imaged k3.wacimg -c 'seq 3'
1
2
3
```

Every line of the reproduction at the top of this issue now answers, through `app:wacbin` and
through `app:native` alike.

**The environment dependency went with it.** `env -i ./imaged … -c 'seq 1 5 | sort -nr | head -1'`
answers `5`. It was never its own defect: a child started with no argv ran the shell rather than the
applet, and that is what the missing environment had been blamed for.

**And the seed directory is no longer a trap.** `app:native` now creates the directory its `-o` names,
so the invocation `native/v8/build.rs` documents works on a fresh checkout instead of failing on a
gitignored path nobody was told to make.

The test is `packages/platform/test/v8host.test.ts`, *"the spawning shell answers the same on Deno
and on the Rust host — 0148"*. It compares `packages/box/src/bin/sh.wac` — the `spawnSelf` shell —
across both hosts, where the test beside it uses `packages/box/example/boxsh.wac` and reaches only
`pushChild`. **That is why this survived two days of green suites**, and the new test fails against
either half of the fix reverted.

## What is still missing, and is not this issue

A spawned applet cannot see a filesystem its parent serves: the host ignores `spawn`'s `serveFs`
argument and has no parent-filesystem channel, so `PARENT_FS` is answered "absent" unconditionally.
Writing into an image works and reading it back from a child does not —

```
$ ./imaged h1.wacimg -c 'mkdir /data; seq 1 5 > /data/n'   # 118 bytes on disk, as on Deno
$ ./imaged h1.wacimg -c 'cat /data/n | sort -nr | head -1'
cat: /data/n: Not granted to this application       # `5` on every JavaScript host
```

That is a capability this host has not implemented rather than one it implements wrongly, so it is
`issues/system/0157` and not a reason to hold this open.

## Why this matters more than a broken example

`design/system/0001`'s image story — a session's filesystem is a file, and it moves between hosts —
is exercised by `imaged`, and `app:wacbin` is the way to ship it as one file on the primary
platform. Today that combination silently does nothing useful. It is also the case that most wants
a native binary: a shell with applets is the thing you would hand somebody.

`ec5e4e99` made `spawn` take a program's *bytes*, and on the V8 host those bytes are wasm. A
multicall binary spawns *itself* with a different applet name, so the entry dispatch is the suspect:
the child appears to run the embedded seed's `main` rather than resolving the applet.

## Two smaller things found beside it

- ~~The `wacbin`-built `imaged` needs an inherited environment.~~ **Not a separate defect** — it was
  this one. A child started with no argv ran the shell instead of the applet, and `env -i` was the
  circumstance it was first noticed under. Fixed with the rest; see the close below.
- ~~`native/v8/seed/` is gitignored, so the documented invocation fails on a fresh checkout.~~
  **Fixed**: `app:native` creates the directory its `-o` names.

## What "done" would mean

1. `./imaged i.wacimg -c 'seq 1 5 | sort -nr | head -1'` answers `5`, built either way.
2. A test that spawns **through the V8 native host** — `app:native` plus the `wac` binary is the
   cheap pair, per the section above, and covers `app:wacbin` too since that embeds the same host.
   `packages/platform/test/v8host.test.ts` covers the host being *handed* a program and never one
   that spawns.
3. A decision on the environment dependency above, or an issue of its own for it.

The oracle is `app:build`, which is correct today.
