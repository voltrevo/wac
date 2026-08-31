// `box`, end to end: every applet compared against the utility it imitates.
//
// Differential rather than expectation-based, deliberately. Each of these is checked
// against the real tool rather than against my idea of it, which is how `nl` numbering
// blank lines and `rev` reversing bytes instead of characters were both found — two bugs
// that a hand-written expectation would have enshrined instead.
//
// The suite lives with the package rather than with `platform` because `box` is a
// consumer of the world, not a part of it.

import { buildApp, type Grants } from "../../platform/build.ts";
import { appRunner } from "../../../harness/appRun.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { readUntil } from "../../../harness/deadline.ts";
import { withPort } from "../../../harness/port.ts";  // one allocator, pid-partitioned — wac-mono 0069

const BOX = "packages/box/src/box.wac";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    const detail = msg === undefined ? "" : ` \u2014 ${msg}`;
    throw new Error(
      `assertEquals failed${detail}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/** Build once, then run with the given stdin and arguments. */
async function runFilter(
  entry: string,
  args: string[],
  stdin: Uint8Array,
  grants: Grants = {},
): Promise<{ code: number; out: Uint8Array; err: string }> {
  const built = await Deno.makeTempFile({ prefix: "wac-filter-" });
  try {
    await buildApp(entry, built, grants);
    const child = new Deno.Command(built, {
      args,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(stdin);
    await w.close();
    const r = await child.output();
    return { code: r.code, out: r.stdout, err: new TextDecoder().decode(r.stderr) };
  } finally {
    await Deno.remove(built);
  }
}

/**
 * `assertEquals` above is `!==`, so two byte arrays are never equal to it. This says where
 * they diverge, which for a compressor is the only useful thing to be told.
 */
function assertSameBytes(got: Uint8Array, want: Uint8Array, msg: string): void {
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (got[i] !== want[i]) {
      throw new Error(
        `${msg}\n  first difference at byte ${i}: got ${got[i]}, want ${want[i]}` +
          ` (lengths ${got.length} and ${want.length})`,
      );
    }
  }
}


async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("box's applets agree with the system tools they imitate", async () => {
  // The widest test of the world so far, and a differential one: every applet here is
  // compared against the real utility rather than against my idea of it. `sha256sum` and
  // `base64` go through this repo's own crypto and codec packages, so this is also the
  // first application to compose several packages at once.
  const built = await Deno.makeTempFile({ prefix: "wac-box-" });
  const input = "alpha beta\ngamma\ndelta epsilon zeta\n";
  const fixture = await Deno.makeTempFile({ prefix: "wac-box-in-" });
  try {
    await buildApp(BOX, built, { read: true });
    await Deno.writeTextFile(fixture, input);

    // In this process, not a subprocess. `appRunner` is the launcher half of a built program, so
    // "running box" is a worker rather than a whole second Deno — 64ms against 112ms, measured, for
    // byte-identical output. The executable is still built above, because the tests that are *about*
    // process boundaries need a real one.
    //
    // **There is no `sys` helper here any more.** Every comparison against a real utility that this
    // test used to make is now a captured vector, so nothing left in this function runs GNU. What
    // remains asks box questions GNU cannot answer — refusals, grants, the dispatcher's own usage —
    // and the one comparison that still needs a live oracle went to `applets_test.wac`, where a wac
    // test can call `cli.exec` itself.
    const runner = await appRunner(BOX, { read: true });
    const box = (args: string[]) => runner.run(args);

    // **`cat`, `rev`, `nl`, `base64`, `sha256sum` and `wc` moved to `appletCases()`.** Each is
    // byte-for-byte against the real tool there, over `m1.txt`/`m2.txt` rather than this fixture, and
    // over two files as well as one — which is the stronger question, since wac-mono 0096 was ten
    // applets reading only the first of several. `wc`'s column padding travels with it: the vector
    // holds the real tool's whole line, filename included, so a loosened comparison cannot creep back.
    // Flags, which every applet gets from one shared parser.
    // **The flag sweep and both numeric cases moved to `appletCases()`**, with two fixtures of their
    // own. `nums.txt` exists because a words fixture cannot catch a missing `-n` — every line sorts as
    // zero, so ignoring the flag and honouring it agree, which is what `sort` did until
    // `seq 1 20 | sort -n` answered 1, 10, 11. `numeric.txt` is the other half: `-n` is a value for
    // `head` and `tail` and a boolean everywhere else, and while it was a value everywhere
    // `grep -n 123` searched for its own filename and stopped numbering. GitHub wac-mono#5.

    // **Both moved to `appletCases()`.** The eighteen trailing-slash paths through `basename` and
    // `dirname` — wac-mono#10, where `basename a/b/` answered with what follows the final slash, which
    // is nothing — and the four `head`/`tail` zeroes from wac-mono#8, where `Args.num` said zero for
    // an option asked for and one never given alike, so `head -0` printed the default ten. Both are
    // byte-for-byte against GNU there, captured once instead of spawning the real tool per case.

    // **`grep -n 123`, `sort -n` and the `seq` range ends are `appletCases()` now.** The seq pair is
    // wac-mono#7 and #6 — the counter wrapping and printing for ever at i32 max, and the formatter
    // answering with a bare "-" at i32 min — and both are pinned there against literal answers,
    // because GNU's `seq` and this one agree and a literal is what says *which* answer.

    // **`urlencode` and the missing-final-newline case have their own homes now.** `urlencode` is
    // `applets_test.wac`: its expectations are written down rather than captured, because there is no
    // portable system tool to ask — `jq -Rr @uri` and Python disagree about `~`. The newline case is
    // `diff_test.wac`, beside the rest of `diff`, since what it asserts is the marker GNU prints —
    // `\ No newline at end of file` — rather than a hunk to compare. GitHub wac-mono#9 and #22.

    // **What is left of wac-mono#17 is the grant.** The three cases that need a *mode* — a file in a
    // `0500` directory that `rm -f` must report rather than forgive, a missing file it must forgive,
    // and the same absence without `-f` — are `unreadable_test.wac` now, since `Cli.chmod` can build
    // that fixture (`issues/system/0296c`). This one cannot move: a program with **no write grant**
    // must answer denial rather than "there was nothing to do", and in process a frame inherits the
    // suite's own capabilities, so there is nothing to withhold.
    const guarded = await Deno.makeTempDir({ prefix: "wac-box-rmf-" });
    try {
      assertEquals((await box(["rm", "-f", `${guarded}/nothing-here`])).code, 1, "no write grant is denial");
    } finally {
      await Deno.remove(guarded, { recursive: true });
    }

    // **Moved to `applets_test.wac`.** The two failures `mkdir` and `rmdir` exist to distinguish,
    // said the way GNU says them — issue 0009 — and it is the *reason* that is compared rather than
    // the whole line, since box prefixes `applet: path: ` where GNU writes `mkdir: cannot create
    // directory 'd': `. That is house style; what matters is that the words are the category's and
    // not the host's, which vary per platform. It stays a live differential there rather than a
    // vector, precisely because the two lines are deliberately not byte-identical.

    // Symbolic links are refused, which tar.wac's header has always claimed. `stat` follows, so a
    // link to a directory was indistinguishable from the directory: it was walked into, stored under
    // the link's name, and a self-referential one grew the path until something trapped. `linkStat`
    // is what made the claim enforceable. GitHub wac-mono#25.
    //
    // **This one cannot move, and the reason is a capability rather than an oracle.** The fixture
    // needs three *symlinks*, and `Cli` can read a link — `linkStat` — and not make one. It is the
    // shape `chmod` was in until `issues/system/0296c`: the reading half present, the writing half
    // absent, so a test can ask about a link nobody in this system can create. `native_hostfs_test`
    // says the same thing from the other side: "there is no `ln` in this system, so a script cannot
    // create its own". Filed as `issues/system/0300c`.
    const linked = await Deno.makeTempDir({ prefix: "wac-box-link-" });
    await Deno.mkdir(`${linked}/real`);
    await Deno.writeTextFile(`${linked}/real/f`, "x");
    await Deno.symlink("real", `${linked}/toDir`);
    await Deno.symlink("real/f", `${linked}/toFile`);
    await Deno.symlink("loop", `${linked}/loop`);          // points at itself
    const tarred2 = new Deno.Command(built, {
      args: ["tar", "."],
      cwd: linked,
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    const said = new TextDecoder().decode(tarred2.stderr);
    assertEquals(tarred2.code, 1, "a refused entry is a failure");
    for (const name of ["toDir", "toFile", "loop"]) {
      assertEquals(said.includes(name), true, `${name} should be refused: ${said}`);
    }
    // And the archive it did produce is a real one: GNU tar lists the ordinary file and no link.
    const listing = await Deno.makeTempFile({ prefix: "wac-box-tar-", suffix: ".tar" });
    await Deno.writeFile(listing, tarred2.stdout);
    const listed = new Deno.Command("tar", { args: ["-tf", listing], stdout: "piped" }).outputSync();
    const inArchive = new TextDecoder().decode(listed.stdout);
    assertEquals(inArchive.includes("./real/f"), true, inArchive);
    assertEquals(
      inArchive.includes("toDir"),
      false,
      `a refused link must not be in the archive: ${inArchive}`,
    );
    await Deno.remove(listing);
    await Deno.remove(linked, { recursive: true });

    // **`--` moved to `appletCases()`** — wac-mono#11, where `cat -- -x` treated both as flags, found
    // no operand, read empty standard input and exited 0. The case makes its own `-x` rather than
    // taking a fixture, because a `-x` in `appletFixtures()` would appear in every `ls` case's output.

    // **Moved to `appletCases()`** — wac-mono#12, where a numeric sort key outside i32 wrapped, so
    // `4294967296` and `0` compared equal and `-nu` dropped one of them. Two cases, each writing its
    // own file, because they want different contents.

    // **Moved to `applets_test.wac`** — wac-mono#14, `split`'s suffixes past `zz`. GNU reserves a
    // leading `z` as the marker that the suffix has grown, so two letters run `aa`..`yz` and the next
    // name is `zaaa`; this used to leave the alphabet and emit `z676`. The comparison there is a
    // *directory listing* rather than standard output, which `split` does not write to at all, and GNU
    // runs in a directory of its own through `execWithIn`. 700 pieces, both ways, in 94 ms — where
    // this built a second binary with the write grant and spawned two processes.

    // **Moved to `applets_test.wac`** — wac-mono#26, where a pattern exhausting the backtracking
    // budget was counted as a match because only `NO_MATCH` was checked. Written down rather than
    // captured: GNU's `grep` has no budget to exhaust and answers 1 for this pattern, so the exit 2 is
    // ours to state. It is still spelled twice there, basic and `-E`, because `(a|a)*b` in the basic
    // dialect is the literal characters — which matches nothing and exits 1, and is how a version of
    // that test passed while asserting nothing (wac-mono 0104).

    // **Moved to `packages/box/test/wac/tar_test.wac`** — wac-mono#23, a name that does not fit a
    // ustar header. There was no check, so the header writer copied the first hundred bytes and
    // archived the entry under a *different* name: an archive that unpacks to something other than
    // what went in, which is the worst thing an archiver can do quietly. The symlink case below stays,
    // for a reason that is a capability rather than an oracle.

    // **Moved to `packages/box/test/wac/unreadable_test.wac`.** `find` and `du` over a subtree they
    // cannot enter — GitHub wac-mono#20, where both printed a partial answer and exited 0 — is a wac
    // test now. It was here only because the *fixture* needed `Deno.chmod`: making a directory
    // unreadable is a mode, and `Cli` carried `setExecutable`, which is one bit. `issues/system/0296c`
    // widened it, so the test went where the rest of box's are, and gained a root check the version
    // here depended on silently.

    // **Moved, and split by whether GNU has the tool** — wac-mono#18, where `readChunk` answers with
    // bytes and cannot say "broken", so every filter treated a half-read as a whole one and exited 0.
    // A directory is the portable way to get an open that succeeds and a read that does not.
    // `cat`, `wc`, `sha256sum` and `strings` are `appletCases()` against the real tools; `hex` and
    // `crc32` are ours, so bash answers 127 for them and they are written down in `applets_test.wac`.
    // `adir` is a directory *fixture* there, which the capture tool once wrote as an empty file — and
    // sixteen directory cases replayed as defects because `cat adir` had been captured exiting 0.

    // **Moved to `appletCases()`**: `head -3` and `tail -n 2` — the attached and detached forms of
    // one option — `sha512sum`, `base32`, every `grep` flag, and both of `grep`'s statuses. `wc -l`
    // went with them *whole line and all*, which is the assertion that matters: taking `[0]` was how
    // `wc -l file` came to drop the filename, the comparison throwing away the difference while the
    // applet's comment claimed the real one does the same. It does not — only standard input has no
    // name to print.
    //
    // `basename`, `dirname`, `echo`, `seq`, `true` and `false` are there too, in richer forms than
    // these: every trailing-slash path rather than one, and the range ends rather than `seq 3`.

    assertEquals((await box(["nope"])).code, 2, "an unknown applet is a usage error");
    // Asked for is not got wrong. Reaching the usage message by mistake is 2; asking for it is 0, which
    // is what every tool this package imitates does and what a script testing `box --help` expects.
    for (const how of ["help", "--help", "-h"]) {
      const asked = await box([how]);
      assertEquals(asked.code, 0, `box ${how} should succeed, got ${asked.code}`);
      assertEquals(asked.err.includes("usage: box"), true, `box ${how} should print the usage`);
    }

    // **Moved to `applets_test.wac`** — wac-mono 0005, the two mutants that survived. The tree there
    // is built three deep rather than borrowed from `packages/platform`, and the depth is *asserted*
    // before the comparison is believed: an earlier version of this walked `packages/platform/src`,
    // which is flat, so neither applet ever descended and gutting either one's `MAX_DEPTH` to zero
    // left both assertions passing.
    //
    // Each side is asked its own question there, which is why it is not a vector: box's `du` answers
    // in bytes and refuses `-s`, so GNU is asked `du -sb`, and `find`'s order is the filesystem's on
    // one side and sorted on the other.

    // **`ls` is `appletCases()` now**, and it had no comparison at all before this migration:
    // replacing its whole body with a default left the suite green, because `readDir`'s order is the
    // filesystem's while `ls` sorts. The capture pins `LC_ALL=C`, which is the collation the applet
    // implements — a locale-aware one is a different thing and is not implemented — and `ls` to a pipe
    // is already one name per line, so the vector is `ls -1` without having to ask for it.
    // A directory with dotfiles in it, since hiding them is half of what `ls` means by default.
    // **`ls -a` moved to `applets_test.wac`, and getting it there produced the tool the rest of this
    // migration was missing.** It cannot be asked through the vectors: those run a *shell*, `ls` is one
    // of the five shadowed names, the builtin wins and the builtin accepts `-a`. So `replay.wac` grew
    // `runApplet`, which builds a captured `Frame` and calls `dispatch` directly — no shell, no
    // process, and the flag reaches the applet that refuses it. Everything about flags and refusals
    // for those five names was invisible before it.

    // **The failed-read reasons moved to `applets_test.wac`, and stayed a live differential.** They
    // could not become vectors — the fixture needs a file at mode 0, and a `Fixture` has no mode — but
    // a wac test can spawn `cat` and `base64` itself through `cli.exec`, so the wac version asks GNU
    // the question at the moment it asks box rather than replaying an answer recorded earlier. It also
    // stopped pinning `LC_ALL=C` on the oracle, which had been removing the question along with the
    // variable: box's `faultWords` table is English, and a translated locale is a real disagreement.
    // The usage message lists every applet, wrapped. Nothing looked at it, so `wrapped` could return the
    // empty string — and the list of what this program can do would simply be missing.
    const help = await box([]);
    assertEquals(help.code, 2, "no applet is a usage error");
    for (const name of ["cat", "grep", "sha256sum", "zstd"]) {
      assertEquals(help.err.includes(name), true, `usage does not list ${name}:\n${help.err}`);
    }
    const appletLines = help.err.split("\n").filter((l) => l.startsWith("  ") && !l.includes(":"));
    assertEquals(appletLines.length > 1, true, `the applet list is not wrapped at all:\n${help.err}`);
    for (const line of appletLines) {
      assertEquals(line.length <= 74, true, `a usage line is ${line.length} wide: ${line}`);
    }

    // **`head` and `tail` with no count moved to `cases()`**, beside the `head -3 long.txt` family and
    // over the same 30-line fixture. It reads better there for a reason that is not tidiness: this
    // version ran GNU with an explicit `-10`, so it compared box's default against a *number* rather
    // than against GNU's default, and could not have seen the two disagree.
  } finally {
    await Deno.remove(built);
    await Deno.remove(fixture);
  }
});

Deno.test("a file still needs the grant, and says so", async () => {
  // **What is left of "box works as a filter".** The filter half — `wc` and `sha256sum` over standard
  // input, against the real tools — is `appletCases()` now, replayed in process by
  // `packages/box/test/wac/applets_test.wac` against expectations captured once. Reading standard input
  // is not a capability, so none of it needed a built program.
  //
  // This half does. The claim is about an application handed **no filesystem**, and in process the frame
  // inherits the suite's own capabilities — so an in-process version would asserted nothing. It is one of
  // the things `issues/system/0193` lists as staying: the grants a *built* applet asks for.
  //
  // "Not granted to this application" is `faultWords`' phrase for `FAULT_NOT_GRANTED`. "Permission
  // denied" would be wrong: nothing denied anything, the program was never handed a filesystem.
  const denied = await runFilter(BOX, ["cat", "README.md"], new Uint8Array());
  assertEquals(denied.code, 1);
  assertEquals(denied.err.includes("Not granted to this application"), true, denied.err);
});

// **Moved to `packages/box/test/wac/writepath_test.wac`.** `cp` crossing chunk boundaries, copying
// over an existing file, and leaving no temporary beside a failed target — all assertions about our
// own behaviour, checkable with `cli.readFile` and `cli.readDir` in this process. The fixture is
// 500,003 bytes there rather than 5,000,003: the property is that the copy crosses boundaries, and
// seven of them shows it as well as seventy.


// **Moved to `packages/box/test/wac/writepath_test.wac`.** `tee`'s two destinations are a pipeline
// and a `readFile`, neither of which needs a process.



// **Moved to `packages/box/test/wac/wcwords_test.wac`** — `issues/system/0143`, where `wc -w` split on
// ASCII whitespace and counted a run as a word only if an ASCII printable was in it. Eighteen code
// points between two words and alone, a character broken across the 64 KiB chunk boundary at every
// offset, and `spec/tour.wac` itself, all against the real `wc` through `cli.exec` with the ambient
// environment — pinning `LC_ALL=C` is how the gap survived, so the wac version does not pin it either.
//
// `fold`, `cut` and `tr` over non-ASCII went to `appletCases()` instead, over a new `uni.txt` fixture.
// **One of those four rows had been asserting nothing**: it ran `tr a-z A-Z uni.txt`, which the real
// `tr` refuses as an extra operand, and compared stdout only with stderr discarded — two empty strings.
// The vector spells it `tr a-z A-Z < uni.txt` and captures the status as well. `rev` is deliberately
// not in that row; `cases.wac` says why, and `issues/system/0301c` is the question it raises.

// **Moved to `packages/box/test/wac/fsdump_test.wac`.** It was the last survivor of "the applets that
// read several files read all of them" — the other fifteen are `appletCases()` now — and its own note
// said it stayed "until something reads a repo-relative fixture from inside a frame". `runApplet` is
// that something: the frame's `cwd` is the test's, so an absolute path built from `cli.cwd()` reaches
// `packages/fs/test/fixtures/image-v1.wacimg`. The oracle is still the shape; there is no real tool
// that reads a filesystem image of ours.



// **Moved to `packages/box/test/wac/packaged_test.wac`.** `gzip` and `gunzip` are still checked in
// *both* directions against the system tool — ours reads theirs and theirs reads ours — because a round
// trip through our own code alone passes with a compressor and a decompressor that agree on something
// nobody else can read. `crc32` is against a CRC table written out in the test, `date` against the
// system `date` rather than our own parser, and `urlencode`/`urldecode` round-trip four strings
// including one already percent-encoded.

Deno.test("cp writes beside its target and renames, and none of the tier happens without the grant", async () => {
  // `writeFile` was the only mutation the world had, which meant an application could
  // create a file but never remove or move one — so it could not write safely either.
  // These three ops are what `cp` needs to write beside its target and rename into place.
  const built = await Deno.makeTempFile({ prefix: "wac-box-m-" });
  const root = await Deno.makeTempDir({ prefix: "wac-box-fs-" });
  try {
    await buildApp(BOX, built, { read: true, write: true });
    const box = (args: string[]) => {
      const r = new Deno.Command(built, { args, stdout: "piped", stderr: "piped" }).outputSync();
      return { code: r.code, err: new TextDecoder().decode(r.stderr) };
    };
    const exists = async (p: string) => {
      try {
        await Deno.stat(p);
        return true;
      } catch {
        return false;
      }
    };

    // **The rest of the tier is `test/wac/applets_test.wac`** — `mkdir -p` and its parents, `touch`
    // leaving an existing file alone, `mv`, `rmdir` refusing a non-empty directory, `rm` needing `-r`.
    // Those are assertions about our own behaviour and need neither a build nor a process.
    //
    // What is left here is the grant, which is a property of the built program and the host that
    // enforces it — a test process holds grants of its own, so it cannot ask. `cp` writing beside its
    // target *is* asserted in process now, since `issues/system/0166` was fixed and a frame carries a
    // child's redirection; this keeps the spawned spelling of it, which is the smoke test the boundary
    // is entitled to.
    // The point of the tier: `cp` writes beside its target and renames, so the destination
    // is never seen half-written and no temporary name survives a successful copy.
    assertEquals(box(["cp", "README.md", `${root}/copy`]).code, 0);
    assertEquals(
      await Deno.readTextFile(`${root}/copy`),
      await Deno.readTextFile("README.md"),
      "cp copied it",
    );
    const left: string[] = [];
    for await (const e of Deno.readDir(root)) left.push(e.name);
    // Just the copy: `moved` was the `mv` step, which is in the wac file now.
    assertEquals(left.sort().join(","), "copy", `a temporary file survived: ${left}`);

    // And without the write grant none of it happens, whatever the arguments say.
    const readOnly = await Deno.makeTempFile({ prefix: "wac-box-ro-" });
    try {
      await buildApp(BOX, readOnly, { read: true });
      const r = new Deno.Command(readOnly, {
        args: ["mkdir", `${root}/denied`],
        stdout: "piped",
        stderr: "piped",
      }).outputSync();
      assertEquals(r.code, 1, "mkdir without the grant should fail");
      assertEquals(await exists(`${root}/denied`), false, "and should make nothing");
    } finally {
      await Deno.remove(readOnly);
    }
  } finally {
    await Deno.remove(built);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("bin/: one applet alone states only the grants it needs", async () => {
  // Neither `DENO_EMIT_CACHE_MODE=disable` nor `--no-code-cache` is a permission. They turn off Deno's
  // two caches, both of which key on something unique to a built program and so grow without bound: the
  // V8 code cache added 166 MB per run of *this file*, and the transpile cache leaves an entry under
  // `gen/file/tmp/` for every temp-file program ever run. 28 GB and 23 GB respectively, on a shared
  // disk (wac-mono 0068). Asserted in full rather than filtered out, because the next thing somebody
  // adds to a built program's shebang should have to be thought about here.
  //
  // The README has been claiming that a multicall binary costs you the permission story
  // and that built separately each applet would state its own. This measures it rather
  // than asserting it: `wc` and `sha256sum` come out with an empty shebang, and a `wc`
  // built that way cannot open a file even when told to.
  const cases: Array<{ name: string; grants: Grants; shebang: string }> = [
    { name: "wc", grants: {}, shebang: "#!/usr/bin/env -S DENO_EMIT_CACHE_MODE=disable deno run --no-code-cache" },
    { name: "sha256sum", grants: {}, shebang: "#!/usr/bin/env -S DENO_EMIT_CACHE_MODE=disable deno run --no-code-cache" },
    {
      name: "grep",
      grants: { read: true },
      shebang: "#!/usr/bin/env -S DENO_EMIT_CACHE_MODE=disable deno run --no-code-cache --allow-read",
    },
    {
      name: "cp",
      grants: { read: true, write: true },
      shebang: "#!/usr/bin/env -S DENO_EMIT_CACHE_MODE=disable deno run --no-code-cache --allow-read --allow-write",
    },
  ];
  const built: string[] = [];
  try {
    for (const c of cases) {
      const out = await Deno.makeTempFile({ prefix: `wac-bin-${c.name}-` });
      built.push(out);
      // `coverage: false`: the shebangs below are compared exactly, and an instrumented build carries
      // a scoped `--allow-write` for its coverage dump. That difference is real and is asserted in
      // `packages/platform/test/subprocess_profile.test.ts`; here it would be noise. wac-mono 0024.
      await buildApp(`packages/box/src/bin/${c.name}.wac`, out, c.grants, "deno", false, {
        coverage: false,
      });
      const first = (await Deno.readTextFile(out)).split("\n")[0];
      assertEquals(first, c.shebang, `${c.name}'s shebang`);
    }

    const [wc, sha, grep, cp] = built;
    const pipe = (path: string, args: string[], input: string) => {
      const child = new Deno.Command(path, {
        args, stdin: "piped", stdout: "piped", stderr: "piped",
      }).spawn();
      const w = child.stdin.getWriter();
      w.write(new TextEncoder().encode(input)).then(() => w.close());
      return child.output();
    };
    const dec = new TextDecoder();

    // The applet is the same code, so it must behave the same with no `box` in front.
    const text = "alpha beta\ngamma\n";
    // The real one decides the text, here as everywhere else in this file.
    const ref = new Deno.Command("wc", { stdin: "piped", stdout: "piped", stderr: "null" }).spawn();
    const rw = ref.stdin.getWriter();
    await rw.write(new TextEncoder().encode(text));
    await rw.close();
    const refOut = dec.decode((await ref.output()).stdout);
    assertEquals(dec.decode((await pipe(wc, [], text)).stdout), refOut);
    assertEquals(dec.decode((await pipe(wc, ["-l"], text)).stdout).trim(), "2", "flags still parse");
    assertEquals(
      dec.decode((await pipe(sha, [], text)).stdout).trim().endsWith("  -"),
      true,
      "stdin is still '-'",
    );
    assertEquals(dec.decode((await pipe(grep, ["-c", "beta"], text)).stdout).trim(), "1");

    // And a program with no grants cannot be talked into a read, whatever it is passed.
    const denied = await pipe(wc, ["README.md"], "");
    assertEquals(denied.code, 1);
    assertEquals(dec.decode(denied.stderr).includes("Not granted to this application"), true);
    // It names itself, not `box` — the entry point in `bin/` passes the name, because a
    // program in this model is never handed its own argv[0].
    assertEquals(dec.decode(denied.stderr).startsWith("wc: "), true, dec.decode(denied.stderr));

    // The one with grants does the real thing.
    const dst = await Deno.makeTempFile({ prefix: "wac-bin-dst-" });
    try {
      const r = new Deno.Command(cp, { args: ["README.md", dst], stderr: "piped" }).outputSync();
      assertEquals(r.code, 0, dec.decode(r.stderr));
      assertEquals(await Deno.readTextFile(dst), await Deno.readTextFile("README.md"));
    } finally {
      await Deno.remove(dst);
    }

    // The size of what you gave up: `box` carries every applet and every grant.
    //
    // **A difference, not a ratio, and that is the second version of this assertion.** It read
    // `alone * 2 < all`, which compares two files that share ~550 KB of *identical host runtime* — so
    // the ratio decays toward 1.0 as that runtime grows, whatever happens to the applets. Measured
    // 2026-08-23, it had 3,795 bytes of headroom out of 1.1 MB: 0.3%, and the 7 KB that `Cli.load`
    // added to every built program (`issues/system/0240c`) took it under. The number that moved was
    // the runtime's, and the claim being made is about the *applets*.
    //
    // So: `box`'s 65 applets are their own content, and 400 KB of it is a floor with room to spare —
    // the difference measured the same day was 560,264 bytes. This one does not move when the host
    // gains a capability, which is the property the ratio was missing.
    const alone = (await Deno.stat(wc)).size;
    const all = await Deno.makeTempFile({ prefix: "wac-bin-box-" });
    built.push(all);
    await buildApp(BOX, all, { read: true, write: true });
    const boxSize = (await Deno.stat(all)).size;
    assertEquals(
      boxSize - alone > 400_000,
      true,
      `box carries every applet: ${boxSize} - ${alone} = ${boxSize - alone}, wanted > 400000`,
    );
  } finally {
    for (const b of built) await Deno.remove(b);
  }
});
/** Run a built applet with `input` on standard input and return its output. */
async function pipedThrough(binary: string, args: string[], input: string): Promise<string> {
  const child = new Deno.Command(binary, {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  // **Start draining before writing.** A large input fills the child's output pipe while we are still
  // pushing its input, and nothing is reading the far end — so both sides block and the test hangs. It
  // did, for ten minutes. `output()` is started first and awaited last.
  const done = child.output();
  const w = child.stdin.getWriter();
  try {
    await w.write(new TextEncoder().encode(input));
    await w.close();
  } catch {
    // The applet exited without reading, which is its business.
  }
  const r = await done;
  return new TextDecoder().decode(r.stdout);
}

Deno.test("a streaming applet with no grants still says why", async () => {
  // **What is left of "streaming applets hold a chunk, not the input".** The comparisons went to
  // `packages/box/test/wac/streaming_test.wac`: `wc` and `strings` against the real ones over a fixture
  // spanning several chunks, a 200,000-byte run that must come back as *one* string rather than one per
  // read, `tr` through standard input because it takes no file operand, `hex`'s framing as a length, and
  // `crc32` against a CRC table written out there — the one case that is order-dependent over every
  // byte, so a chunk handed over twice or not at all changes the answer.
  //
  // **This half cannot follow them, and the reason is the interesting one.** `runApplet` builds a frame
  // whose `Cli` is `childCli(f, cli)`, and that passes the parent's grants straight through: an
  // in-process frame can be given the same authority as the test or more, never less. A refusal test
  // needs *fewer*, so it needs a real process with a real grant set — which is what `appRunner` with an
  // empty world is. Every refusal assertion in this file is here for that one reason.
  //
  // The message shape is the claim, not just the status: a denied read must say why, which a
  // bool-returning `openInput` could not.
  const fixture = await Deno.makeTempFile({ prefix: "wac-stream-in-" });
  try {
    await Deno.writeTextFile(fixture, "alpha beta\n");
    const ungranted = await appRunner(BOX, {});
    const r = await ungranted.run(["cat", fixture]);
    assertEquals(r.code, 1);
    assertEquals(r.err.includes("Not granted to this application"), true, r.err);
  } finally {
    await Deno.remove(fixture);
  }
});

// **Moved to `packages/box/test/wac/lines_test.wac`.** `head`, `tail`, `nl` and `uniq` against the real
// ones over a multi-chunk fixture with blank lines, adjacent duplicates and non-ASCII in it, and over
// a file with no final newline — which the five do not treat alike, so each is asked. The quadratic
// guard travels with them: half a megabyte on one line, `tail -1`, timed with `core.monotonicNanos`.
//
// `rev` did **not** travel as a comparison. Ours walks scalars whatever the locale says and the real
// one follows `LC_CTYPE`, so spawning it would assert a different thing depending on the environment
// the suite ran in. Its non-ASCII answer is written down there instead — `issues/system/0301c`.

/**
 * A port nobody is using, taken by binding one and letting go.
 *
 * A fixed number would collide with whatever else is on the machine, and these tests run
 * in parallel with each other.
 */


/**
 * Wait until the server says it is listening, by reading the line it prints.
 *
 * Deliberately not by connecting. `serve -o` handles exactly one connection, so a probe
 * that dials the port *is* that connection — the first version of this test did that and
 * then hung waiting for a server that had already served the probe and exited.
 *
 * Returns the stderr it consumed, so a caller can still assert on it afterwards.
 */
function waitForListening(server: Deno.ChildProcess, port: number): Promise<string> {
  // Bounded, via `harness/deadline.ts`. The loop this replaces handled the server *exiting* and not
  // the server *living without printing* — a child that fails to bind and sits there yields neither a
  // chunk nor a `done`, so the read never settled and took the whole suite with it. 0036.
  return readUntil(server.stderr, `listening on port ${port}`, `box serve on port ${port}`);
}

Deno.test("box's network applets: a wac server and a wac client, over real TCP", async () => {
  // The first applets that are not filters. `packages/server`'s `serve(input, now)` is a
  // pure state machine — bytes in, a response and a consumed count out — so the socket
  // loop is thirty lines and nothing in that package knows a socket exists.
  //
  // A free port is taken by binding one and letting go; a fixed number would collide with
  // whatever else is on this machine, and these tests run in parallel with each other.
  const built = await Deno.makeTempFile({ prefix: "wac-net-" });
  try {
    await buildApp(BOX, built, { net: true });
    // `withPort` rather than `freePort`: the number is handed to a *child*, so the window between
    // letting go and its bind is the race wac-mono 0069 named and 0131 saw. `serve` prints
    // `Address already in use` when it loses, `waitForListening` puts what the child printed into
    // the error it throws, and `isAddrInUse` reads it — so this retries that and nothing else.
    await withPort(async (port) => {
    // `-o` serves one connection and exits. Not `-1`: a leading digit is how this argument
    // parser spells a number, so `serve -8080 -1` set the port to 1 — which is how the
    // first run of this ended up listening on port 1.
    const server = new Deno.Command(built, {
      args: ["serve", `-${port}`, "-o"],
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    const listening = await waitForListening(server, port);
    assertEquals(
      listening.includes(`listening on port ${port}`),
      true,
      "it says where it is listening",
    );
    const conn = await Deno.connect({ hostname: "127.0.0.1", port });

    await conn.write(new TextEncoder().encode(
      `GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
    ));
    const parts: Uint8Array[] = [];
    const buf = new Uint8Array(4096);
    for (;;) {
      const n = await conn.read(buf);
      if (n === null) break;
      parts.push(buf.slice(0, n));
    }
    conn.close();
    const reply = new TextDecoder().decode(
      new Uint8Array(parts.flatMap((p) => Array.from(p))),
    );
    assertEquals(reply.startsWith("HTTP/1.1 200 OK\r\n"), true, reply.slice(0, 80));
    assertEquals(reply.includes("wac http server"), true, reply.slice(0, 200));

    server.stdout.cancel();
    assertEquals((await server.status).code, 0, "the server exited cleanly");
    });

    // And the client half against the server half: two wac programs, one socket, no
    // TypeScript in between. Started together — `serve` blocks in `accept` until `get`
    // arrives, which is the whole point of a synchronous capability world.
    await withPort(async (port2) => {
    const server2 = new Deno.Command(built, {
      args: ["serve", `-${port2}`, "-o"],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    await waitForListening(server2, port2);
    const client = new Deno.Command(built, {
      args: ["get", "127.0.0.1", "/", `-${port2}`, "-i"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const got = await client;
    const body = new TextDecoder().decode(got.stdout);
    assertEquals(got.code, 0, new TextDecoder().decode(got.stderr));
    assertEquals(body.includes("HTTP 200"), true, body.slice(0, 120));
    assertEquals(body.trimEnd().endsWith("wac http server"), true, body.slice(0, 200));
    server2.stdout.cancel();
    assertEquals((await server2.status).code, 0, "the second server exited cleanly");
    });

    // Without the grant, nothing — whatever the arguments say.
    //
    // Any port will do here and none has to be free: the grant check refuses before a socket is
    // asked for, which is the assertion. A number that nothing binds cannot race with anything.
    const noNet = await Deno.makeTempFile({ prefix: "wac-nonet-" });
    try {
      await buildApp(BOX, noNet, {});
      const denied = new Deno.Command(noNet, {
        args: ["get", "127.0.0.1", "/", "-9"],
        stdout: "piped",
        stderr: "piped",
      }).outputSync();
      assertEquals(denied.code, 1);
      // The host's own sentence, not `faultWords`' phrase: a connection failure is not a `Change` and
      // carries no category, so what reaches the applet is the message. "network access not granted to
      // this application" says more than any phrase would, which is the argument the fault categories
      // make in reverse — see `packages/platform/test/faults_agree.test.ts`.
      assertEquals(
        new TextDecoder().decode(denied.stderr).includes("network access not granted"),
        true,
        new TextDecoder().decode(denied.stderr),
      );
    } finally {
      await Deno.remove(noNet);
    }
  } finally {
    await Deno.remove(built);
  }
});

Deno.test("yes stops when the pipe it writes to is closed", async () => {
  // **What is left of "box's newest batch".** `sponge`, `zstd`, `json`, `stat`, `uuid`, `shuf` and
  // `paste` are `packages/box/test/wac/batch_test.wac` now — including `sponge`'s second assertion,
  // that no temporary file survived, which is the half saying the atomicity was real rather than that
  // the answer happened to be right.
  //
  // **`yes` could not go with them, and it is the clearest case in this file of why some cannot.**
  // Every other applet here is judged by what it writes, which a frame captures. This one never ends on
  // its own: it stops because `write` reports the closed pipe, and *that* is why `write` returns a bool
  // at all. Closing the read end of a pipe and waiting for the child to die is a process lifecycle, and
  // an in-process frame has no pipe to close.
  const built = await Deno.makeTempFile({ prefix: "wac-yes-" });
  try {
    await buildApp(BOX, built, { read: true, write: true });
    const yes = new Deno.Command(built, { args: ["yes", "wac"], stdout: "piped", stderr: "null" }).spawn();
    const reader = yes.stdout.getReader();
    const first = await reader.read();
    assertEquals(new TextDecoder().decode(first.value).startsWith("wac\nwac\n"), true);
    await reader.cancel();
    const status = await yes.status;
    assertEquals(status.success || status.signal !== null, true, "yes stopped when the pipe closed");
  } finally {
    await Deno.remove(built);
  }
});

Deno.test("httpd serves a directory, and refuses to leave it", async () => {
  // The first applet that composes the network *and* the filesystem. The path check is the
  // part worth testing hardest: a request target is the one input here that is supposed to
  // be hostile, and `..` is refused outright rather than resolved, because resolving is
  // where traversal bugs live.
  const built = await Deno.makeTempFile({ prefix: "wac-httpd-" });
  const root = await Deno.makeTempDir({ prefix: "wac-httpd-www-" });
  try {
    await buildApp(BOX, built, { read: true, net: true });
    await Deno.writeTextFile(`${root}/index.html`, "<h1>hi</h1>\n");
    await Deno.writeTextFile(`${root}/notes.txt`, "plain\n");
    await Deno.mkdir(`${root}/sub`);
    await Deno.writeTextFile(`${root}/sub/index.html`, "deep\n");
    // The file the traversal case is trying to reach, one level above the root.
    await Deno.writeTextFile(`${root}/../wac-httpd-secret.txt`, "should not be served\n");

    // **`withPort` rather than `freePort`.** `freePort` binds a port, lets go, and hands back the
    // number — and `harness/port.ts` says of it that "the window is the same one this file exists to
    // shrink". Under a full suite that window is real: this test is one of the two sightings in
    // wac-mono 0131, where the suite failed one test per run and a different one each time. `httpd`
    // says `Address already in use (os error 98)` on its standard error when it loses the race,
    // `waitForListening` puts what the child printed into the error it throws, and `isAddrInUse`
    // reads it — so the retry is a retry of exactly this and nothing else.
    const request = (target: string) =>
      withPort(async (port) => {
      const server = new Deno.Command(built, {
        args: ["httpd", `-${port}`, root, "-o"],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      await waitForListening(server, port);
      // Cancel both pipes before waiting on the child. Deno will not resolve `status`
      // while a piped stream is unread, so cancelling *after* it is a deadlock — which is
      // how the first version of this test hung rather than failed.
      server.stdout.cancel();
      server.stderr.cancel();
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      await conn.write(new TextEncoder().encode(
        `GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      ));
      const parts: number[] = [];
      const buf = new Uint8Array(4096);
      for (;;) {
        const n = await conn.read(buf);
        if (n === null) break;
        parts.push(...buf.slice(0, n));
      }
      conn.close();
      await server.status;
      return new TextDecoder().decode(new Uint8Array(parts));
      });

    const index = await request("/");
    assertEquals(index.startsWith("HTTP/1.1 200 OK\r\n"), true, index.slice(0, 60));
    // From the *resolved* path, not the target: `/` becomes `index.html`, and typing that
    // as application/octet-stream would make a browser download the page instead.
    assertEquals(index.includes("Content-Type: text/html"), true, index.slice(0, 200));
    assertEquals(index.trimEnd().endsWith("<h1>hi</h1>"), true);

    const txt = await request("/notes.txt");
    assertEquals(txt.includes("Content-Type: text/plain"), true, txt.slice(0, 200));

    // A directory resolves to its index, with or without the trailing slash.
    assertEquals((await request("/sub/")).trimEnd().endsWith("deep"), true);
    assertEquals((await request("/sub")).trimEnd().endsWith("deep"), true);

    // The query is not part of the path.
    assertEquals((await request("/notes.txt?v=2")).trimEnd().endsWith("plain"), true);

    assertEquals((await request("/nope")).startsWith("HTTP/1.1 404 "), true);
    assertEquals((await request("/../wac-httpd-secret.txt")).startsWith("HTTP/1.1 403 "), true);
    assertEquals((await request("/sub/../../wac-httpd-secret.txt")).startsWith("HTTP/1.1 403 "), true);
    // A relative target never reaches the path check: `packages/http` rejects an
    // origin-form target without a leading slash as malformed, which is 400 rather than
    // 403. Asserted as 400 because that is what happens, not because it is what I guessed.
    assertEquals((await request("notes.txt")).startsWith("HTTP/1.1 400 "), true);
    assertEquals((await request("/a\\b")).startsWith("HTTP/1.1 403 "), true);

    const post = await withPort(async (port) => {
      const server = new Deno.Command(built, {
        args: ["httpd", `-${port}`, root, "-o"], stdout: "piped", stderr: "piped",
      }).spawn();
      await waitForListening(server, port);
      server.stdout.cancel();
      server.stderr.cancel();
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      await conn.write(new TextEncoder().encode(
        `POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
      ));
      const buf = new Uint8Array(256);
      const n = await conn.read(buf);
      conn.close();
      await server.status;
      return new TextDecoder().decode(buf.slice(0, n ?? 0));
    });
    assertEquals(post.startsWith("HTTP/1.1 405 "), true, post.slice(0, 60));
  } finally {
    await Deno.remove(built);
    await Deno.remove(root, { recursive: true });
    try { await Deno.remove(`${root}/../wac-httpd-secret.txt`); } catch { /* gone with the dir */ }
  }
});

Deno.test("wget writes one file, fetched from box's own httpd", async () => {
  // `wget` is `get` with the output pointed at a file, and is three lines different from it:
  // `openOutput` moves where `cli.write` goes, so the fetch does not know.
  //
  // **The `split` half of this test moved to `packages/box/test/wac/applets_test.wac`** — 250 lines at
  // 100 to a piece, compared against the real `split` piece for piece, including the assertion that
  // there is no empty fourth one. None of that needed a process.
  //
  // **This half needs two.** A server and a client, both of them wac programs, with a real socket
  // between them and a file at the end of it. `runApplet` runs one applet in one frame; nothing about
  // it makes a second program to talk to, so this is a boundary test in the plainest sense.
  const built = await Deno.makeTempFile({ prefix: "wac-wget-" });
  const dir = await Deno.makeTempDir({ prefix: "wac-wget-d-" });
  try {
    await buildApp(BOX, built, { read: true, write: true, net: true });
    const run = (args: string[], cwd: string) =>
      new Deno.Command(built, { args, cwd, stdout: "piped", stderr: "piped" }).outputSync();
    const lines = Array.from({ length: 250 }, (_, i) => `${i + 1}`).join("\n") + "\n";
    await Deno.writeTextFile(`${dir}/big.txt`, lines);

    // wget, against box's own httpd — two wac programs and a file at the end of it.
    await withPort(async (port) => {
      const server = new Deno.Command(built, {
        args: ["httpd", `-${port}`, dir, "-o"], stdout: "piped", stderr: "piped",
      }).spawn();
      await waitForListening(server, port);
      server.stdout.cancel();
      server.stderr.cancel();
      const got = run(["wget", "127.0.0.1", "/big.txt", "saved.txt", `-${port}`], dir);
      assertEquals(got.code, 0, new TextDecoder().decode(got.stderr));
      assertEquals(await Deno.readTextFile(`${dir}/saved.txt`), lines, "wget saved the body");
      await server.status;
    });
  } finally {
    await Deno.remove(built);
    await Deno.remove(dir, { recursive: true });
  }
});

// **Moved to `packages/box/test/wac/tar_test.wac`**, beside the ustar name-limit case that was already
// there. GNU tar lists, extracts and `diff -r`s what box writes — through box's `gzip` as well as raw —
// and it is checked against the real format rather than against our own reader, because a round trip
// with our reader passes with a checksum that is wrong in a self-consistent way, which is exactly the
// mistake ustar's checksum invites. Perturbing the expected listing shows GNU tar really does find all
// seven entries, `src/empty/` among them: the empty directory survives only if its own entry is written.


Deno.test("gets: TLS 1.3 in wac, against a real TLS server", async () => {
  // `packages/tls` needed no changes for this. `tlsClientInit`/`tlsClientFeed` are a state
  // machine over byte arrays — the same shape `packages/server` has — and a state machine
  // is what a socket wants. The applet is the driver and nothing else.
  //
  // The server is Deno's own TLS stack with this repo's test certificate, so the handshake
  // is against a real implementation rather than against the same code playing both parts.
  // It runs as a *subprocess*: an in-process `Deno.listenTls` and this test runner do not
  // compose, and chasing that is not what this test is for.
  const built = await Deno.makeTempFile({ prefix: "wac-tls-" });
  const dir = await Deno.makeTempDir({ prefix: "wac-tls-d-" });
  try {
    await buildApp(BOX, built, { read: true, net: true });
    const data = `${Deno.cwd()}/packages/tls/test/data`;
    // The trust store the client is handed: DER, because that is what a certificate is
    // once the PEM armour is off.
    await Deno.writeFile(`${dir}/ca.der`, pemToDer(await Deno.readTextFile(`${data}/ca.pem`)));
    await Deno.writeFile(`${dir}/other.der`, pemToDer(await Deno.readTextFile(`${data}/other_ca.pem`)));

    const body = "hello from a real TLS server\n";
    await Deno.writeTextFile(`${dir}/server.ts`, `
      const cert = await Deno.readTextFile(${JSON.stringify(`${data}/leaf.pem`)});
      const key = await Deno.readTextFile(${JSON.stringify(`${data}/leaf.key`)});
      const l = Deno.listenTls({ hostname: "127.0.0.1", port: Number(Deno.args[0]), cert, key });
      console.error("listening on port " + Deno.args[0]);
      try {
        const conn = await l.accept();
        await conn.read(new Uint8Array(4096));
        await conn.write(new TextEncoder().encode(
          "HTTP/1.1 200 OK\\r\\nContent-Type: text/plain\\r\\nContent-Length: ${body.length}" +
          "\\r\\nConnection: close\\r\\n\\r\\n${body.trimEnd()}\\n"));
        conn.close();
      } catch { /* the client refused the certificate, which is a case below */ }
      l.close();
    `);

    const startServer = () => withPort(async (port) => {
      const p = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", `${dir}/server.ts`, `${port}`],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      await waitForListening(p, port);
      p.stdout.cancel();
      p.stderr.cancel();
      return { port, p };
    });

    // `localhost` is in the certificate's SAN, and `ca.der` signed it.
    const good = await startServer();
    const ok = await new Deno.Command(built, {
      args: ["gets", "localhost", "/", `${dir}/ca.der`, `-${good.port}`, "-i"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    await good.p.status;
    const out = new TextDecoder().decode(ok.stdout);
    assertEquals(ok.code, 0, new TextDecoder().decode(ok.stderr));
    assertEquals(out.includes("HTTP 200"), true, out.slice(0, 200));
    assertEquals(out.trimEnd().endsWith(body.trimEnd()), true, out.slice(0, 300));

    // The check is the point. A root that did not sign this certificate must fail, and
    // fail *before* any application data — a client that verified after reading the body
    // would pass a test that only looked at the exit code.
    const bad = await startServer();
    const refused = await new Deno.Command(built, {
      args: ["gets", "localhost", "/", `${dir}/other.der`, `-${bad.port}`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    await bad.p.status;
    assertEquals(refused.code, 1, "an untrusted root must not connect");
    assertEquals(refused.stdout.length, 0, "and must produce no body at all");
    assertEquals(
      new TextDecoder().decode(refused.stderr).includes("connection failed"),
      true,
      new TextDecoder().decode(refused.stderr),
    );
  } finally {
    await Deno.remove(built);
    await Deno.remove(dir, { recursive: true });
  }
});

/** The DER inside PEM armour. */
function pemToDer(pem: string): Uint8Array {
  const b64 = pem.split("\n").filter((l) => !l.startsWith("-----")).join("");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

Deno.test("nc relays both directions at once", async () => {
  // The applet that could not be written until `waitAny` existed. A relay has to watch the
  // socket *and* standard input: wait on the socket alone and a client that speaks first is
  // never heard; wait on stdin alone and a server that greets you is never printed. Standard
  // input is handle 0, so both sides are the same primitive — two `recv` in flight and a
  // park on whichever answers.
  //
  // The peer here greets *before* reading, so a relay that serviced stdin first would hang
  // and a relay that serviced the socket first would never send. Only watching both passes.
  const built = await Deno.makeTempFile({ prefix: "wac-nc-" });
  try {
    await buildApp(BOX, built, { net: true });

    // **Bound before the number is handed out.** This asked `freePort` for a number, let it go, and
    // then listened on it — the exact probe-close-hand-over shape `harness/port.ts` exists to describe,
    // with an extra window because the listen happens later still. Several agents share this machine and
    // it lost a gate run to `AddrInUse` from somebody else's server. The listener here is *ours* and is
    // never released, so binding `port: 0` first and reading the number back has no window at all.
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    const seen: string[] = [];
    const peer = (async () => {
      const l = listener;
      try {
        const c = await l.accept();
        await c.write(new TextEncoder().encode("peer speaks first\n"));
        const buf = new Uint8Array(4096);
        const n = await c.read(buf);
        seen.push(new TextDecoder().decode(buf.subarray(0, n ?? 0)).trimEnd());
        c.close();
      } catch { /* the client may have closed first */ }
      try { l.close(); } catch { /* already closed */ }
    })();

    const nc = new Deno.Command(built, {
      args: ["nc", "127.0.0.1", `${port}`],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const w = nc.stdin.getWriter();
    await w.write(new TextEncoder().encode("client speaks second\n"));
    await w.close();

    const out = await nc.output();
    await peer;
    assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
    // Downstream: the greeting arrived even though stdin had something waiting.
    assertEquals(
      new TextDecoder().decode(out.stdout).trimEnd(),
      "peer speaks first",
      "the peer's greeting did not reach standard output",
    );
    // Upstream: and what stdin held was sent.
    assertEquals(seen.join(""), "client speaks second", "standard input did not reach the peer");
  } finally {
    await Deno.remove(built);
  }
});

Deno.test("nc -l takes one connection", async () => {
  const built = await Deno.makeTempFile({ prefix: "wac-ncl-" });
  try {
    await buildApp(BOX, built, { net: true });
    await withPort(async (port) => {
    const server = new Deno.Command(built, {
      args: ["nc", `-${port}`, "-l"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    // It prints the same "listening on port" line `serve` and `httpd` do, which is what a
    // caller waits for rather than sleeping.
    await waitForListening(server, port);
    server.stderr.cancel();

    const conn = await Deno.connect({ hostname: "127.0.0.1", port });
    await conn.write(new TextEncoder().encode("over the wire\n"));
    conn.close();
    const sw = server.stdin.getWriter();
    await sw.close();

    const out = await server.output();
    assertEquals(
      new TextDecoder().decode(out.stdout).trimEnd(),
      "over the wire",
      "the listener did not relay what it was sent",
    );
    });
  } finally {
    await Deno.remove(built);
  }
});



