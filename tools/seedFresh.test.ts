// The compiler inside the binary is not older than the compiler in the tree.
//
// `native/v8/seed/wacc.wasm` is wacc compiled to wasm and embedded in `wac`, so `wac build`,
// `wac run` and `wac test` all compile with whatever that file happens to be. It is gitignored:
// every agent builds their own, by hand, with a command nobody runs on a schedule.
//
// Nothing else compares the two. A seed two days behind `packages/wacc/src/` produced a coverage
// report over `packages/std` that named real files and real lines and was **40% short** — 227
// points where the tree's compiler emits 367 — and the shape of that evidence pointed at the
// profiler rather than at the compiler, because the per-test sets were a strict subset of the other
// path's, which is what an attribution bug looks like. `issues/system/0160`.
//
// **A merge trips this, and that is correct.** Pulling someone else's change to `packages/wacc/src`
// makes your binary's compiler older than the tree's, which is exactly the state this exists to
// report — the same discipline `MAP.md is generated; staleness is a failure` already applies to a
// generated file. The remedy is two commands and they are in the message.
//
// **An absent seed fails too, and it did not used to.** The rule here was that a checkout without
// one is a perfectly good checkout, because the binary was then only a runtime and nothing compiled
// with it. That stopped being true when tests started driving `wac test`: `harness/nativeTestProfile
// .test.ts` runs `wac test --coverage` and, with no seed, fails with `cannot read test.json` — a
// message about a missing artefact, three steps downstream of the missing compiler that explains it.
//
// So the skip was costing exactly what this check exists to prevent: an hour of the suite pointing
// somewhere else. A guard that says why it is safe to skip is making a claim about the rest of the
// tree, and that claim ages without anybody editing this file.

// **The whole graph, not `packages/wacc/src`.** This watched that one directory, and the seed is
// built from `packages/wac/example/wac.wac` — whose closure is `src/`, yes, but also the example
// itself and everything it imports from `packages/platform`, `packages/fs`, `packages/fmt` and
// the rest. A change to the example's own usage text left the seed stale with this test green, and
// the four CLI tests that then failed said nothing about a seed. Watching a directory when the
// artefact is built from a *graph* is a guard whose scope is a guess; `wacFiles` already computes
// the graph, and is what the build itself walks.
import { ROOT } from "../harness/programs.ts";
import { wacFiles } from "../harness/wacFiles.ts";

const SEED = `${ROOT}/native/v8/seed/wacc.wasm`;
const ENTRY = "packages/wac/example/wac.wac";

async function newestInGraph(): Promise<{ at: number; what: string; count: number }> {
  const files = await wacFiles(ENTRY);
  let at = 0, what = "", count = 0;
  for (const path of files.keys()) {
    count++;
    const st = await Deno.stat(path.startsWith("/") ? path : `${ROOT}/${path}`);
    const t = st.mtime?.getTime() ?? 0;
    if (t > at) { at = t; what = path; }
  }
  return { at, what, count };
}

Deno.test("the seed inside `wac` is there, and not older than anything it is built from", async () => {
  let seed: Deno.FileInfo;
  try {
    seed = await Deno.stat(SEED);
  } catch {
    throw new Error(
      "native/v8/seed/wacc.wasm is missing, so `wac build`, `wac run` and `wac test` have no\n" +
        "  compiler in them. It is gitignored — one per agent — so a fresh container has none, and\n" +
        "  the tests that drive the binary fail downstream of this with messages about the files it\n" +
        "  did not write. Build it:\n" +
        "    deno task seed",
    );
  }
  const seedAt = seed.mtime?.getTime() ?? 0;
  const newest = await newestInGraph();
  // A graph of one file is a walk that did not resolve, and would make this pass for ever.
  if (newest.count < 10) {
    throw new Error(`the seed's import graph came back as ${newest.count} file(s) — it did not resolve`);
  }
  if (seedAt >= newest.at) return;

  const mins = (newest.at - seedAt) / 60_000;
  const behind = mins < 60
    ? `${Math.max(1, Math.round(mins))} minute(s)`
    : mins < 1440
    ? `${(mins / 60).toFixed(1)} hour(s)`
    : `${(mins / 1440).toFixed(1)} day(s)`;
  throw new Error(
    `native/v8/seed/wacc.wasm is ${behind} older than ${newest.what.replace(`${ROOT}/`, "")}.\n` +
      `  Every \`wac build\`, \`wac run\` and \`wac test\` is compiling with that older compiler,\n` +
      `  and will report plausible numbers from it. Rebuild:\n` +
      `    deno task seed`,
  );
});

// **And the binary around it, which is a second artefact with the same problem.**
//
// `native/v8/target/release/wac` is compiled Rust, gitignored, one per agent, built by a command
// nobody runs on a schedule — every sentence above about the seed is true of it. Nothing compared it
// to `native/v8/src/` until 2026-08-20, and the omission cost a full gate run: another agent's change
// to how the native host resolves a pushed child's paths against its frame's cwd landed at 14:39, my
// binary was built at 13:27, and their new test in `packages/platform/test/wac/frame_test.wac` failed
// against my stale host with the message "the frame's cwd was ignored". Nothing said "binary".
//
// `tools/push.sh` reseeds after a merge that touched `packages/wacc/src`, and now also rebuilds after
// one that touched `native/` — but that arm only helps when the gate did the pulling. A plain
// `git pull` leaves the binary stale with nothing to say so, which is the same argument that put the
// seed check here rather than trusting the script.
//
// A `cargo build --release` is about six seconds, so unlike the seed there is no reason to defer it.
const HOST = `${ROOT}/native/v8/target/release/wac`;

/** Every Rust source and manifest the host is built from. */
async function rustInputs(): Promise<string[]> {
  const out: string[] = [];
  // `native/spike-v8` is not in the binary: `native/Cargo.toml` names the members, and a spike is
  // not one of them. Watching it would make this red for an edit that changes nothing.
  // **Its own crate, and `manifest` which it depends on by path — not `native/src`.**
  // `native/v8` is the crate `wac`; `native/` is the crate `wacland`. They share a `manifest`
  // dependency and nothing else, so listing `native/src` here asserted a dependency that does not
  // exist — and made this **unclearable**: touching the wasmtime host's source failed this check, and
  // the `cd native/v8 && cargo build --release` it recommends does nothing, because nothing this
  // binary is built from changed. `native/src`, `native/build.rs` and `native/Cargo.*` belong to the
  // wasmtime check below. `issues/system/0208`.
  for (const dir of ["native/v8/src", "native/manifest/src"]) {
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(`${ROOT}/${dir}`)];
    } catch {
      continue;
    }
    for (const e of entries) if (e.isFile && e.name.endsWith(".rs")) out.push(`${dir}/${e.name}`);
  }
  for (const f of ["native/v8/Cargo.toml", "native/v8/Cargo.lock", "native/v8/build.rs",
                   "native/manifest/Cargo.toml"]) {
    try {
      await Deno.stat(`${ROOT}/${f}`);
      out.push(f);
    } catch { /* not every one of these exists in every layout */ }
  }
  return out;
}

Deno.test("the `wac` binary is not older than the Rust it is built from", async () => {
  let host: Deno.FileInfo;
  try {
    host = await Deno.stat(HOST);
  } catch {
    throw new Error(
      "native/v8/target/release/wac is missing, so nothing in the suite that drives the binary can\n" +
        "  run. It is gitignored — one per agent. Build it:\n" +
        "    cd native/v8 && cargo build --release",
    );
  }
  const inputs = await rustInputs();
  // A short list is a walk that did not resolve, and would make this pass for ever.
  if (inputs.length < 4) {
    throw new Error(`the host's Rust inputs came back as ${inputs.length} file(s) — they did not resolve`);
  }
  let at = 0, what = "";
  for (const f of inputs) {
    const t = (await Deno.stat(`${ROOT}/${f}`)).mtime?.getTime() ?? 0;
    if (t > at) { at = t; what = f; }
  }
  const hostAt = host.mtime?.getTime() ?? 0;
  if (hostAt >= at) return;

  const mins = (at - hostAt) / 60_000;
  const behind = mins < 60
    ? `${Math.max(1, Math.round(mins))} minute(s)`
    : mins < 1440
    ? `${(mins / 60).toFixed(1)} hour(s)`
    : `${(mins / 1440).toFixed(1)} day(s)`;
  throw new Error(
    `native/v8/target/release/wac is ${behind} older than ${what}.\n` +
      `  Every test that drives the binary is driving an older host, and a test written for the\n` +
      `  change you just merged will fail saying something about what the host did rather than\n` +
      `  about the host. Rebuild:\n` +
      `    cd native/v8 && cargo build --release`,
  );
});

// **The wasmtime host is a third per-agent artefact, and it had no freshness check.**
//
// `native/target/release/wacland` is gitignored, built on demand by whichever test wants it, and
// nothing owned it — `issues/system/0208`. That was tolerable while the only consequence was a slow
// first test. It stopped being tolerable on 2026-08-20, when `tools/push.sh` started deciding whether
// to rebuild after a merge by *running this file*: a merge that changes `native/src/` then produced a
// retry that could not pass. It cost one, and the message named itself —
// `Cli.execWith is not implemented in the native runtime yet`, from a host binary that predated the
// merge that added it.
//
// **Absent is fine; stale is not.** A fresh clone has no `wacland` and the callers build it, so this
// asks the narrower question. `native/Cargo.toml` counts as a source: it pins wasmtime.
Deno.test("the wasmtime host, if built, is not older than the Rust it is built from", async () => {
  const binary = `${ROOT}/native/target/release/wacland`;
  let built: Date;
  try {
    built = (await Deno.stat(binary)).mtime!;
  } catch {
    return; // never built here, so nothing can be out of date
  }
  const newer: string[] = [];
  for (const rel of ["native/src", "native/manifest/src", "native/Cargo.toml", "native/Cargo.lock",
                     "native/build.rs"]) {
    for await (const p of sourcesUnder(`${ROOT}/${rel}`)) {
      const at = (await Deno.stat(p)).mtime!;
      if (at > built) newer.push(`${p.slice(ROOT.length + 1)} (${stampGap(at, built)})`);
    }
  }
  if (newer.length > 0) {
    throw new Error(
      `native/target/release/wacland is older than ${newer.length} of its sources, the first being ` +
        `${newer[0]}.\n` +
        "  Every test that drives the wasmtime host is running the older one, and a two-host\n" +
        "  differential then fails saying the host lacks something the tree has.\n" +
        "  `cd native && cargo build --release` — or delete the binary and let the callers rebuild it.",
    );
  }
});

/** Every file under `dir`, or just `dir` when it is a file. */
async function* sourcesUnder(dir: string): AsyncGenerator<string> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(dir);
  } catch {
    return;
  }
  if (info.isFile) {
    yield dir;
    return;
  }
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* sourcesUnder(p);
    else yield p;
  }
}

/** "3.3 hour(s)" — the same phrasing the seed check uses. */
function stampGap(newer: Date, older: Date): string {
  const hours = (newer.getTime() - older.getTime()) / 3_600_000;
  return hours >= 1 ? `${hours.toFixed(1)} hour(s) newer` : `${(hours * 60).toFixed(0)} minute(s) newer`;
}
