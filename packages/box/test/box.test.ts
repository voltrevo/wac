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

// **What was here: "box's applets agree with the system tools they imitate".**
//
// It was the widest test in this file and it is gone, because every comparison in it now lives
// somewhere that does not need a process. What is below is the residue — three claims that were inside
// it, share nothing with each other, and each need a real program for a different reason. They are
// three tests now rather than one, because a test named for agreeing with system tools that runs no
// system tool is a name that lies.
//
// Where the rest went, and why that destination:
//
//   captured vector          `test/wac/cases.wac`         GNU agrees byte for byte
//   live differential        `test/wac/*_test.wac`        GNU agrees, but not byte for byte
//   written expectation      `test/wac/*_test.wac`        GNU cannot answer, or we differ on purpose
//
//   cat rev nl base64 sha256sum wc, the flag sweep, basename/dirname,
//   grep -n, sort -n, seq, head/tail, `--`, ls, fold/cut/tr        -> appletCases()
//   head/tail with no count                                        -> cases()
//   wc -w over eighteen code points, and across a chunk boundary    -> wcwords_test.wac
//   head tail nl uniq, and rev's characters                         -> lines_test.wac
//   wc strings hex crc32 tr, across chunk boundaries                -> streaming_test.wac
//   gzip gunzip crc32 date urlencode                                -> packaged_test.wac
//   sponge zstd json stat uuid shuf paste                           -> batch_test.wac
//   fsdump                                                          -> fsdump_test.wac
//   tar, and the ustar name limit                                   -> tar_test.wac
//   split's pieces, failed-read reasons, unimplemented flags        -> applets_test.wac
//   find/du on an unreadable subtree, rm -f                         -> unreadable_test.wac
//   cp and tee's destinations                                       -> writepath_test.wac
//   diff's fourteen shapes                                          -> diff_test.wac
//
// **What is left, and none of it is a wall.** Asked directly whether these are blockers or just work
// nobody has done, the answer is the second, and saying "cannot move" was hiding that:
//
//   - **grants, which are no longer one category but two.** `childCliGranted` — the helper
//     `issues/system/0302c` asked for — withholds `read`, `write` or `env` from a frame's child, each
//     answering what a host answers an ungranted program, and two tests moved on the strength of it.
//     What is left divides:
//
//       **one that must stay however good the helper gets.** "a file still needs the grant, and says
//       so" is the only test that reads `Not granted to this application` from a *host* rather than
//       from our own source. Everything in `grants_test.wac` compares an applet against a sentence the
//       helper hard-codes; delete this and the helper becomes an oracle agreeing with itself.
//
//       **`bin/`, which is not undone work either.** It asserts the *shebang* of a built artefact —
//       which grants a separately-built applet declares, and that a `wc` built with none cannot open a
//       file when told to. A wac test could shell out to `wac app` and read that line; what stops it
//       being worth doing is that the test spawns a build either way, so migrating saves no process
//       and buys nothing. That is a different sentence from "cannot", and the difference has mattered
//       three times in this file today.
//   - **one test that needs a capability wac has not got.** `Cli` reads a symlink and cannot make one,
//     so the `tar` fixture below cannot be built in wac. Also buildable, and additive:
//     `issues/system/0300c`.
//   - **the network tests**, and these are the only ones I would keep spawning on purpose. A server and
//     a client with a real socket between them is a claim *about* the process boundary, so testing it
//     across one is the point rather than the cost.
//
// So: one shape worth keeping, and two that are undone work with issue numbers on them.
//
// **Two entries came off this list by being checked rather than argued**, which is the reason it now
// reads the way it does. `main` was said to be unreachable because it reads argv from the process — a
// frame supplies argv. `yes` was said to need a pipe to be closed — a frame's buffer fills and `write`
// answers false, which is the property `yes` actually depends on and the reason `write` returns a bool
// at all. Both were written here as facts about the world; neither survived opening the file.

// **Moved to `packages/box/test/wac/grants_test.wac`.** It stayed here because an in-process frame
// could not be given fewer grants than the test holds; `childCliGranted` in `frame.wac` now can, so it
// went — with a control beside it, so the refusal is the grant talking and not `rm` being broken.

Deno.test("tar refuses a symlink rather than following it", async () => {
  // GitHub wac-mono#25, where `tar` walked into a link to a directory, stored it under the link's name,
  // and grew the path until something trapped on a self-referential one.
  //
  // **This is the capability case, and it is the whole reason `issues/system/0300c` is filed.** The
  // assertions are two exit codes and a listing — nothing a wac test could not say. The *fixture* is
  // three symlinks, and `Cli` carries `linkStat` to ask what a name is while carrying nothing that
  // makes one. So the test cannot move until the language can build its own fixture, and it is written
  // here rather than left undone.
  const built = await Deno.makeTempFile({ prefix: "wac-box-link-" });
  const linked = await Deno.makeTempDir({ prefix: "wac-box-link-d-" });
  const listing = await Deno.makeTempFile({ prefix: "wac-box-tar-", suffix: ".tar" });
  try {
    await buildApp(BOX, built, { read: true });
    await Deno.mkdir(`${linked}/real`);
    await Deno.writeTextFile(`${linked}/real/f`, "x");
    await Deno.symlink("real", `${linked}/toDir`);
    await Deno.symlink("real/f", `${linked}/toFile`);
    await Deno.symlink("loop", `${linked}/loop`);          // points at itself
    const tarred = new Deno.Command(built, {
      args: ["tar", "."], cwd: linked, stdout: "piped", stderr: "piped",
    }).outputSync();
    const said = new TextDecoder().decode(tarred.stderr);
    assertEquals(tarred.code, 1, "a refused entry is a failure");
    for (const name of ["toDir", "toFile", "loop"]) {
      assertEquals(said.includes(name), true, `${name} should be refused: ${said}`);
    }

    // Refused *and left out* — an archive that names a link it declined to follow is worse than one
    // that fails, because it unpacks to something other than what went in.
    await Deno.writeFile(listing, tarred.stdout);
    const listed = new Deno.Command("tar", { args: ["-tf", listing], stdout: "piped" }).outputSync();
    const inArchive = new TextDecoder().decode(listed.stdout);
    assertEquals(inArchive.includes("./real/f"), true, inArchive);
    assertEquals(
      inArchive.includes("toDir"),
      false,
      `a refused link must not be in the archive: ${inArchive}`,
    );
  } finally {
    await Deno.remove(built);
    await Deno.remove(listing);
    await Deno.remove(linked, { recursive: true });
  }
});

// **Moved to `packages/box/test/wac/dispatcher_test.wac`, and it should not have been here at all.**
// The note that kept it said `main` reads argv from the process and so no frame call could reach it.
// That was wrong: `Frame.of` takes an argv and `childCli` answers `argCount` and `arg` out of it —
// `frame.wac:282` says so in as many words. `main(childCore(f, core), childCli(f, cli))` runs the whole
// program with its streams captured. Nothing was blocking it; I had not looked.

Deno.test("a file still needs the grant, and says so", async () => {
  // **What is left of "box works as a filter".** The filter half — `wc` and `sha256sum` over standard
  // input, against the real tools — is `appletCases()` now, replayed in process by
  // `packages/box/test/wac/applets_test.wac` against expectations captured once. Reading standard input
  // is not a capability, so none of it needed a built program.
  //
  // **This half stays, and the reason it gives is no longer the reason.** It said an in-process frame
  // inherits the suite's capabilities so the test would assert nothing. That was true until
  // `childCliGranted` — `packages/box/test/wac/grants_test.wac` now makes this exact assertion in a
  // frame, `cat` against a withheld read.
  //
  // What that leaves is better than what it replaced. The in-process version compares the applet
  // against a sentence the *helper* hard-codes; this one compares it against the sentence a real host
  // actually produces. Delete it and `childCliGranted` becomes an oracle agreeing with itself: the
  // helper could drift from every host and all six in-process grant assertions would stay green.
  //
  // So it is not a duplicate — it is the anchor the duplicate hangs from, and it is the *only* test
  // that reads the phrase from a host rather than from our own source.
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

Deno.test("cp and the write tier, through a real process", async () => {
  // **Both claims moved, and what is left is the smoke test the boundary is entitled to.**
  // `cp` leaving no temporary behind is `test/wac/writepath_test.wac`; `mkdir` refusing without the
  // write grant is `test/wac/grants_test.wac`, which `childCliGranted` made possible.
  //
  // This keeps one spawned spelling of the tier, because every assertion above it in this file runs
  // the applet as a value and none of them proves the *built* program can write at all. It is a smoke
  // test and says so — one copy, one comparison, no attempt to re-state what the wac files now hold.
  const built = await Deno.makeTempFile({ prefix: "wac-box-m-" });
  const root = await Deno.makeTempDir({ prefix: "wac-box-fs-" });
  try {
    await buildApp(BOX, built, { read: true, write: true });
    const r = new Deno.Command(built, {
      args: ["cp", "README.md", `${root}/copy`], stdout: "piped", stderr: "piped",
    }).outputSync();
    assertEquals(r.code, 0, new TextDecoder().decode(r.stderr));
    assertEquals(
      await Deno.readTextFile(`${root}/copy`),
      await Deno.readTextFile("README.md"),
      "the built program copied it",
    );
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

// **Moved to `packages/box/test/wac/grants_test.wac`** as `test_a_denied_read_says_why`, for the same
// reason: `childCliGranted` can withhold `read`, and a withheld capability answers exactly what a host
// answers an ungranted program — `FAULT_NOT_GRANTED` and "Not granted to this application". The
// message shape was always the claim here, not the status.

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

// **Moved to `packages/box/test/wac/yes_test.wac`, and this one was wrong too.** The note said `yes`
// stops because `write` reports a closed pipe, and that closing a pipe is a process lifecycle a frame
// does not have. A frame has exactly that: output is capped at 8 MiB and `write` answers false past it,
// and `frame.wac` says twenty lines in that *"`packages/box`'s `yes` is written as
// `while (cli.write(block)) {}` precisely so a full buffer stops it"*. The applet's stopping condition
// and the frame's cap were built for each other; only this test had not noticed.

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



