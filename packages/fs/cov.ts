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
  p.renameOps(), p.rootlessOps(), p.mountOps(), p.edgeOps(), p.imageBadOps()
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
const NOT_COVERED: { file: string; line: number; snippet: string; proven: boolean; why: string }[] = [
  {
    file: "packages/fs/src/fs.wac",
    line: 142,
    proven: false,
    snippet: "Fs onHost(Cli cli, i64 now) {",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 201,
    proven: false,
    snippet: "case Host(cli): { return cli.readFile(path).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 252,
    proven: false,
    snippet: "case Host(cli): { return cli.stat(path).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 279,
    proven: false,
    snippet: "case Host(cli): { own = cli.readDir(path).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 306,
    proven: false,
    snippet: "case Host(cli): {}",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 312,
    proven: false,
    snippet: "case Host(cli): { return cli.writeFile(path, data).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 358,
    proven: false,
    snippet: "case Host(cli): {}",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 371,
    proven: false,
    snippet: "case Host(cli): { return cli.mkdir(path, parents).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 416,
    proven: false,
    snippet: "case Host(cli): { return cli.remove(path, recursive).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 451,
    proven: false,
    snippet: "case Host(cli): { return Change.of(FAULT_DENIED(), \"chmod on a host mount is not implemented\"); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 467,
    proven: false,
    snippet: "case Host(cli): { return Change.of(FAULT_DENIED(), \"chown on a host mount is not implemented\"); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 485,
    proven: false,
    snippet: "case Host(cli): {",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 489,
    proven: false,
    snippet: "case Host(cli2): { return cli.rename(from, to).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 490,
    proven: false,
    snippet: "else: { return Change.of(FAULT_DENIED(), \"rename across mounts is not implemented\"); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 496,
    proven: false,
    snippet: "case Host(cli): { return Change.of(FAULT_DENIED(), \"rename across mounts is not implemented\"); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/sh/test/backings.test.ts` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 117,
    proven: false,
    snippet: "else: { skipped.push(mountName(fs.mounts.get(i).at)); }",
    why:
      "The writer's host-mount path: naming a mount it did not save. Same reason as the fs.wac entries above — it needs a `Cli`. `test/image.test.ts` drives it through a built program.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 134,
    proven: false,
    snippet: "for (i32 i = 0; i < skipped.len(); i++) { names[i] = skipped.get(i); }",
    why:
      "The writer's host-mount path: naming a mount it did not save. Same reason as the fs.wac entries above — it needs a `Cli`. `test/image.test.ts` drives it through a built program.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 537,
    proven: true,
    snippet: "if (path.len() < m.at.len()) { return -1; }",
    why:
      "A path shorter than the mount that owns it. `mountOf` picks by `underMount`, which requires the mount point to be a whole-component prefix, so a path it returns is never shorter than the mount's own `at`. The one caller that reached it was `writeFile`'s parent lookup for a mount point itself, and that now answers before it gets here. Kept because `find` is called with `parentOf(path)` from several places and a future one could pass something shorter.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 753,
    proven: true,
    snippet: "if (cut < 0) { return path; }",
    why:
      "`baseOf` on a path with no slash in it. Every path reaching this package is absolute — the shell resolves before it calls — so there is always at least the leading one. Kept because it is a general helper and returning the whole string is the right answer if that ever stops being true.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 445,
    proven: false,
    snippet: "if (r.bad) { return -1; }",
    why:
      "One of the two `r.bad` checks inside the directory-entry loop. A truncated entry trips the other one first, and which of the pair a given malformed image reaches depends on where it was cut. Reachable, and not constructed — a gap rather than an exemption.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 450,
    proven: false,
    snippet: "if (r.bad) { return -1; }",
    why:
      "One of the two `r.bad` checks inside the directory-entry loop. A truncated entry trips the other one first, and which of the pair a given malformed image reaches depends on where it was cut. Reachable, and not constructed — a gap rather than an exemption.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 193,
    proven: false,
    snippet: "Booted of(bool ok, Fs fs, string error) { return Booted(ok, fs, error); }",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/sh/test/imaged.test.ts` and `packages/ssh/test/server.test.ts` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 211,
    proven: false,
    snippet: "export Booted boot(Core core, Cli cli, string path, Vec<string> argv) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/sh/test/imaged.test.ts` and `packages/ssh/test/server.test.ts` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 214,
    proven: false,
    snippet: "if (existing.ok) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/sh/test/imaged.test.ts` and `packages/ssh/test/server.test.ts` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 216,
    proven: false,
    snippet: "if (!got.ok) { return Booted.of(false, fs, got.error); }",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/sh/test/imaged.test.ts` and `packages/ssh/test/server.test.ts` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 218,
    proven: false,
    snippet: "} else if (existing.fault != FAULT_NOT_FOUND()) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/sh/test/imaged.test.ts` and `packages/ssh/test/server.test.ts` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 233,
    proven: false,
    snippet: "export bool save(Core core, Cli cli, string who, string path, Fs fs) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/sh/test/imaged.test.ts` and `packages/ssh/test/server.test.ts` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 235,
    proven: false,
    snippet: "for (i32 i = 0; i < w.skipped.len(); i++) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/sh/test/imaged.test.ts` and `packages/ssh/test/server.test.ts` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 248,
    proven: false,
    snippet: "if (cli.writeFile(beside, w.bytes).wait().fault != 0) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/sh/test/imaged.test.ts` and `packages/ssh/test/server.test.ts` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 252,
    proven: false,
    snippet: "if (cli.rename(beside, path).wait().fault != 0) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/sh/test/imaged.test.ts` and `packages/ssh/test/server.test.ts` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  }
];

// `src/` and not `packages/fs/`: the probe's own branches are a test's branches, and counting them
// would put the driver's coverage into the package's number — and, worse, into the ratchet below, where
// an unexercised line of the *probe* would read as an unaccounted line of the package.
const { total, covered } = report([probe], "packages/fs/src/", { verbose });

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
// **The ratchet.** Every uncovered point is either driven, or written down above with a reason. A run
// that merely printed a number would let the next uncovered branch arrive unnoticed, which is how the
// three defects at the top of this file survived as long as they did.
const accounted = NOT_COVERED.length;
const missing = total - covered - accounted;
if (missing > 0) {
  console.log(
    `\n${missing} uncovered branch point(s) are not accounted for. Drive them, or add them to ` +
      `NOT_COVERED with the reason — and keep "proven" honest about which of the two claims it is.`,
  );
  stale = true;
}
if (stale) Deno.exit(1);
