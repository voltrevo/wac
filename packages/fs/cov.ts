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
//     `packages/box/test/wac/backingsprocess_test.wac` drive every one of them against the real filesystem, which is a
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
  procOps(): string;
  streamOps(): string;
  wireOps(): string;
  permissionOps(): string;
};

// Each returns a transcript. It is not compared here — `test/host.test.ts` compares the same operations
// against the real filesystem, and `test/image.test.ts` and `test/synth.test.ts` assert the answers. What
// this file measures is which lines ran.
const transcripts = [
  p.memoryOps(), p.synthOps(), p.imageOps(), p.pathOps(),
  p.renameOps(), p.rootlessOps(), p.mountOps(), p.edgeOps(), p.imageBadOps(),
  // The process table, which nothing here had asked for — 24.5% of `proc.wac` and none of it needing a
  // capability, a mount or a host. wac-mono 0134.
  p.procOps(),
  // The streaming write and the session state — `openOut`/`writeOut`/`closeOut`, `setUser`, `setCwd`.
  p.streamOps(),
  // The child/parent wire, round-tripped: the half of `remote.wac` that needs no peer to answer.
  p.wireOps(),
  // Being refused: `may(node, 2)` answering no on every operation that changes what a directory holds,
  // which was the largest unaccounted group and is the one a wrong answer matters most in.
  p.permissionOps(),
];
for (const t of transcripts) {
  if (t.length === 0) throw new Error("a probe returned nothing, so it measured nothing");
}

/**
 * Branches this run does not cover, each with the reason and whether it is provable.
 *
 * The same two claims `packages/zstd/test/cov_ledger.wac` keeps apart:
 *
 *   - `proven: true` — no input reaches it;
 *   - `proven: false` — reachable, and we did not manage to construct the input. A gap, not an exemption.
 *
 * Every entry is checked against the source, so moving the code without moving the entry fails loudly.
 */
const NOT_COVERED: { file: string; line: number; snippet: string; proven: boolean; why: string }[] = [
  {
    file: "packages/fs/src/fs.wac",
    line: 206,
    proven: false,
    snippet: "Fs onHost(Cli cli, i64 now) {",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 536,
    proven: false,
    snippet: "case Host(cli): { return cli.readFile(path).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 596,
    proven: false,
    snippet: "case Host(cli): { return cli.stat(path).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 660,
    proven: false,
    snippet: "case Host(cli): { own = cli.readDir(path).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 696,
    proven: false,
    snippet: "case Host(cli): {}",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 703,
    proven: false,
    snippet: "case Host(cli): { return cli.writeFile(path, data).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 696,
    proven: false,
    snippet: "case Host(cli): {}",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 772,
    proven: false,
    snippet: "case Host(cli): { return cli.mkdir(path, parents).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 827,
    proven: false,
    snippet: "case Host(cli): { return cli.remove(path, recursive).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 885,
    proven: false,
    snippet: "case Host(cli): { return Change.of(FAULT_UNSUPPORTED(), \"chmod on a host mount is not implemented\"); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 942,
    proven: false,
    snippet: "case Host(cli): { return Change.of(FAULT_UNSUPPORTED(), \"chown on a host mount is not implemented\"); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 984,
    proven: false,
    snippet: "case Host(cli): {",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 988,
    proven: false,
    snippet: "case Host(cli2): { return cli.rename(from, to).wait(); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 989,
    proven: false,
    snippet: "else: { return Change.of(FAULT_UNSUPPORTED(), \"rename across mounts is not implemented\"); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 995,
    proven: false,
    snippet: "case Host(cli): { return Change.of(FAULT_UNSUPPORTED(), \"rename across mounts is not implemented\"); }",
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by `test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a better oracle than this probe could be — so this is where the measurement stops, not where the testing does.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 123,
    proven: false,
    snippet: "else: { skipped.push(mountName(fs.mounts.get(i).at)); }",
    why:
      "The writer's host-mount path: naming a mount it did not save. Same reason as the fs.wac entries above — it needs a `Cli`. `test/image.test.ts` drives it through a built program.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 140,
    proven: false,
    snippet: "for (i32 i = 0; i < skipped.len(); i++) { names[i] = skipped.get(i); }",
    why:
      "The writer's host-mount path: naming a mount it did not save. Same reason as the fs.wac entries above — it needs a `Cli`. `test/image.test.ts` drives it through a built program.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 1064,
    proven: true,
    snippet: "if (path.len() < m.at.len()) { return NODE_NONE(); }",
    why:
      "A path shorter than the mount that owns it. `mountOf` picks by `underMount`, which requires the mount point to be a whole-component prefix, so a path it returns is never shorter than the mount's own `at`. The one caller that reached it was `writeFile`'s parent lookup for a mount point itself, and that now answers before it gets here. Kept because `find` is called with `parentOf(path)` from several places and a future one could pass something shorter.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 1473,
    proven: true,
    snippet: "if (cut < 0) { return path; }",
    why:
      "`baseOf` on a path with no slash in it. Every path reaching this package is absolute — the shell resolves before it calls — so there is always at least the leading one. Kept because it is a general helper and returning the whole string is the right answer if that ever stops being true.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 336,
    proven: false,
    snippet: "if (r.bad) { return -1; }",
    why:
      "One of the two `r.bad` checks inside the directory-entry loop. A truncated entry trips the other one first, and which of the pair a given malformed image reaches depends on where it was cut. Reachable, and not constructed — a gap rather than an exemption.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 336,
    proven: false,
    snippet: "if (r.bad) { return -1; }",
    why:
      "One of the two `r.bad` checks inside the directory-entry loop. A truncated entry trips the other one first, and which of the pair a given malformed image reaches depends on where it was cut. Reachable, and not constructed — a gap rather than an exemption.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 199,
    proven: false,
    snippet: "Booted of(bool ok, Fs fs, string error) { return Booted(ok, fs, error); }",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/box/test/wac/imaged_test.wac` and `packages/ssh/test/wac/wacsshdimage_test.wac` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 217,
    proven: false,
    snippet: "export Booted boot(Core core, Cli cli, string path, Vec<string> argv, Vec<string> programs) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/box/test/wac/imaged_test.wac` and `packages/ssh/test/wac/wacsshdimage_test.wac` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 220,
    proven: false,
    snippet: "if (existing.ok) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/box/test/wac/imaged_test.wac` and `packages/ssh/test/wac/wacsshdimage_test.wac` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 222,
    proven: false,
    snippet: "if (!got.ok) { return Booted.of(false, fs, got.error); }",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/box/test/wac/imaged_test.wac` and `packages/ssh/test/wac/wacsshdimage_test.wac` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 224,
    proven: false,
    snippet: "} else if (existing.fault != FAULT_NOT_FOUND()) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/box/test/wac/imaged_test.wac` and `packages/ssh/test/wac/wacsshdimage_test.wac` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 239,
    proven: false,
    snippet: "export bool save(Core core, Cli cli, string who, string path, Fs fs) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/box/test/wac/imaged_test.wac` and `packages/ssh/test/wac/wacsshdimage_test.wac` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 241,
    proven: false,
    snippet: "for (i32 i = 0; i < w.skipped.len(); i++) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/box/test/wac/imaged_test.wac` and `packages/ssh/test/wac/wacsshdimage_test.wac` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 254,
    proven: false,
    snippet: "if (cli.writeFile(beside, w.bytes).wait().fault != 0) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/box/test/wac/imaged_test.wac` and `packages/ssh/test/wac/wacsshdimage_test.wac` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  {
    file: "packages/fs/src/image.wac",
    line: 258,
    proven: false,
    snippet: "if (cli.rename(beside, path).wait().fault != 0) {",
    why:
      "`boot` and `save` take a `Core` and a `Cli`, which only a built program has. Both are driven end to end by `packages/box/test/wac/imaged_test.wac` and `packages/ssh/test/wac/wacsshdimage_test.wac` — a missing image, a damaged one, a path that is a directory, a save that succeeds and a save that cannot — against real files on a real disk. `packages/sh/test/wac/probe.wac` fabricates a whole `Cli` and could be copied here; thirty fake capability functions is a copy, and the copy would be a worse oracle than the real files those two tests already use.",
  },
  // ── Guards no caller can trigger ──────────────────────────────────────────────
  //
  // Each of these three is a check that every one of its callers has already made, so nothing can
  // reach it. That is a reason to keep it rather than to delete it, and `find`'s own comment says
  // why at length: a rule enforced by twenty call sites is held by twenty call sites, and the day
  // one of them is missing an arm the program traps instead of answering "there is nothing there".
  // They are pinned rather than driven because driving one means reaching past the callers to call
  // an internal directly, which measures a call the system does not make.
  {
    file: "packages/fs/src/fs.wac",
    line: 1063,
    proven: false,
    snippet: "if (m.root < 0) { return NODE_NONE(); }",
    why:
      "`find` on a mount whose bytes are not in the node pool. `root` is -1 for every backing but `Memory`, and every caller matches those backings out before walking, so this answers for a call none of them makes. Kept, and the comment above it is the argument: it was unreachable in exactly this way when a missing arm turned it into a trap.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 1247,
    proven: false,
    snippet: 'if (name.len() == 0) { return -1; }',
    why:
      "A `/proc/` path whose pid is the empty string. Every path reaching `procPid` has been through `at`, which collapses `//` and drops a trailing slash, so the component after `/proc` is never empty — `/proc//cmdline` and `/proc/` are both driven by `procOps` and both arrive here as something else. The guard is against a future caller that does not normalise first.",
  },
  {
    file: "packages/fs/src/fs.wac",
    line: 1372,
    proven: false,
    snippet: "if (found is null) { return u8[0](); }",
    why:
      "`procBytes` for a pid with no process. `synthKind` calls `procPid`, which answers -1 for a pid that is not in the table, and a path whose kind is `SYNTH_NONE` never gets as far as reading bytes — so `/proc/9999/cmdline` (driven, in `procOps`) is refused a step earlier. This is the `Proc?` unwrap the type system requires and it has no second answer to give.",
  }
];

/**
 * Categories, for the points that are the *same* fact repeated.
 *
 * **Why this exists beside the pin list.** A pin names one line and proves it is still that line,
 * which is right for a one-off. It is the wrong shape for "every arm that dispatches to a host mount"
 * — there are 41 of those in `fs.wac` and 75 more in `remote.wac` behind a channel, all unreachable
 * for one reason each, and writing 116 near-identical entries would make the list unreadable and the
 * reason harder to find rather than easier. wac-mono 0134.
 *
 * A rule matches an *uncovered* point whose own line contains `holds`; with `scope: "decl"`, whose
 * enclosing declaration does; with `scope: "struct"`, whose enclosing `struct` does. The second is
 * what a channel needs: the points are inside `remoteReadFile` and its fifteen siblings rather than
 * on a line that says `Chan`, and naming the signature is both more accurate and harder to leave
 * behind, since renaming the parameter breaks the rule. The third is for a struct whose *methods*
 * are the unreachable thing, where each signature is different and only the type they hang off is
 * shared.
 *
 * Either way it keeps the property the pins have: a rule that matches nothing is stale and fails the
 * run, so deleting the last host arm does not leave a reason behind explaining something that is gone.
 */
const CATEGORIES:
  { file: string; holds: string; scope?: "decl" | "struct"; proven: boolean; why: string }[] = [
  {
    file: "packages/fs/src/fs.wac",
    holds: "case Host(cli)",
    proven: false,
    why:
      "A host mount, which takes a `Cli` that only a built program has. Every one of these is driven by " +
      "`test/host.test.ts` and `packages/box/test/wac/backingsprocess_test.wac` against the real filesystem, which is a " +
      "better oracle than this probe could be — so this is where the measurement stops, not where the " +
      "testing does.",
  },
  {
    file: "packages/fs/src/fs.wac",
    holds: "case Remote(chan",
    proven: false,
    why:
      "A remote mount: the arm asks a *parent process* over 0116's channel. A probe cannot be that peer — " +
      "a wac fake has no state to answer from — so these are driven by `packages/box/test/sealing.test.ts`, " +
      "which runs a sealed session whose stages read, write and rename through the channel. That claim was " +
      "checked rather than remembered on 2026-08-12: the file had no `mv` in it, so `remoteRename` was named " +
      "here as driven and driven by nothing. It has one now, canaried by making every rename report success.",
  },
  {
    file: "packages/fs/src/remote.wac",
    holds: "struct Chan",
    scope: "struct",
    proven: false,
    why:
      "`Chan`'s own methods — `of`, `waitId`, `rearm`, `compact`. Each is about a live handle: the id a " +
      "`waitAny` waits on, the outstanding read that has to be re-armed, the backlog that has to be " +
      "compacted. There is no handle without a `Cli` and no answer without a peer, so these move with " +
      "the channel itself and are exercised wherever a real child asks a real parent.",
  },
  {
    file: "packages/fs/src/fs.wac",
    holds: "Cli cli",
    scope: "decl",
    proven: false,
    why:
      "A constructor that takes a `Cli` — `onHost`, `overParent`, `overChan`, `fromParentOrHost`. Only a " +
      "built program has one, and what they build is exercised by `test/host.test.ts` and by every " +
      "spawned stage in `packages/box/test/sealing.test.ts`; a probe can build the filesystems that need " +
      "no capability and no more.",
  },
  {
    file: "packages/fs/src/fs.wac",
    holds: "rename across mounts",
    proven: false,
    why:
      "The refusal `rename` gives when one end is on a *parent's* filesystem and the other is not. " +
      "Reaching it needs a mount with a `Remote` backing, which needs a channel to a live peer — the " +
      "same reason as the arms above, one level in: this is the `else` inside `case Remote`, so a " +
      "probe with no remote mount cannot get to either side of it. `packages/box/test/sealing.test.ts` " +
      "is where a stage renames across the boundary.",
  },
    {
    file: "packages/fs/src/wire.wac",
    holds: "this.why == \"\"",
    proven: true,
    why:
      "**The `else` of first-error-wins, which cannot happen here.** Every reader that records a " +
      "reason sets `bad` in the same breath, and `byte()` answers zero for a reader with `bad` set " +
      "— so a reader that already has a `why` reads a length of zero, zero is not negative, and " +
      "this refusal is never reached a second time. The guard is right and is what makes the " +
      "property hold for the readers that *do* reach it twice through other fields; here it is a " +
      "statement rather than a branch. `cov_probe.wac`'s `wireOps` drives the arm that does fire, " +
      "and `fs_test.wac` asserts the property from both sides. issues/lang/0112.",
  },
{
    file: "packages/fs/src/remote.wac",
    holds: "remoteSetExecutable",
    proven: false,
    why:
      "**The one wire call with no driver anywhere**, named separately so the blanket reason above " +
      "does not cover for it. Every other opcode is reached by a sealed session because some applet " +
      "makes that call — `cat` reads, `cp` writes, `mv` renames — but nothing in `packages/box` sets " +
      "the executable bit: `chmod` is one of the shell's *builtins*, so a sealed `chmod +x` never " +
      "leaves the parent, and the only caller of `setExecutable` in the repository is " +
      "`packages/git`'s checkout, which runs on a host filesystem. So this is not 'driven elsewhere' " +
      "— it is untested, and it is written down here rather than inside a category that says " +
      "otherwise. A driver would mean an applet that sets the bit — and `packages/sh`'s README says " +
      "why there is not one: `chmod` is a *builtin*, along with `echo`, `test`, `ls` and `chown`, " +
      "because 'a builtin is what the shell must answer itself'. So this is not an oversight waiting " +
      "for a small change; driving it means arguing with that decision, and the cheaper honest " +
      "answer is this entry.",
  },
  {
    file: "packages/fs/src/remote.wac",
    holds: "Chan c",
    scope: "decl",
    proven: false,
    why:
      "The child's half of the channel: every one of these writes a question and waits for its parent's " +
      "answer. The *wire* underneath them is covered — `fs_test.wac` round-trips all four encode/decode " +
      "pairs — and the asking needs a real peer, which is `packages/box/test/sealing.test.ts`.",
  },
];

// `src/` and not `packages/fs/`: the probe's own branches are a test's branches, and counting them
// would put the driver's coverage into the package's number — and, worse, into the ratchet below, where
// an unexercised line of the *probe* would read as an unaccounted line of the package.
const { total, covered, missed } = report([probe], "packages/fs/src/", { verbose });

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
// Category rules, applied to the points that are actually uncovered. A rule that matches nothing is
// stale in exactly the way a moved pin is: it explains something that is no longer there.
const lines = new Map<string, string[]>();
const sourceOf = async (file: string) => {
  if (!lines.has(file)) lines.set(file, (await Deno.readTextFile(file)).split("\n"));
  return lines.get(file)!;
};
let byCategory = 0;
/** Every point a rule or a pin has spoken for, so the leftovers can be named rather than counted. */
const spokenFor = new Set<string>();
for (const u of NOT_COVERED) spokenFor.add(`${u.file}:${u.line}`);
for (const c of CATEGORIES) {
  const src = await sourceOf(c.file);
  // The enclosing declaration of a line: the nearest line at or above it that opens a block at the
  // top level or one level in. Crude on purpose — a wac file nests exactly one deep, `struct` then
  // its methods, and anything cleverer would need the parser this tool deliberately does not carry.
  // **One level in, not column 0.** Every constructor `Fs.overChan` and every method of `Chan` is
  // indented inside its `struct`, so a column-0 rule walked past all of them to the `struct` line
  // and reported four points as unaccounted that the category above them already spoke for.
  const opens = (l: string) =>
    /^ {0,2}\S/.test(l) && !/^\s*(if|for|while|match|else|case|\}|\/|\*)/.test(l) &&
    (/\{\s*$/.test(l) || /\{.*\}\s*$/.test(l));
  // The enclosing `struct`: the nearest line at or above that starts in column 0 and opens a block,
  // which for a method is its type and for a free function is the function itself.
  const structOf = (line: number): string => {
    for (let i = line - 1; i >= 0; i--) {
      const l = src[i] ?? "";
      if (/^\S.*\{\s*$/.test(l)) return l;
    }
    return "";
  };
  const declOf = (line: number): string => {
    for (let i = line - 1; i >= 0; i--) {
      const l = src[i] ?? "";
      if (opens(l)) return l;
    }
    return "";
  };
  const hit = missed.filter((p) =>
    p.file === c.file &&
    (c.scope === "decl"
      ? declOf(p.line).includes(c.holds)
      : c.scope === "struct"
      ? structOf(p.line).includes(c.holds)
      : (src[p.line - 1] ?? "").includes(c.holds))
  );
  if (hit.length === 0) {
    // **"no longer holds", because the phrasing is an API.** `tools/coverageAll.ts` repeats a failing
    // task's own explanation and picks the lines by matching `no longer holds`, `is listed as
    // unreach`, `branch point(s) uncovered` and a leading `error`. This said "matches no uncovered
    // point", which is none of them — so a stale category exited 1 with its reason filtered out of the
    // summary. `issues/system/0222`.
    console.log(
      `\n${c.file} no longer holds any uncovered point matching the category "${c.holds}" — ` +
        `delete it or fix it`,
    );
    stale = true;
    continue;
  }
  byCategory += hit.length;
  for (const p of hit) spokenFor.add(`${p.file}:${p.line}`);
  console.log(`\n${hit.length}x ${c.proven ? "unreachable" : "reachable, NOT COVERED"}: ${c.file} — ${c.holds}\n  ${c.why}`);
}

// **The ratchet.** Every uncovered point is either driven, or written down above with a reason. A run
// that merely printed a number would let the next uncovered branch arrive unnoticed, which is how the
// three defects at the top of this file survived as long as they did.
// **The size of the set, not the sum of the lists.** A point named by a pin *and* matched by a
// category was counted twice, so the ratchet reported fewer unaccounted points than it then listed —
// 8 against 22 — and would have gone green with fourteen branches nobody had spoken for. Counting
// what is spoken for rather than how many times it was spoken for is the same distinction the report
// itself draws between points and mentions.
const accounted = spokenFor.size;
// Derived from the same set the listing prints, so the two can never disagree: an uncovered point is
// unaccounted exactly when nothing spoke for it. `total - covered - accounted` was a second way of
// saying it and drifted from the first the moment a pin and a category overlapped.
const leftover = missed.filter((p) => !spokenFor.has(`${p.file}:${p.line}`));
const missing = leftover.length;
if (missing > 0) {
  // **"branch point(s) uncovered", and the wording is load-bearing twice over.** It is one of the four
  // phrases `tools/coverageAll.ts` repeats, so saying it the other way round — "uncovered branch
  // point(s) are not accounted for" — meant this package's *principal* failure exited 1 with nothing on
  // screen but "(nothing matched the known failure shapes)". And line 153 of that file decides whether
  // a package holds a coverage floor by whether its driver says this: `fs` holds the most detailed
  // ledger here and was counted among the ones that only check their own exemptions.
  console.log(
    `\n${missing} reachable branch point(s) uncovered and not accounted for. Drive them, or add ` +
      `them to NOT_COVERED with the reason — and keep "proven" honest about which claim it is.`,
  );
  // **And say which.** A count on its own sends the reader back to the raw "never executed" list
  // above, which is every uncovered point including the ones already spoken for — so the work of
  // subtracting one list from the other fell to whoever read it, every time. `--verbose` prints the
  // leftovers with their source lines, which is the list somebody can actually act on.
  if (verbose) {
    console.log("\nunaccounted, with the line each one is on:");
    for (const p of leftover.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      const src = await sourceOf(p.file);
      console.log(`  ${p.file}:${p.line}  ${(src[p.line - 1] ?? "").trim().slice(0, 90)}`);
    }
  } else {
    console.log("  (--verbose lists them)");
  }
  stale = true;
}
if (stale) Deno.exit(1);
