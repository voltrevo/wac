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
// built from `packages/wacc/example/wacc.wac` — whose closure is `src/`, yes, but also the example
// itself and everything it imports from `packages/platform`, `packages/fs`, `packages/fmt` and
// the rest. A change to the example's own usage text left the seed stale with this test green, and
// the four CLI tests that then failed said nothing about a seed. Watching a directory when the
// artefact is built from a *graph* is a guard whose scope is a guess; `wacFiles` already computes
// the graph, and is what the build itself walks.
import { ROOT } from "../harness/programs.ts";
import { wacFiles } from "../harness/wacFiles.ts";

const SEED = `${ROOT}/native/v8/seed/wacc.wasm`;
const ENTRY = "packages/wacc/example/wacc.wac";

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
