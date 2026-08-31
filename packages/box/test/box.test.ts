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
    // byte-identical output. The executable is still built above: `sysCode` compares against it,
    // and the tests that are *about* process boundaries need a real one.
    const runner = await appRunner(BOX, { read: true });
    const box = (args: string[]) => runner.run(args);
    const sysCode = (cmd: string, args: string[]) =>
      new Deno.Command(cmd, { args, stdout: "null", stderr: "null" }).outputSync().code;
    const sys = (cmd: string, args: string[]) => {
      const r = new Deno.Command(cmd, { args, stdout: "piped", stderr: "null" }).outputSync();
      return new TextDecoder().decode(r.stdout);
    };

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

    // A name that does not fit a ustar header is refused, which is what tar.wac has always claimed.
    // There was no check, so the header writer copied the first 100 bytes and archived the entry
    // under a different name. GitHub wac-mono#23.
    const deep = await Deno.makeTempDir({ prefix: "wac-box-tar-" });
    const longDir = `${deep}/${"d".repeat(40)}`;
    await Deno.mkdir(longDir);
    await Deno.writeTextFile(`${longDir}/${"f".repeat(70)}`, "x");
    const tarred = new Deno.Command(built, {
      args: ["tar", "."],
      cwd: deep,
      stdout: "null",
      stderr: "piped",
    }).outputSync();
    assertEquals(tarred.code, 1, "an unarchivable name is a failure");
    assertEquals(
      new TextDecoder().decode(tarred.stderr).includes("longer than the 100 bytes"),
      true,
      "and says why",
    );
    await Deno.remove(deep, { recursive: true });

    // **Moved to `packages/box/test/wac/unreadable_test.wac`.** `find` and `du` over a subtree they
    // cannot enter — GitHub wac-mono#20, where both printed a partial answer and exited 0 — is a wac
    // test now. It was here only because the *fixture* needed `Deno.chmod`: making a directory
    // unreadable is a mode, and `Cli` carried `setExecutable`, which is one bit. `issues/system/0296c`
    // widened it, so the test went where the rest of box's are, and gained a root check the version
    // here depended on silently.

    // A read that fails is not an end of input. `readChunk` answers with bytes and cannot say
    // "broken", so every filter treated a half-read as a whole one and exited 0 — the failure mode
    // where the program is the last thing suspected. `inputError` is the reason, asked once when the
    // chunks stop. A directory is the portable way to get an open that succeeds and a read that does
    // not. GitHub wac-mono#18.
    for (const applet of ["cat", "wc", "hex", "crc32", "sha256sum", "strings"]) {
      const r = (await box([applet, "/tmp"]));
      assertEquals(r.code, 1, `${applet} of a directory should fail, got ${r.code}`);
    }
    // And the real ones agree that it is a failure.
    assertEquals(
      new Deno.Command("cat", { args: ["/tmp"], stdout: "null", stderr: "null" }).outputSync().code,
      1,
      "GNU cat agrees",
    );

    assertEquals((await box(["head", "-3", fixture])).out, sys("head", ["-3", fixture]), "head -N");
    assertEquals((await box(["tail", "-n", "2", fixture])).out, sys("tail", ["-n", "2", fixture]), "tail -n N");
    // The whole line, not just the first field. Taking `[0]` was how `wc -l file` came to drop the
    // filename: the assertion threw away the difference, and the applet's comment claimed the real one
    // does the same. It does not — only reading standard input has no name to print.
    assertEquals((await box(["wc", "-l", fixture])).out, sys("wc", ["-l", fixture]), "wc -l over a file");
    assertEquals(
      (await box(["sha512sum", fixture])).out.split(" ")[0],
      sys("sha512sum", [fixture]).split(" ")[0],
      "sha512sum differs",
    );
    assertEquals((await box(["base32", fixture])).out, sys("base32", [fixture]), "base32 differs");

    // grep, which brings the regex package in. Every flag against the real thing.
    for (const args of [["grep", "an"], ["grep", "-i", "AN"], ["grep", "-v", "an"],
                        ["grep", "-n", "an"], ["grep", "-c", "an"]]) {
      assertEquals(
        (await box([...args, fixture])).out,
        sys("grep", [...args.slice(1), fixture]),
        `${args.join(" ")} differs`,
      );
    }
    assertEquals((await box(["grep", "zzznope", fixture])).code, 1, "no match exits 1, as grep does");
    assertEquals((await box(["grep", "[", fixture])).code, 2, "a bad pattern is a usage error");

    assertEquals((await box(["basename", "a/b/c.txt"])).out.trim(), "c.txt");
    assertEquals((await box(["dirname", "a/b/c.txt"])).out.trim(), "a/b");
    assertEquals((await box(["echo", "hello", "wac"])).out.trim(), "hello wac");
    assertEquals((await box(["seq", "3"])).out.trim().split("\n").join(","), "1,2,3");
    assertEquals((await box(["true"])).code, 0);
    assertEquals((await box(["false"])).code, 1);
    assertEquals((await box(["nope"])).code, 2, "an unknown applet is a usage error");
    // Asked for is not got wrong. Reaching the usage message by mistake is 2; asking for it is 0, which
    // is what every tool this package imitates does and what a script testing `box --help` expects.
    for (const how of ["help", "--help", "-h"]) {
      const asked = await box([how]);
      assertEquals(asked.code, 0, `box ${how} should succeed, got ${asked.code}`);
      assertEquals(asked.err.includes("usage: box"), true, `box ${how} should print the usage`);
    }

    // The first applets that recurse, against the real tools over a nested tree.
    //
    // `packages/platform` rather than `packages/platform/src`, which is **flat**: every file in it is a
    // `.wac`, so neither applet ever descended and the comparison said nothing about recursion. Gutting
    // either applet's `MAX_DEPTH` to zero — which stops all descent — left both of these passing, and
    // that is how the two mutants survived (wac-mono 0005). The subdirectory check below is here so the
    // same thing cannot happen again by somebody choosing a tidier-looking path.
    const tree = "packages/platform";
    const theirFind = sys("find", [tree]).trim().split("\n");
    assertEquals(
      theirFind.some((p) => p.slice(tree.length + 1).includes("/")),
      true,
      `${tree} has no subdirectory: this comparison would not exercise recursion at all`,
    );
    assertEquals(
      (await box(["find", tree])).out.trim().split("\n").sort().join("\n"),
      theirFind.sort().join("\n"),
      "find differs",
    );
    assertEquals(
      (await box(["du", tree])).out.split("\t")[0],
      sys("du", ["-sb", tree]).split("\t")[0],
      "du differs from du -sb",
    );

    // `ls`, which nothing compared: replacing its whole body with a default left this suite green, and
    // the reason is that `readDir`'s order is the filesystem's while `ls` sorts. `LC_ALL=C` is set
    // explicitly here because that is the collation the applet implements — a locale-aware one is a
    // different thing and is not implemented.
    const sysLs = (dir: string) =>
      new TextDecoder().decode(
        new Deno.Command("ls", {
          args: ["-1", dir],
          env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
          clearEnv: true,
          stdout: "piped",
          stderr: "null",
        }).outputSync().stdout,
      );
    assertEquals((await box(["ls", tree])).out, sysLs(tree), "ls differs from ls -1");
    // A directory with dotfiles in it, since hiding them is half of what `ls` means by default.
    assertEquals((await box(["ls", "."])).out, sysLs("."), "ls of the repo root differs");
    // And a flag it does not implement is refused rather than ignored, which is the other half.
    const dashA = await box(["ls", "-a", tree]);
    assertEquals(dashA.code, 2, `ls -a should be a usage error: ${JSON.stringify(dashA.err)}`);
    assertEquals(dashA.err.includes("not implemented"), true, dashA.err);

    // A directory of its own for the two unreadable paths, so nothing else in this test can see them.
    const fixtureDir = await Deno.makeTempDir({ prefix: "wac-box-fail-" });
    // **A failed read says what the real tool says.** The words come from `faultWords` in
    // `platform.wac`, which exists because four copies of this list had already drifted — and nothing
    // compared any of them to the tool they imitate. Replacing the lookup `lib/input` used with the
    // empty string left every one of these messages ending in a bare colon, and the suite green. (That
    // lookup was `whyUnread`, one of the four; it is `platform.wac`'s `readReason` now, beside the
    // table, and `lib/input` calls it directly rather than wrapping it.)
    const denied = `${fixtureDir}/unreadable`;
    await Deno.writeTextFile(denied, "secret\n");
    await Deno.chmod(denied, 0o000);
    // Both halves of the read path, because they are separate code and drifted apart once: `cat` streams
    // through `openInput`, `base64` takes the whole file through `readFile`, and each translates its own
    // failure — `lib/input.wac` has a function per half. `base64` is the oracle for the second because GNU
    // words it the same way; `sort` says "cannot read:", `tac` says "failed to open ... for reading", and
    // comparing against either would be comparing a different sentence rather than the same reason.
    for (const [applet, path] of [
      ["cat", `${fixtureDir}/definitely-not-here`],
      ["cat", denied],
      ["base64", `${fixtureDir}/definitely-not-here`],
      ["base64", denied],
    ] as const) {
      const ours = await box([applet, path]);
      const theirs = new Deno.Command(applet, {
        args: [path],
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
        clearEnv: true,
        stdout: "null",
        stderr: "piped",
      }).outputSync();
      // After the program name: `Deno.Command` resolves `cat` through PATH and hands it that path as
      // argv[0], so the real one says `/usr/bin/cat:` where ours says `cat:`. The reason is the claim.
      const reason = (line: string) => line.trim().split(": ").slice(1).join(": ");
      assertEquals(
        reason(ours.err),
        reason(new TextDecoder().decode(theirs.stderr)),
        `the reason ${applet} gave differs from the real one's: ${ours.err.trim()}`,
      );
      assertEquals(ours.code, 1, `a failed read exits 1, as ${applet} does`);
    }

    // The directory the two unreadable paths live in, removed here rather than left behind: this was
    // one directory per run, and the machine had 1,061 of them on 2026-08-11 with the disk at 100%
    // and every agent's push failing on it. `chmod 000` is why it needs the recursive form.
    await Deno.chmod(denied, 0o600).catch(() => {});
    await Deno.remove(fixtureDir, { recursive: true }).catch(() => {});
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

    // head and tail against a file with more lines than they take.
    const many = await Deno.makeTempFile();
    try {
      await Deno.writeTextFile(many, Array.from({ length: 15 }, (_, i) => i + 1).join("\n") + "\n");
      assertEquals((await box(["head", many])).out, sys("head", ["-10", many]), "head differs");
      assertEquals((await box(["tail", many])).out, sys("tail", ["-10", many]), "tail differs");
    } finally {
      await Deno.remove(many);
    }
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



Deno.test("wc -w splits words where wc(1) splits them, including the code points that are not spaces", async () => {
  // `wc -w` used to split on ASCII whitespace and count a run as a word only if an ASCII *printable* was
  // in it. Both halves are the C locale's answer, and the comment defending them said "there is no such
  // locale to compare against" for the other one — which was wrong: `locale -a` lists `C.utf8`, and
  // `LC_ALL` on this machine **is** `C.UTF-8`, so every differential here was already asking the real
  // `wc` a UTF-8 question and getting away with it because no fixture had a byte over 0x7F. On
  // `spec/tour.wac` the gap was 110 words (issues/system 0143).
  //
  // The real one is spawned with the ambient environment on purpose. Pinning `LC_ALL=C` here would make
  // this pass without the fix, which is exactly how the gap survived.
  const dir = await Deno.makeTempDir({ prefix: "wac-box-words-" });
  try {
    // **`env` is granted, and that is part of the claim now.** `wc` reads `LC_CTYPE`/`LC_ALL` since
    // `issues/system/0297c`, so a box built without the environment falls back to the C locale and
    // counts bytes — correct POSIX behaviour, and not what the real `wc` beside it is doing, which has
    // the ambient `C.UTF-8`. Withholding it here compares two different questions and the answers
    // differ on the very first non-ASCII case.
    const runner = await appRunner(BOX, { read: true, env: true });
    const wcOut = (args: string[]) => {
      const r = new Deno.Command("wc", { args, stdout: "piped", stderr: "null" }).outputSync();
      return new TextDecoder().decode(r.stdout);
    };
    const real = (path: string) => wcOut(["-w", path]);
    // All three columns, for the cases where a mishandled character could move the byte or line count
    // as well as the word count.
    const sysWc = (path: string) => wcOut([path]);
    // Every row measured against `wc -w` before it was written down, and the *shape* of the rule is the
    // reason the list is not just "more spaces":
    //
    //   - a separator ends a run. U+00A0 and U+202F are separators to `wc` and are **not** `iswspace`
    //     in this locale, so a list built from `iswspace` gets them wrong;
    //   - U+2028 and U+2029 are `iswspace` and are **not** separators — a run containing one is a single
    //     word, so `a\u{2028}b` is one, not two, and a fix that split on everything non-ASCII fails here;
    //   - U+2060 is a separator and is not a space in any category. It is on the list because `wc` says
    //     so, which is the only reason anything is on this list.
    const cases: [string, string][] = [
      ["nbsp", "\u{00A0}"], ["em space", "\u{2003}"], ["figure space", "\u{2007}"],
      ["ogham space", "\u{1680}"], ["narrow nbsp", "\u{202F}"], ["medium math space", "\u{205F}"],
      ["ideographic space", "\u{3000}"], ["en quad", "\u{2000}"], ["hair space", "\u{200A}"],
      ["word joiner", "\u{2060}"],
      ["line separator", "\u{2028}"], ["paragraph separator", "\u{2029}"], ["next line", "\u{0085}"],
      ["zero width space", "\u{200B}"],
      ["em dash", "\u{2014}"], ["box drawing", "\u{2500}"], ["e acute", "\u{00E9}"],
      ["emoji", "\u{1F600}"],
    ];
    for (const [name, ch] of cases) {
      // Between two words, and alone: the second is what says whether the code point is a *word* on its
      // own, which is a different question from whether it separates and has a different answer for
      // U+200B (a word) and U+2028 (not one).
      for (const [shape, text] of [["between", `a${ch}b\n`], ["alone", `${ch}\n`]]) {
        const path = `${dir}/case.txt`;
        await Deno.writeTextFile(path, text);
        const got = await runner.run(["wc", "-w", path]);
        assertEquals(got.out, real(path), `wc -w on ${name} ${shape}`);
      }
    }
    // **A character split across a read.** Everything above fits in one 64 KiB chunk, so none of it
    // reaches the code that holds a partial sequence until the next chunk arrives — the half of this
    // that is not a table lookup. Each case puts a multi-byte character across the boundary at a
    // different offset, so the sequence is broken after its first, second and third byte in turn.
    for (const [ch, name] of [["\u{2014}", "em dash"], ["\u{1F600}", "emoji"]]) {
      const bytes = new TextEncoder().encode(ch).length;
      for (let split = 1; split < bytes; split++) {
        const path = `${dir}/split.txt`;
        // The filler is words, so the counts either side of the boundary are non-trivial rather than
        // one long run: a broken sequence that got dropped or doubled moves the answer.
        const filler = "word ".repeat(20000).slice(0, 65536 - split);
        await Deno.writeTextFile(path, `${filler}${ch} tail\n`);
        const got = await runner.run(["wc", path]);
        assertEquals(got.out, sysWc(path), `${name} broken after ${split} byte(s) at the chunk boundary`);
      }
    }

    // And the file the issue was reported against, which is 110 words of em dash and box-drawing rule.
    const tour = new URL("../../../spec/tour.wac", import.meta.url).pathname;
    assertEquals((await runner.run(["wc", "-w", tour])).out, real(tour), "wc -w on spec/tour.wac");

    // **The other applets that walk text**, which 0143 named as candidates for the same assumption
    // without claiming they had it. They do not: GNU's `fold`, `cut` and `tr` are byte-oriented here
    // too, so byte-oriented is the *correct* answer for them and matching `wc` would break them. That
    // is worth a comparison rather than a sentence, because "we looked once" is not a property a
    // repository keeps.
    const uni = `${dir}/uni.txt`;
    await Deno.writeTextFile(uni, "h\u{00E9}llo w\u{00F6}rld\u{00A0}two\n\u{00E9}\u{00E0}\u{2014}\u{00FC}\n");
    for (const args of [["fold", "-w", "5"], ["cut", "-c", "1-4"], ["cut", "-b", "1-4"],
                        ["tr", "a-z", "A-Z"], ["rev"]]) {
      const r = new Deno.Command(args[0], { args: [...args.slice(1), uni], stdout: "piped", stderr: "null" })
        .outputSync();
      assertEquals((await runner.run([...args, uni])).out, new TextDecoder().decode(r.stdout),
        `${args.join(" ")} on non-ASCII text`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fsdump reads an image, names its operands, and refuses what is not one", async () => {
  // **What is left of "the applets that read several files read all of them".** The fifteen applets and
  // their one-file counterparts are `appletCases()` now, captured against the real tools once and
  // replayed in process — the property they hold is wac-mono 0096, `box cat a b` printing `a` and
  // exiting 0 without mentioning `b`, for ten applets at once.
  //
  // `fsdump` could not go with them: it reads a **filesystem image**, a format of ours, so there is no
  // real tool to capture an answer from. It has no external oracle at all — the oracle is the shape —
  // which by `issues/system/0193` makes it a candidate for moving in process rather than for a vector.
  // It stays here until something reads a repo-relative fixture from inside a frame.

  const dir = await Deno.makeTempDir({ prefix: "wac-box-multi-" });
  try {
    const a1 = `${dir}/a.txt`, a2 = `${dir}/b.txt`;
    await Deno.writeTextFile(a1, "alpha\nbeta\ngamma\n");
    await Deno.writeTextFile(a2, "delta\nepsilon\n");
    const runner = await appRunner(BOX, { read: true });
    // `fsdump` reads a filesystem image, which is a format of ours — so there is no counterpart here
    // either, and the oracle is again the shape. `packages/fs/test/wac/image_test.wac` is where the format is
    // checked; what matters at this end is that the applet is wired up, names its operands, and *fails*
    // on something that is not an image rather than printing an empty tree.
    const img = "packages/fs/test/fixtures/image-v1.wacimg";
    const dumped = await runner.run(["fsdump", img]);
    assertEquals(dumped.code, 0, dumped.err);
    assertEquals(dumped.out.includes("mount /mnt"), true, dumped.out);
    assertEquals(dumped.out.includes("0600 claude"), true, dumped.out);

    const piped = await runner.run(["fsdump"], { stdin: await Deno.readFile(img) });
    assertEquals(piped.out, dumped.out, "an image on standard input reads the same as one named");

    const twice = await runner.run(["fsdump", img, img]);
    assertEquals(twice.out, `${img}:\n${dumped.out}${img}:\n${dumped.out}`, "two images are labelled");

    const notAnImage = await runner.run(["fsdump", a1]);
    assertEquals(notAnImage.code, 1, "a file that is not an image should fail");
    assertEquals(notAnImage.out.includes("cannot read this image"), true, notAnImage.out);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});



Deno.test("box's package-backed applets: gzip, gunzip, crc32, date, urlencode", async () => {
  // These are the point of `box`: each is a few lines over a package written in this repo
  // for TypeScript bindings, reused unchanged as the inside of a program. The compression
  // ones are checked against the system `gzip` in *both* directions, so neither side can be
  // wrong in a way the other cancels out.
  const built = await Deno.makeTempFile({ prefix: "wac-box-g-" });
  try {
    await buildApp(BOX, built, { read: true });
    const raw = await Deno.readFile("README.md");

    const run = (args: string[], input: Uint8Array) => {
      const child = new Deno.Command(built, {
        args, stdin: "piped", stdout: "piped", stderr: "piped",
      }).spawn();
      const w = child.stdin.getWriter();
      w.write(input).then(() => w.close());
      return child.output();
    };
    const sysRun = (cmd: string, args: string[], input: Uint8Array) => {
      const child = new Deno.Command(cmd, {
        args, stdin: "piped", stdout: "piped", stderr: "null",
      }).spawn();
      const w = child.stdin.getWriter();
      w.write(input).then(() => w.close());
      return child.output();
    };

    const squeezed = (await run(["gzip"], raw)).stdout;
    assertEquals(squeezed.length < raw.length, true, "gzip did not compress");
    assertSameBytes((await run(["gunzip"], squeezed)).stdout, raw, "box could not read its own gzip");
    assertSameBytes(
      (await sysRun("gunzip", [], squeezed)).stdout,
      raw,
      "the system gzip could not read box's",
    );
    assertSameBytes(
      (await run(["gunzip"], (await sysRun("gzip", ["-c"], raw)).stdout)).stdout,
      raw,
      "box could not read the system gzip's",
    );

    // crc32 against the checksum gzip itself carries, computed independently here.
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    let crc = 0xFFFFFFFF;
    for (const b of raw) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    const expect = ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, "0");
    assertEquals(new TextDecoder().decode((await run(["crc32"], raw)).stdout).trim(), `${expect}  -`);

    // `date` is the clock capability with a package on top; it must be RFC 3339 and now.
    const now = new TextDecoder().decode((await run(["date"], new Uint8Array())).stdout).trim();
    const parsed = Date.parse(now);
    assertEquals(Number.isNaN(parsed), false, `not a date: ${now}`);
    assertEquals(Math.abs(parsed - Date.now()) < 60_000, true, `not now: ${now}`);

    // Percent-encoding round-trips, including bytes that are not ASCII at all.
    const enc = new TextEncoder();
    for (const s of ["a b/c?d=e&f#g", "ünïcode ✓", "plain", "%already%20encoded"]) {
      const encoded = (await run(["urlencode"], enc.encode(s + "\n"))).stdout;
      assertEquals(
        new TextDecoder().decode(encoded).includes(" "),
        false,
        "a space survived encoding",
      );
      assertEquals(
        new TextDecoder().decode((await run(["urldecode"], encoded)).stdout),
        s + "\n",
        `${s} did not round-trip`,
      );
    }
  } finally {
    await Deno.remove(built);
  }
});

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

Deno.test("streaming applets hold a chunk, not the input", async () => {
  // The point of `openInput`/`readChunk`. Correctness first — a streaming rewrite is easy
  // to get subtly wrong at a chunk boundary, and every case here is one that a
  // whole-input loop would have got right for free:
  //
  //   wc       a word split across two reads is one word, not two
  //   strings  a run split across two reads is one run, not two short ones
  //   crc32    the checksum is order-dependent across every chunk
  //   tr, hex  per byte, so only the framing can go wrong
  const fixture = await Deno.makeTempFile({ prefix: "wac-stream-in-" });
  try {
    // Deliberately larger than one 64K chunk and not a multiple of it, so boundaries land
    // in the middle of words and runs rather than tidily between them.
    const CHUNK = 1 << 16;
    const parts: string[] = [];
    for (let i = 0; i < 5000; i++) parts.push(`word${i} alpha beta gamma delta epsilon\n`);
    const text = parts.join("");
    assertEquals(text.length > 3 * CHUNK, true, "the fixture must span several chunks");
    await Deno.writeTextFile(fixture, text);

    // In a worker: what is under test is `openInput`/`readChunk` inside the applet, and a chunk
    // boundary falls in the same place whether the program was started as a process or not.
    const runner = await appRunner(BOX, { read: true });
    const box = async (args: string[]) => await runner.run(args);
    const sys = (cmd: string, args: string[]) =>
      new TextDecoder().decode(
        new Deno.Command(cmd, { args, stdout: "piped", stderr: "null" }).outputSync().stdout,
      );

    // The real `wc` pads its columns; the numbers are what is under test.
    const cols = (s: string) => s.trim().split(/\s+/).slice(0, 3).join(" ");
    assertEquals(cols((await box(["wc", fixture])).out), cols(sys("wc", [fixture])), "wc across chunks");
    // Through standard input, because `tr` takes no file operand — GNU's does not either, and this one
    // stopped pretending to (wac-mono 0098). The streaming property is the same either way.
    assertEquals(
      (await runner.run(["tr", "a-z", "A-Z"], { stdin: text })).out,
      text.toUpperCase(),
      "tr across chunks",
    );

    // A run that spans several chunks must come out as one string, not several.
    const spanning = await Deno.makeTempFile({ prefix: "wac-stream-span-" });
    try {
      const run = new Uint8Array(200_000 + 2);
      run[0] = 0;
      run.fill(65, 1, 200_001);
      run[200_001] = 0;
      await Deno.writeFile(spanning, run);
      assertEquals(
        (await box(["strings", spanning])).out,
        sys("strings", ["-n4", spanning]),
        "a 200K run spanning three chunks is one string",
      );
    } finally {
      await Deno.remove(spanning);
    }

    assertEquals((await box(["strings", fixture])).out, sys("strings", ["-n4", fixture]), "strings");
    assertEquals((await box(["hex", fixture])).out.length, text.length * 2 + 1, "hex is 2 chars a byte");
    assertEquals(
      (await box(["crc32", fixture])).out.split(" ")[0],
      (() => {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
          table[i] = c >>> 0;
        }
        let crc = 0xFFFFFFFF;
        for (const b of new TextEncoder().encode(text)) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
        return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, "0");
      })(),
      "crc32 across chunks",
    );

    // The reason the message shape matters: a denied read must still say why, which a
    // bool-returning `openInput` could not.
    // A world with no grants at all, which `appRunner` builds the same way a process would: the
    // refusal is the runtime's, not the launcher's.
    const ungranted = await appRunner(BOX, {});
    const r = await ungranted.run(["cat", fixture]);
    assertEquals(r.code, 1);
    assertEquals(r.err.includes("Not granted to this application"), true, r.err);
  } finally {
    await Deno.remove(fixture);
  }
});

Deno.test("line-oriented applets stream too, and stay faithful at the edges", async () => {
  // `tail` was written off as unstreamable, wrongly: it has to *reach* the end but only
  // has to *hold* N lines. `head` is better still — it stops reading once it has them.
  //
  // Converting them turned up two bugs that predate this and that the old fixture could
  // not see, because it had no blank lines and no text outside ASCII: `nl` numbered blank
  // lines, and `rev` reversed bytes rather than characters, so an em dash came back as
  // three replacement characters.
  const fixture = await Deno.makeTempFile({ prefix: "wac-lines-in-" });
  const nonl = await Deno.makeTempFile({ prefix: "wac-lines-nonl-" });
  const oneline = await Deno.makeTempFile({ prefix: "wac-lines-one-" });
  try {

    // Spans several 64K chunks, with blank lines, repeats and non-ASCII in it.
    const rows: string[] = [];
    for (let i = 0; i < 4000; i++) {
      rows.push(`line ${i} — ünïcode`);
      if (i % 7 === 0) rows.push("");
      if (i % 11 === 0) rows.push("repeated");
      if (i % 11 === 0) rows.push("repeated");
    }
    await Deno.writeTextFile(fixture, rows.join("\n") + "\n");
    await Deno.writeTextFile(nonl, "alpha\nbravo");
    // One line and no newline at all: the shape that made the first line reader quadratic.
    await Deno.writeTextFile(oneline, "x".repeat(500_000));

    // **In a worker, not a process.** This test is about what the applets *answer*, and the first test
    // in this file already makes that comparison through `appRunner` — 1ms a run against about 110ms
    // for the built executable, for byte-identical output. Nineteen runs here were two seconds of
    // Deno starting up. The tests that are genuinely about a process boundary still build one.
    const runner = await appRunner(BOX, { read: true });
    const box = async (args: string[], file: string) => (await runner.run([...args, file])).out;
    const sys = (cmd: string, args: string[], file: string) =>
      new TextDecoder().decode(
        new Deno.Command(cmd, { args: [...args, file], stdout: "piped", stderr: "null" })
          .outputSync().stdout,
      );

    for (const [mine, real] of [
      [["head"], ["head"]],
      [["head", "-3"], ["head", "-3"]],
      [["tail"], ["tail"]],
      [["tail", "-3"], ["tail", "-3"]],
      [["tail", "-1"], ["tail", "-1"]],
      [["nl"], ["nl"]],
      [["rev"], ["rev"]],
      [["uniq"], ["uniq"]],
      [["uniq", "-c"], ["uniq", "-c"]],
    ] as const) {
      assertEquals(await box([...mine], fixture), sys(real[0], real.slice(1), fixture), `${mine.join(" ")}`);
      // A file with no final newline: `head`, `tail` and `rev` preserve that and `nl` and
      // `uniq` add one. Not uniform, so each is checked rather than assumed.
      assertEquals(await box([...mine], nonl), sys(real[0], real.slice(1), nonl), `${mine.join(" ")} unterminated`);
    }

    // `tail -N` asks for more lines than exist, and for exactly one.
    assertEquals(await box(["tail", "-100000"], fixture), sys("tail", ["-100000"], fixture), "tail past the start");

    // Half a megabyte with no newline in it: one line, and it must not take quadratic time.
    // The first reader appended with `concat` and rescanned from the start after every
    // refill; on a 300MB version of this it had not finished after two minutes.
    const started = performance.now();
    assertEquals((await box(["tail", "-1"], oneline)).length, 500_000, "one very long line");
    assertEquals(
      performance.now() - started < 15_000,
      true,
      "a single long line should be linear, not quadratic",
    );
  } finally {
    for (const f of [fixture, nonl, oneline]) await Deno.remove(f);
  }
});

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

Deno.test("box's newest batch: sponge, zstd, json, stat, uuid, shuf, paste, yes", async () => {
  const built = await Deno.makeTempFile({ prefix: "wac-b3-" });
  const dir = await Deno.makeTempDir({ prefix: "wac-b3-d-" });
  try {
    // **A worker for the answers, a process for the one that has to be killed.** Every applet below is
    // judged by what it writes, and `appRunner` gives that in about a millisecond against roughly a
    // hundred for the built executable — this test was two seconds of Deno starting up, twelve times.
    // The executable is still built, for `yes` at the end: that one never stops on its own and is
    // ended by closing the pipe it writes to, which is a *process* lifecycle a worker run does not
    // have.
    await buildApp(BOX, built, { read: true, write: true });
    const runner = await appRunner(BOX, { read: true, write: true });
    const run = async (args: string[]) => await runner.run(args);
    const pipe = async (args: string[], input: Uint8Array) => await runner.run(args, { stdin: input });
    const enc = new TextEncoder();

    // ── sponge: the applet that only exists because of the atomic write ──
    // `box sort f | box sponge f` works where `sort f > f` cannot, because the shell
    // truncates `f` before `sort` has read a byte of it. That is the whole point.
    const target = `${dir}/inplace`;
    const original = "delta\nalpha\ncharlie\nbravo\n";
    await Deno.writeTextFile(target, original);
    const sorter = await run(["sort", target]);
    const soak = await pipe(["sponge", target], sorter.bytes);
    assertEquals(soak.code, 0, soak.err);
    assertEquals(await Deno.readTextFile(target), "alpha\nbravo\ncharlie\ndelta\n", "sorted in place");
    // And no temporary file survived it.
    const left: string[] = [];
    for await (const e of Deno.readDir(dir)) left.push(e.name);
    assertEquals(left.join(","), "inplace", `left behind: ${left}`);

    // ── zstd: the largest package here, round-tripped ──
    const raw = await Deno.readFile("README.md");
    const squeezed = (await pipe(["zstd"], raw)).bytes;
    assertEquals(squeezed.length < raw.length, true, "zstd did not compress");
    assertSameBytes((await pipe(["unzstd"], squeezed)).bytes, raw, "zstd round trip");

    // ── json: canonical output, and a real parse error ──
    const canon = await pipe(["json", "-c"], enc.encode(`{"b":1,"a":[2, 3 ],"c":"x"}`));
    assertEquals(canon.out.trim(), `{"b":1,"a":[2,3],"c":"x"}`);
    // Two spellings of the same document canonicalise identically, which is the property
    // that makes this worth having on a pipe rather than a pretty-printer.
    const spaced = await pipe(["json", "-c"], enc.encode(`{ "b" : 1 , "a" : [ 2 , 3 ] , "c" : "x" }`));
    assertEquals(spaced.out, canon.out);
    // Without -c it is a validator: silent and exit 0, so it composes in a test.
    const valid = await pipe(["json"], enc.encode(`[1,2,3]`));
    assertEquals(valid.code, 0);
    assertEquals(valid.bytes.length, 0, "a validator says nothing");
    const bad = await pipe(["json"], enc.encode(`{"a":}`));
    assertEquals(bad.code, 1);
    assertEquals(bad.err.includes("invalid JSON at byte"), true);

    // ── stat: the capability nothing surfaced ──
    await Deno.writeTextFile(`${dir}/sized`, "12345");
    const st = await run(["stat", `${dir}/sized`, dir]);
    assertEquals(st.code, 0, st.err);
    const rows = st.out.trim().split("\n");
    assertEquals(rows[0].includes(" file 5 "), true, rows[0]);
    assertEquals(rows[1].includes(" directory "), true, rows[1]);
    // The mtime is RFC 3339 and recent, which is `datetime` doing the work.
    const when = Date.parse(rows[0].split(" ").pop()!);
    assertEquals(Math.abs(when - Date.now()) < 120_000, true, rows[0]);
    assertEquals((await run(["stat", `${dir}/absent`])).code, 1, "a missing path is an error");

    // ── uuid: version 4, and different every time ──
    const ids = (await run(["uuid", "-20"])).out.trim().split("\n");
    assertEquals(ids.length, 20);
    for (const id of ids) {
      assertEquals(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
        true,
        `not a v4 uuid: ${id}`,
      );
    }
    assertEquals(new Set(ids).size, 20, "twenty draws should be twenty values");

    // ── shuf: a permutation, not a sample ──
    const lines = Array.from({ length: 200 }, (_, i) => `line${i}`);
    await Deno.writeTextFile(`${dir}/lines`, lines.join("\n") + "\n");
    const shuffled = (await run(["shuf", `${dir}/lines`])).out.trim().split("\n");
    assertEquals(shuffled.length, 200);
    assertEquals(shuffled.slice().sort().join(","), lines.slice().sort().join(","), "same lines");
    assertEquals(shuffled.join(",") !== lines.join(","), true, "and in some other order");
    assertEquals((await run(["shuf", "-5", `${dir}/lines`])).out.trim().split("\n").length, 5);
    // **A different order each time**, which is the part the checks above cannot see. `below` — the
    // rejection-sampled index the shuffle draws — could return a constant and every assertion above still
    // held: swapping each element with position zero is a permutation, and it differs from the input. It
    // is also *the same* permutation on every run, so two shuffles of the same 200 lines are identical.
    // Probabilistic in the direction that cannot fail by accident: 200! orders, and this asks only that
    // two of three runs differ. wac-mono 0005.
    const again = (await run(["shuf", `${dir}/lines`])).out.trim();
    const third = (await run(["shuf", `${dir}/lines`])).out.trim();
    assertEquals(
      new Set([shuffled.join("\n"), again, third]).size > 1,
      true,
      "three shuffles of the same input gave one order: the draw is not random",
    );

    // ── paste, against the real one ──
    await Deno.writeTextFile(`${dir}/p1`, "a\nb\n");
    await Deno.writeTextFile(`${dir}/p2`, "1\n2\n3\n");
    const sys = new Deno.Command("paste", {
      args: [`${dir}/p1`, `${dir}/p2`], stdout: "piped", stderr: "null",
    }).outputSync();
    assertEquals((await run(["paste", `${dir}/p1`, `${dir}/p2`])).out, new TextDecoder().decode(sys.stdout));

    // ── yes: the only applet that never ends on its own ──
    // It stops because `write` reports the closed pipe. Without that answer it would spin,
    // which is why `write` returns a bool at all.
    const yes = new Deno.Command(built, { args: ["yes", "wac"], stdout: "piped", stderr: "null" }).spawn();
    const reader = yes.stdout.getReader();
    const first = await reader.read();
    assertEquals(new TextDecoder().decode(first.value).startsWith("wac\nwac\n"), true);
    await reader.cancel();
    const status = await yes.status;
    assertEquals(status.success || status.signal !== null, true, "yes stopped when the pipe closed");
  } finally {
    await Deno.remove(built);
    await Deno.remove(dir, { recursive: true });
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

Deno.test("split writes many files, and wget writes one", async () => {
  // `split` is the first applet to open more than one output — everything else opens a
  // file, writes it and closes it. `wget` is `get` with the output pointed at a file, and
  // is three lines different from it: `openOutput` moves where `cli.write` goes, so the
  // fetch does not know.
  const built = await Deno.makeTempFile({ prefix: "wac-split-" });
  const dir = await Deno.makeTempDir({ prefix: "wac-split-d-" });
  try {
    await buildApp(BOX, built, { read: true, write: true, net: true });
    const lines = Array.from({ length: 250 }, (_, i) => `${i + 1}`).join("\n") + "\n";
    await Deno.writeTextFile(`${dir}/big.txt`, lines);

    const run = (args: string[], cwd: string) =>
      new Deno.Command(built, { args, cwd, stdout: "piped", stderr: "piped" }).outputSync();
    assertEquals(run(["split", "-100", "big.txt", "part-"], dir).code, 0);

    // Against the real one, piece for piece.
    new Deno.Command("split", { args: ["-l", "100", "big.txt", "real-"], cwd: dir }).outputSync();
    for (const s of ["aa", "ab", "ac"]) {
      assertEquals(
        await Deno.readTextFile(`${dir}/part-${s}`),
        await Deno.readTextFile(`${dir}/real-${s}`),
        `part-${s} differs`,
      );
    }
    // And no fourth piece: an exact boundary must not open a file it never writes to.
    let missing = false;
    try { await Deno.stat(`${dir}/part-ad`); } catch { missing = true; }
    assertEquals(missing, true, "an empty fourth piece was created");

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

Deno.test("tar writes an archive GNU tar can read", async () => {
  // The widest applet here: `readDir` and `stat` to walk a tree, `readFile` per entry,
  // `write` to stream it out. Tested against the real format rather than against itself —
  // a round trip with its own reader would pass with a checksum that is wrong in a
  // self-consistent way, which is exactly the mistake ustar's checksum invites.
  const built = await Deno.makeTempFile({ prefix: "wac-tar-" });
  const dir = await Deno.makeTempDir({ prefix: "wac-tar-d-" });
  try {
    await buildApp(BOX, built, { read: true, write: true });
    await Deno.mkdir(`${dir}/src/deep`, { recursive: true });
    // An empty directory only survives if the directory's own entry is written.
    await Deno.mkdir(`${dir}/src/empty`);
    await Deno.writeTextFile(`${dir}/src/a.txt`, "hello\n");
    await Deno.writeTextFile(`${dir}/src/deep/b.txt`, "world\n");
    // Exactly one block, so the padding path has to write nothing rather than a block.
    await Deno.writeFile(`${dir}/src/exact.dat`, new Uint8Array(512).fill(7));
    // And one that is not, so it has to write some.
    await Deno.writeFile(`${dir}/src/ragged.dat`, new Uint8Array(700).fill(9));

    const tar = new Deno.Command(built, {
      args: ["tar", "src"], cwd: dir, stdout: "piped", stderr: "piped",
    }).outputSync();
    assertEquals(tar.code, 0, new TextDecoder().decode(tar.stderr));
    await Deno.writeFile(`${dir}/out.tar`, tar.stdout);
    // Two zero blocks end an archive; without them GNU tar reads the entries and then
    // says "unexpected EOF", which a round trip with itself would not notice.
    assertEquals(tar.stdout.length % 512, 0, "an archive is whole blocks");

    const listed = new Deno.Command("tar", {
      args: ["-tf", "out.tar"], cwd: dir, stdout: "piped", stderr: "piped",
    }).outputSync();
    assertEquals(listed.code, 0, new TextDecoder().decode(listed.stderr));
    const entries = new TextDecoder().decode(listed.stdout).trim().split("\n").sort();
    assertEquals(
      entries.join(","),
      "src/,src/a.txt,src/deep/,src/deep/b.txt,src/empty/,src/exact.dat,src/ragged.dat",
      entries.join(","),
    );

    // Extraction, compared tree to tree. This is the assertion that the checksum, the
    // sizes and the padding are all right at once.
    await Deno.mkdir(`${dir}/ex`);
    const ex = new Deno.Command("tar", {
      args: ["-xf", "out.tar", "-C", "ex"], cwd: dir, stderr: "piped",
    }).outputSync();
    assertEquals(ex.code, 0, new TextDecoder().decode(ex.stderr));
    const diff = new Deno.Command("diff", {
      args: ["-r", "src", "ex/src"], cwd: dir, stdout: "piped", stderr: "piped",
    }).outputSync();
    assertEquals(diff.code, 0, new TextDecoder().decode(diff.stdout));

    // And through box's own compressor, which is the composition worth having.
    const gz = new Deno.Command(built, {
      args: ["gzip"], cwd: dir, stdin: "piped", stdout: "piped",
    }).spawn();
    const w = gz.stdin.getWriter();
    w.write(tar.stdout).then(() => w.close());
    await Deno.writeFile(`${dir}/out.tgz`, (await gz.output()).stdout);
    await Deno.mkdir(`${dir}/ex2`);
    const ex2 = new Deno.Command("tar", {
      args: ["-xzf", "out.tgz", "-C", "ex2"], cwd: dir, stderr: "piped",
    }).outputSync();
    assertEquals(ex2.code, 0, new TextDecoder().decode(ex2.stderr));
    const diff2 = new Deno.Command("diff", {
      args: ["-r", "src", "ex2/src"], cwd: dir, stdout: "piped",
    }).outputSync();
    assertEquals(diff2.code, 0, new TextDecoder().decode(diff2.stdout));

    assertEquals(
      new Deno.Command(built, { args: ["tar", "absent"], cwd: dir, stderr: "piped" })
        .outputSync().code,
      1,
      "a missing path is an error",
    );
  } finally {
    await Deno.remove(built);
    await Deno.remove(dir, { recursive: true });
  }
});


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



