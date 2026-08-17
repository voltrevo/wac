# 0169 — `wacland` spawns a child on the V8 host and hears nothing back

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
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

## Fixed — 2026-08-17, agent-c

Two faults, and the second was hiding behind the first. The V8 host now answers what the wasmtime one
does: `denied` / `ok` / `denied` / `seen`, with stage 5 hearing its child.

### `core.log` never asked where output should go

The second candidate in "where to start" was the one. `Cap::Log` was a bare `println!`:

```rust
if cap == Cap::Log { println!("{text}") } else { eprintln!("{text}") }
```

`Cap::Write` beside it does the right thing in three steps — a frame captures it, else the queue to
the **parent**, else this process's stream — and `log` did none of them. So a spawned child's output
landed on the host's own standard output while its parent read `recv` and heard nothing. The child was
running correctly the whole time: its five lines were in the transcript, in the right order, with the
right answers, and `silent` was about where they went rather than whether they happened.

The wasmtime host has had a single `emit(bytes, to_stderr)` for log, warn, write and writeErr all
along, which is exactly why it was right. The V8 host has one now — `emit_bytes` — and all four go
through it, so `log` cannot drift from `write` again.

### And then the hosts disagreed about wording

With the output arriving, stage 6 read `failed` where wasmtime read `denied`. `wacland` was grepping
`f.error` for "not granted", and the two hosts word that refusal differently: `"this program was not
granted reading"` against `"Not granted to this application"`.

Both set `FAULT_NOT_GRANTED`, and `platform.wac` derives its own sentence from exactly that fault —
"Not granted to this application" — so the canonical wording was the V8 one and this host was the
outlier. Both halves fixed: `wacland` reads the **fault**, because a host's prose is not a contract,
and the wasmtime host's readFile refusal now says what the platform says.

`packages/platform` green at 189, `native_hostfs` at 7. A comment in that file cited the two old
wordings as an example of per-runtime prose; it now says which half stopped being true.
