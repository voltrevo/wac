// Branch coverage for `packages/fs`.
//
//   deno task coverage:fs
//   deno task coverage:fs --verbose    # plus every uncovered point
//
// ## Why this exists at all
//
// It did not, for two ticks after the package doubled in size. `fs.wac` gained a synthesised backing and
// `image.wac` arrived — a parser for bytes somebody else wrote — and neither had a branch measured, in a
// repo with eighteen other `coverage:*` tasks. The first run found `rename` answering *success* to a file
// renamed onto a directory, which replaced the entry and orphaned everything the directory held: a wrong
// answer rather than a missing check, and in an image it is data loss. `test/host.test.ts` had had the
// oracle for that since the package was written, and nothing had asked it the question.
//
// ## What is driven, and what cannot be
//
// Everything goes through `test/wac/cov_probe.wac`, which builds each filesystem itself. Two things are
// out of reach from here and are recorded below rather than left to look like gaps:
//
//   * **host mounts**, which take a whole `Cli` that only a built program has. `test/host.test.ts` and
//     `packages/sh/test/backings.test.ts` drive every one of them against the real filesystem, which is a
//     better oracle than this file could be;
//   * a handful of guards whose precondition another guard has already established.

import { instrument, report } from "../../harness/wacCoverage.ts";

const verbose = Deno.args.includes("--verbose");

const probe = await instrument("packages/fs/test/wac/cov_probe.wac");
const p = probe.mod as unknown as {
  memoryOps(): string;
  synthOps(): string;
  imageOps(): string;
  pathOps(): string;
  renameOps(): string;
  rootlessOps(): string;
  mountOps(): string;
  edgeOps(): string;
  imageBadOps(): string;
};

// Each returns a transcript. It is not compared here — `test/host.test.ts` compares the same operations
// against the real filesystem, and `test/image.test.ts` and `test/synth.test.ts` assert the answers. What
// this file measures is which lines ran.
const transcripts = [
  p.memoryOps(), p.synthOps(), p.imageOps(), p.pathOps(),
  p.renameOps(), p.rootlessOps(), p.mountOps(), p.edgeOps(), p.imageBadOps(),
];
for (const t of transcripts) {
  if (t.length === 0) throw new Error("a probe returned nothing, so it measured nothing");
}

/**
 * Branches this run does not cover, each with the reason and whether it is provable.
 *
 * The same two claims `packages/zstd/cov.ts` keeps apart:
 *
 *   - `proven: true` — no input reaches it;
 *   - `proven: false` — reachable, and we did not manage to construct the input. A gap, not an exemption.
 *
 * Every entry is checked against the source, so moving the code without moving the entry fails loudly.
 */
const NOT_COVERED: { file: string; line: number; snippet: string; proven: boolean; why: string }[] = [];

report([probe], "packages/fs/", { verbose });

let stale = false;
const sources = new Map<string, string[]>();
for (const u of NOT_COVERED) {
  if (!sources.has(u.file)) sources.set(u.file, (await Deno.readTextFile(u.file)).split("\n"));
  const at = sources.get(u.file)![u.line - 1] ?? "";
  if (!at.includes(u.snippet)) {
    console.log(
      `\n${u.file}:${u.line} no longer holds ${JSON.stringify(u.snippet)} — it holds:\n  ${at.trim()}`,
    );
    stale = true;
  } else {
    const label = u.proven ? "unreachable" : "reachable, NOT COVERED";
    console.log(`\n${label}: ${u.file}:${u.line}  ${u.snippet}\n  ${u.why}`);
  }
}
if (stale) Deno.exit(1);
