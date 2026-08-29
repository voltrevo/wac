# 0274 — `wac app --coverage` instrumented a module nothing could read

- **Status:** open — the flag is refused as of 2026-08-29; what to *do* about coverage for an app is
  the open part
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** missing feature
- **Symptom:** wrong answer — a flag that was accepted, did half its job, and said nothing

## Reproduction

Before the refusal below went in:

```
$ wac app --coverage packages/box/src/bin/sealedsh.wac -o /tmp/app
/tmp/app  1168 KB  [no capabilities]
$ ls /tmp/
app                       # and no app.cov

$ wac build --coverage packages/box/src/bin/sealedsh.wac -o /tmp/b
$ ls /tmp/
b.cov  b.wasm             # the table is build's

$ wac covdump /tmp/app
wac: /tmp/app is not a wasm module — did you mean the artefact `wac build` wrote?
```

Expected: either a readable profile, or a refusal.
Actual: an instrumented executable, no table, and no way to read the counters — so the whole effect
of the flag was the instrumentation overhead it silently paid for.

## How it happened

Two ordinary decisions that are only wrong together.

`unknownFlag` (`packages/wac/src/wac.wac:973`) is **one list for every command**. It admits
`--allow-*`, `--quiet`, `--js`, `--coverage`, `--trace`, `--trace-slots` and `--no-cache`, and every
arm that validates flags calls it. So `app` accepted nine flags while the message it prints on a
*rejected* one names only the five grants — it advertised five and took nine.

And `covered` is decided in the **shared compile above the dispatch** (`wac.wac:1760`), which is
right: `build`, `test` and `run` all want it and none should re-derive it. The consequence is that by
the time control reaches `if (cmd == "app")` the module is already instrumented, and that arm writes
the executable and nothing else. The `.cov` table is written at `wac.wac:2080`, inside `build`'s arm.

Neither half is a mistake on its own. The gap is that nothing ties "which flags change the emitted
module" to "which arms know how to finish the job".

## What was done

`app` now refuses `--coverage`, `--trace`, `--trace-slots` and `--js` by name, and points at
`wac build --coverage`. `packages/wac/test/wac/app_test.wac` covers it, asserting on the *message*
rather than the status — `2` is also what an unknown flag and a missing `-o` return, so a
status-only check would pass on a binary that had merely stopped being able to parse its own command
line — and checks that nothing is written when a build is refused.

## What is still open

**Coverage for an app is not obviously the wrong thing to want.** `packages/platform/build.ts`
instruments its builds deliberately, and its comment says why: it is *"how every existing subprocess
test becomes attributable without being edited"*. About 47 `buildApp` calls across 16 files in
`packages/box/test/` are subprocess tests that get attributed that way today, and
`design/system/0009` moves them onto `wac app`. When it does, that attribution goes unless this is
answered.

Three decisions, which is why it is an issue rather than a patch:

1. **What writes the table.** `<dest>.cov` beside the executable is the obvious answer and it makes
   the one-file property a lie — the artefact's whole point is that it survives an `scp` alone.
   Appending the table to the file is the alternative, and then it is not just a preamble plus a
   module any more.
2. **How `covdump` reads it.** It refuses an app today because of the two shell lines on the front.
   `app-run` already finds the module inside the file, so the seeking exists and is not shared.
3. **How a running app dumps counters.** `wac test --coverage` dumps because it is the harness. An
   app is somebody else's program; something has to decide when the counters are read and where they
   go, and the answer cannot be an environment variable a sealed program is not granted to read.

A fourth question is worth asking before any of it: whether `unknownFlag` should be per-command at
all. Making it so would have caught this by construction, and would also catch `--js` on `build` and
`--trace-slots` on `check`, which are the same shape and equally inert. It was not done here because
that function is also read at `wac.wac:402` to decide whether a build is *cacheable*, so narrowing it
changes caching for every command at the same time — a second, unrelated behaviour change riding on a
diagnostic fix.

## Notes

Found while migrating `packages/box/test/` off `packages/platform/build.ts` for
`design/system/0009`, by asking whether `wac app` could do what `buildApp` does. It can, except for
this.
