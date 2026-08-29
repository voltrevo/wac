# 0283 — `wac app` is the one build command with no cache, and it is the most cacheable

- **Status:** open
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
