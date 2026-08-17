# 0169 — `wacland` spawns a child on the V8 host and hears nothing back

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

Build the conformance program and run it on the V8 host:

```
deno run -A --unstable-net --import-map deno.json - <<'EOF'
import { buildNative } from "./packages/platform/native.ts";
const dir = await Deno.makeTempDir();
await buildNative("packages/platform/example/wacland.wac", `${dir}/wacland`,
                  { read: true, env: true });
const r = await new Deno.Command("./native/v8/target/release/wac", {
  args: [`${dir}/wacland`, "one", "two"], stdout: "piped", stderr: "piped",
  env: { ...Deno.env.toObject(), WACLAND_PROBE: "seen" },
}).output();
console.log(new TextDecoder().decode(r.stdout));
EOF
```

Stage 6:

    wacland: stage 6 withheld silent
    wacland: stage 6 granted silent
    wacland: stage 6 env withheld silent
    wacland: stage 6 env granted silent

The same program built the same way and run on the **wasmtime** host answers
`denied` / `ok` / `denied` / `seen`, which is correct.

`silent` is `wacland`'s own word for "a child was spawned, `cli.recv` reached `End`, and nothing
arrived in between" — `childSays` returns it when the drained output carries no `=`. So the child
starts (the handle is not negative, or the answer would be `no child`) and the parent reads nothing.

`wac run packages/platform/example/wacland.wac` gives the same four lines, so it is not about the
built-artefact path.

## Why it matters

It is not the grants. `issues/system/0168` was a real defect in exactly this code path on exactly
this host — the V8 host read a child's `GRANT_NET` as `env` — and **this is why the fix landed
without a test on the host it was wrong on.** The one program that drives child grants end to end
cannot be driven there.

More generally, a capability that answers nothing is worse than one that answers wrongly: `silent`
is what a correct-but-withheld grant looks like too, so a reader who did not have the wasmtime
transcript beside it would take these four lines for a pass.

## Where to start

`packages/platform/test/v8host.test.ts` does exercise `spawnSelf` — its `SPAWNING_ENTRY` runs
`seq 1 3` and a pipeline through `packages/box/src/bin/sh.wac`, and the output comes back and matches
Deno's. So spawning and reading a child's output *works* on this host for that program.

The difference to chase is what `boxsh` does that `wacland` does not: box's children are applets
driven through frames, while `wacland`'s child is re-entered `main` with `--canread` in argv and
writes with `core.log`. Candidates, in the order worth checking:

- whether the child's argv arrives at all (its first act is `cli.argCount()`), since a child that
  saw no arguments would fall through to the parent's stages rather than the `--canread` arm;
- whether `core.log` from a spawned child on this host reaches the parent's `recv` or the host's own
  standard output.

The second would also explain the silence being total rather than partial.

## Not this

Not `issues/system/0168`. That was the grant *decoding*, is fixed, and would have shown up as the
wrong answer rather than as no answer.
