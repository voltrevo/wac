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
// Skipped when there is no seed. A checkout without one is a perfectly good checkout — the binary
// is then the runtime it has always been — and failing for its absence would be this check costing
// what it exists to protect.

import { ROOT } from "../harness/programs.ts";

const SEED = `${ROOT}/native/v8/seed/wacc.wasm`;
const SRC = `${ROOT}/packages/wacc/src`;

async function newestUnder(dir: string): Promise<{ at: number; what: string }> {
  let at = 0, what = "";
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    const found = e.isDirectory ? await newestUnder(p) : {
      at: (await Deno.stat(p)).mtime?.getTime() ?? 0,
      what: p,
    };
    if (found.at > at) ({ at, what } = found);
  }
  return { at, what };
}

Deno.test("the seed inside `wac` is not older than wacc's sources", async () => {
  let seed: Deno.FileInfo;
  try {
    seed = await Deno.stat(SEED);
  } catch {
    return; // No seed, no claim to check.
  }
  const seedAt = seed.mtime?.getTime() ?? 0;
  const newest = await newestUnder(SRC);
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
      `    deno task app:native packages/wacc/example/wacc.wac --allow-read --allow-write \\\n` +
      `      -o native/v8/seed/wacc\n` +
      `    (cd native/v8 && cargo build --release)`,
  );
});
