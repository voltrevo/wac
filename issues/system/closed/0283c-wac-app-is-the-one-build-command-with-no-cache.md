# 0283 — `wac app` is the one build command with no cache, and it is the most cacheable

- **Status:** closed — fixed 2026-08-29
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** performance
- **Symptom:** every `wac app` is a full compile, including the identical one a moment earlier

## What is wrong

`buildCachePath` in `packages/wac/src/wac.wac` takes `test`, `run` and `build`, and falls out for
everything else:

    } else if (cmd != "build" || stem == "") {
      return "";
    }

So `wac app` compiles from scratch every time. That is the command this repository tells people to
distribute with, and — since `design/system/0009` began moving tests off
`packages/platform/build.ts` — the command the suite now uses to build programs.

## And it is more cacheable than `build`, not less

`wac build`'s key has to include the output's base name, because the name goes *into the manifest*:

> The key is everything that changes the bytes written: the compiler, the entry, every source's
> content, the grants — they go *into* the manifest — and the output's base name, which is in the
> manifest too, so two destinations are two artefacts.

`wac app` does not take its manifest name from `-o`. `writeApp` uses `baseName(stem(entry))`, so the
destination never reaches the bytes. Measured:

    wac app packages/platform/example/wc.wac -o one
    wac app packages/platform/example/wc.wac -o two
    cmp one two        →  identical, 246065 bytes

So its key is *smaller* than `build`'s — the compiler, the entry, the sources and the grants — and a
second destination is a copy rather than a compile.

## What it costs today, measured

Two numbers from the gate, either side of tests moving onto `wac app`:

    coverage:tls        27–30s across five gates   →  43.4s
    the Deno pass       48–50s                     →  61–70s

The `tls` half is fixed differently — those tests now use `builtProgram`, which asks `wac build` and
so hits the cache that exists. The Deno pass is `packages/box`'s eleven files through
`harness/buildApp.ts`, which builds an *executable* and cannot use that route: several of them assert
on the artefact itself.

## Notes

Found by checking a speedup I had reported and getting the opposite answer — the migrated tls tests
were four times slower, not nine times faster, and the gate's own `coverage:tls` line had been saying
so for a run.

The cache's own comment says why the miss is total rather than partial: *"Each of those is a miss
forever rather than a wrong hit"* — which is the right instinct for a command whose key is unclear,
and `app`'s is clearer than `build`'s.


## Fixed

Two edits, because the key was already right. `buildCachePath`'s key eats the stem only for `build`:

    h.eat(cmd);
    h.eat(cmd == "test" ? target : entry);
    h.eat(cmd == "build" ? baseName(stem) + ".wasm" : "");

So `app` needed an arm in the guard above it, and a hit path. What is stored is the **sealed module**
rather than the finished file — an app is that module behind two shell lines, so a hit rebuilds the
artefact with `writeApp` exactly as a miss does. Putting the preamble in the cache would be storing
the one part that costs nothing.

    wc.wac    1s → 0s        box.wac   4s → 1s        identical bytes both

**And the wrong-hit cases were checked rather than assumed**, because the cache's own note says the
right instinct is *"a miss forever rather than a wrong hit"*:

    same entry, different destination   hits, identical bytes      — the point
    same entry, different grants        does not hit, bytes differ — grants are in the manifest

Green: `app_test.wac` 7 of 7, `packages/box` 85 Deno tests, `packages/platform/test/wac` 38 of 38,
docs 23 of 23.
