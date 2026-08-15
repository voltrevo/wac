// The compiler as **one file**, on the primary platform.
//
// `native/v8` has always been handed a program: `wac prog.wasm args…`. That is a runtime, not a
// command — and the thing design/lang/0003 step 4 is about is a single `wac` that compiles wac with
// no Deno, no JavaScript and no module beside it. `native/v8/build.rs` embeds `seed/wacc.wasm` when
// it is there, and the binary then treats a first argument that is not a bundle as arguments for the
// program inside it.
//
// It also rebuilds the payload it carries — `wacc build` writes the manifest a native host needs,
// so the TypeScript bundler is in the loop only for producing the *first* seed.
//
// **The assertion is the bytes, not the exit code.** A binary that compiled *something* would pass a
// test that only checked it ran; what has to hold is that going through the embedded compiler on
// this host produces the same module as calling `emitFiles` in process — because the moment those
// differ, "one file compiles this repository" stops being one claim and becomes two. The entry is
// wacc's own API: the heaviest thing here, and the one whose output seeds the next build.
//
// **Opt-in**, like `binary.test.ts` and for the same reason: this rebuilds the crate and writes 67 MB.
//
//     WAC_V8_SEED=1 deno test -A packages/wacc/test/nativeBinary.test.ts
//
// **The binary under test is a copy, not `target/release/wac`.** Every build of this crate writes
// that one path, so a test that built `wc` into it left the next test running a `wc` — which is
// exactly what happened, as an ordering dependency between two tests in this file that neither of
// them stated. `seededBinary()` builds once and copies out; `cargo build --release` in `native/v8`
// is how a person gets their own seed back into `target/`.

import { buildNative } from "../../platform/native.ts";
import { buildNativeBinary } from "../../platform/nativeBinary.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { wacFiles } from "../../../harness/wacFiles.ts";
import "../../../harness/spawnRetry.ts";

const CRATE = "native/v8";
const ENTRY = "packages/wacc/src/api.wac";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/**
 * The compiler as a seeded binary, built once and copied somewhere nothing else writes.
 *
 * Lazy rather than module-level: when the opt-in switch is off every test here is ignored, and
 * building 67 MB for tests that will not run is not a cost to pay for tidiness.
 */
let seeded: Promise<{ bin: string; seedWasm: string }> | null = null;
function seededBinary(): Promise<{ bin: string; seedWasm: string }> {
  if (seeded === null) seeded = buildSeeded();
  return seeded;
}

async function buildSeeded(): Promise<{ bin: string; seedWasm: string }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-v8seed-" });
  // The payload is the compiler as a program, built the way any program for this host is built: one
  // module carrying its own manifest. There is no seed-specific artefact, which is what keeps the
  // thing inside the binary the same thing that runs when it is handed over directly.
  //
  // All four grants named, which is what the `app:native` command line passes: `buildNative` writes
  // the object it was *handed*, so `{read, write}` yields a manifest with two keys and the wac side —
  // which has a bitmask, not an object — always writes four.
  await buildNative("packages/wacc/example/wacc.wac", `${dir}/wacc`, {
    read: true,
    write: true,
    env: false,
    net: false,
  });
  // The shell is the second payload, and it is built with *everything* on purpose: `wac sh` narrows
  // to what the command line asks for and can never exceed what the payload carries, so the payload
  // is the ceiling rather than the default. Built here rather than assumed, because a binary with a
  // seed and no shell is a legitimate build and answers `sh` by saying it has none.
  await buildNative("packages/box/example/boxsh.wac", `${dir}/sh`, {
    read: true,
    write: true,
    env: true,
    net: true,
  });
  const built = await new Deno.Command("cargo", {
    args: ["build", "--release", "--quiet"],
    cwd: CRATE,
    env: { WAC_SEED_DIR: dir },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (built.code !== 0) {
    throw new Error(`cargo did not build ${CRATE}:\n${new TextDecoder().decode(built.stderr)}`);
  }
  const bin = `${dir}/wac`;
  await Deno.copyFile(`${CRATE}/target/release/wac`, bin);
  await Deno.chmod(bin, 0o755);
  return { bin, seedWasm: `${dir}/wacc.wasm` };
}

async function run(bin: string, args: string[]) {
  const r = await new Deno.Command(bin, { args, stdout: "piped", stderr: "piped" }).output();
  const dec = new TextDecoder();
  return { code: r.code, out: dec.decode(r.stdout), err: dec.decode(r.stderr) };
}

Deno.test({
  name: "one file compiles wac, and its bytes are the ones the library produces",
  ignore: Deno.env.get("WAC_V8_SEED") !== "1",
  fn: async () => {
    const { bin: wac, seedWasm } = await seededBinary();
    const dir = await Deno.makeTempDir({ prefix: "wac-v8out-" });
    try {
      const out = `${dir}/api.wasm`;
      const r = await run(wac, ["compile", ENTRY, out]);
      if (r.code !== 0) throw new Error(`compile failed (${r.code}): ${r.err || r.out}`);

      const api = await wacBind("packages/wacc/src/api.wac") as unknown as {
        emitFiles: (p: string[], s: string[], e: string) => Uint8Array;
      };
      const files = await wacFiles(ENTRY);
      const paths = [...files.keys()];
      const want = Uint8Array.from(
        api.emitFiles(paths, paths.map((p) => files.get(p)!), ENTRY) as unknown as number[],
      );
      const got = await Deno.readFile(out);
      assertEquals(got.length, want.length, "the binary and the library disagree on size");
      for (let i = 0; i < got.length; i++) {
        if (got[i] !== want[i]) throw new Error(`byte ${i} differs: ${got[i]} vs ${want[i]}`);
      }
      console.log(`    one file: ${got.length} bytes for ${ENTRY}, identical to the library's`);

      // **A bundle is still a bundle.** The seed decides what an argument means, and getting that
      // rule wrong turns a runtime into a compiler that cannot be handed a program — so the form
      // that worked before carrying a payload is asserted here rather than assumed.
      const asProgram = await run(wac, [seedWasm, "check", "packages/json/src/json.wac"]);
      assertEquals(asProgram.code, 0, `a module argument stopped working: ${asProgram.err}`);

      // And a mistyped module is reported as a missing file rather than reaching the compiler, which
      // would answer *unknown command 'nosuch.wasm'* — a message about the wrong thing entirely.
      const missing = await run(wac, [`${dir}/nosuch.wasm`]);
      assertEquals(missing.code, 1, "a missing bundle should fail as one");
      assertEquals(
        missing.err.includes("cannot read") && !missing.err.includes("unknown command"),
        true,
        `named the wrong problem: ${missing.err}`,
      );

      // **It rebuilds the file it carries.** `build` is `compile` plus the boundary — the manifest a
      // native host needs, in the module — and the payload above was written by `app:native`, so a
      // byte-identical answer says the TypeScript bundler is no longer in the loop for anything but
      // producing the first one. The output stem is `wacc` again because a manifest names the file it
      // sits beside, and a rebuild under another name is a different artefact for a good reason.
      await Deno.mkdir(`${dir}/re`);
      const rebuilt = await run(wac, [
        "build",
        "packages/wacc/example/wacc.wac",
        "-o",
        `${dir}/re/wacc`,
        "--allow-read",
        "--allow-write",
      ]);
      if (rebuilt.code !== 0) throw new Error(`build failed (${rebuilt.code}): ${rebuilt.err}`);
      const mine = await Deno.readFile(`${dir}/re/wacc.wasm`);
      const seed = await Deno.readFile(seedWasm);
      assertEquals(mine.length, seed.length, "the binary's own payload came out a different size");
      for (let i = 0; i < mine.length; i++) {
        if (mine[i] !== seed[i]) throw new Error(`the rebuilt seed differs at byte ${i}`);
      }
      console.log(`    and it rebuilt its own ${seed.length}-byte payload, byte for byte`);

      // **`run` is compile-and-execute with no file in between** — two programs on one V8, the
      // compiler inside the binary and then the program it just built.
      const ran = await run(wac, ["run", "--allow-read", "packages/platform/example/wc.wac", "README.md"]);
      assertEquals(ran.code, 0, `run failed: ${ran.err}`);
      // One line, which is the whole point of `--quiet`: the build announcing the file it wrote
      // would land in the middle of the program's own output, and a pipeline would eat it.
      assertEquals(ran.out.trim().split("\n").length, 1, `the build spoke over the program: ${ran.out}`);
      assertEquals(ran.out.trim().split(/\s+/).length, 4, `not a wc line: ${ran.out}`);

      // The grants on the command line are the program's, and they reach it as the grants baked into
      // the artefact the compiler was asked to write. One flag fewer, and it cannot read.
      const ungranted = await run(wac, ["run", "packages/platform/example/wc.wac", "README.md"]);
      assertEquals(ungranted.code !== 0, true, "an ungranted run read the file");
      assertEquals(
        ungranted.err.includes("Not granted"),
        true,
        `refused for the wrong reason: ${ungranted.err}`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "and it runs the repository's own wac tests, with no Deno underneath them",
  ignore: Deno.env.get("WAC_V8_SEED") !== "1",
  fn: async () => {
    // `harness/wacTestRun.ts` owns the convention — an export named
    // `test*` answering a `string`, empty for a pass — and `wac test` is that convention with
    // nothing underneath it. 353 of this repository's tests across 53 files run this way.
    const { bin: wac } = await seededBinary();

    const ran = await run(wac, ["test", "packages/bytes/test/wac/buf_test.wac"]);
    assertEquals(ran.code, 0, `a passing file failed: ${ran.err || ran.out}`);
    const [passed, failed] = ran.out.trim().split("\n").at(-1)!.split(", ");
    assertEquals(failed, "0 failed", ran.out);
    if (Number(passed.split(" ")[0]) < 20) throw new Error(`too few tests ran: ${ran.out}`);

    // **The canary, and the repository keeps one on purpose.** `wactest`'s fixture fails by design,
    // so a runner that reported every file as passing — by mis-reading the report, or by not calling
    // anything — is caught here rather than being trusted.
    const bad = await run(wac, ["test", "packages/wactest/test/wac/fixture_failing.wac"]);
    assertEquals(bad.code, 1, "the deliberately failing fixture passed");
    assertEquals(
      bad.out.includes("deliberate: got 1, want 2"),
      true,
      `the failure report was not passed through: ${bad.out}`,
    );

    // A test that wants an oracle is *named and skipped*, not counted as passing. A runner that
    // silently dropped these would report "4 passed" for a file whose tests never ran.
    const oracle = await run(wac, ["test", "packages/tor/test/wac/vote_test.wac"]);
    assertEquals(oracle.out.includes("need an oracle"), true, `not reported: ${oracle.out}`);
    assertEquals(oracle.out.includes("passed"), false, `counted as run: ${oracle.out}`);
  },
});

Deno.test({
  name: "and `app:wacbin` bakes the grants in, for any program rather than the compiler",
  ignore: Deno.env.get("WAC_V8_SEED") !== "1",
  fn: async () => {
    // `wc` rather than `wacc`, because the interesting claim is that this makes a native executable
    // of *a* wac program — the compiler is just the one that makes the result a `wac` command.
    const dir = await Deno.makeTempDir({ prefix: "wac-wacbin-" });
    try {
      const entry = "packages/platform/example/wc.wac";
      await buildNativeBinary(entry, `${dir}/wc`, { read: true });
      const granted = await run(`${dir}/wc`, ["README.md"]);
      assertEquals(granted.code, 0, `a granted wc failed: ${granted.err}`);
      assertEquals(granted.out.trim().split(/\s+/).length, 4, `not a wc line: ${granted.out}`);

      // **The canary, and the point of the whole layer.** Same program, same command line, one
      // grant fewer at packaging time — and it cannot read the file. A test that only ran the
      // granted build would pass for a binary that ignored grants entirely.
      await buildNativeBinary(entry, `${dir}/wc-nogrant`, {});
      const denied = await run(`${dir}/wc-nogrant`, ["README.md"]);
      assertEquals(denied.code !== 0, true, "an ungranted wc read the file");
      assertEquals(
        denied.err.includes("Not granted"),
        true,
        `refused for the wrong reason: ${denied.err}`,
      );
      console.log(`    ungranted: ${denied.err.trim()}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "the two runners agree about this repository's wac tests, file by file",
  ignore: Deno.env.get("WAC_V8_SEED") !== "1",
  fn: async () => {
    // **Two runners, one corpus, one answer** — the same shape `v8host.test.ts` uses for programs,
    // applied to tests. The single file asserted above says the runner works; this says it works the
    // *same way* as the harness every one of these files was written against, which is the only
    // thing that makes running them natively worth anything.
    //
    // The Deno side calls the module's zero-argument `test*` exports directly rather than going
    // through `wacTestRun`, because that registers Deno tests and this needs the answers as values.
    const { bin: wac } = await seededBinary();

    const files: string[] = [];
    for (const pkg of [...Deno.readDirSync("packages")].filter((e) => e.isDirectory)) {
      try {
        for (const f of Deno.readDirSync(`packages/${pkg.name}/test/wac`)) {
          if (f.name.endsWith(".wac")) files.push(`packages/${pkg.name}/test/wac/${f.name}`);
        }
      } catch {
        // A package with no wac tests.
      }
    }
    if (files.length < 100) throw new Error(`only ${files.length} wac test files found`);

    let agreed = 0, ran = 0;
    for (const f of files) {
      const r = await run(wac, ["test", f]);
      const m = r.out.match(/(\d+) passed, (\d+) failed/);
      // A probe, or a file whose every test wants an oracle. Both are reported by the runner and
      // neither is this test's business.
      if (!m) continue;

      const mod = await wacBind(f) as Record<string, unknown>;
      let pass = 0, fail = 0;
      for (const [name, fn] of Object.entries(mod)) {
        if (!name.startsWith("test") || typeof fn !== "function") continue;
        if ((fn as CallableFunction).length !== 0) continue;
        try {
          if ((fn as () => string)() === "") pass++;
          else fail++;
        } catch {
          fail++;
        }
      }
      ran += pass + fail;
      if (pass !== Number(m[1]) || fail !== Number(m[2])) {
        throw new Error(`${f}: native ${m[1]}/${m[2]}, Deno ${pass}/${fail}`);
      }
      agreed++;
    }

    // **Asserted, not merely compared.** A runner that answered nothing for every file would agree
    // with a Deno side that called nothing, and the loop above would be satisfied.
    if (agreed < 50) throw new Error(`only ${agreed} files were compared`);
    if (ran < 300) throw new Error(`only ${ran} tests ran`);
    console.log(`    ${ran} tests across ${agreed} files: the two runners agree`);
  },
});

Deno.test({
  name: "and the coverage it reports is the coverage the harness measures",
  ignore: Deno.env.get("WAC_V8_SEED") !== "1",
  fn: async () => {
    // `emitFilesCovered` and `covTableFiles` were in the API with no command reaching them, so a
    // person with the binary could run tests and not ask what they touched. `test --coverage` builds
    // the instrumented module, calls `__cov_init` before the first test — skip that and every
    // instrumented function traps on its first branch — and reads the counters against the table.
    //
    // Compared against `harness/wacCoverage.ts` on the same file, per file rather than in total: a
    // runner that miscounted one file and compensated in another would pass a total-only check.
    const { bin: wac } = await seededBinary();
    const entry = "packages/bytes/test/wac/buf_test.wac";

    const r = await run(wac, ["test", "--coverage", entry]);
    assertEquals(r.code, 0, `coverage run failed: ${r.err || r.out}`);
    const mine = new Map<string, string>();
    for (const l of r.out.split("\n")) {
      const m = l.match(/^\s*(\d+) \/ (\d+)\s+(\S+)$/);
      if (m) mine.set(m[3], `${m[1]}/${m[2]}`);
    }

    const { instrument } = await import("../../../harness/wacCoverage.ts");
    const { mod, points, counts } = await instrument(entry);
    for (const [name, fn] of Object.entries(mod)) {
      if (!name.startsWith("test") || typeof fn !== "function") continue;
      if ((fn as CallableFunction).length !== 0) continue;
      (fn as () => string)();
    }
    const c = counts();
    const theirs = new Map<string, { n: number; hit: number }>();
    points.forEach((p, i) => {
      const e = theirs.get(p.file) ?? { n: 0, hit: 0 };
      e.n++;
      if ((c[i] ?? 0) > 0) e.hit++;
      theirs.set(p.file, e);
    });

    // **Asserted, not merely compared.** All-zero on both sides would agree, and so would a table
    // nobody read: the file under test has to be substantially covered and the formatter it only
    // calls on failure has to be untouched, which is what these two numbers say.
    const buf = theirs.get("packages/bytes/src/buf.wac");
    if (buf === undefined || buf.hit < buf.n / 2) throw new Error("the file under test is not covered");
    if ((theirs.get("packages/fmt/src/ftoa.wac")?.hit ?? -1) !== 0) {
      throw new Error("a failure formatter was reached by a passing run");
    }

    for (const [file, e] of theirs) {
      assertEquals(mine.get(file), `${e.hit}/${e.n}`, `${file}: the two disagree`);
    }
    assertEquals(mine.size, theirs.size, "a file appears in one report and not the other");
    console.log(`    ${points.length} points across ${mine.size} files: both agree`);
  },
});

Deno.test({
  name: "every program in the repository compiles through the binary to the same bytes",
  ignore: Deno.env.get("WAC_V8_SEED") !== "1",
  fn: async () => {
    // The test at the top of this file compiles the heaviest program; this one compiles *all* of
    // them, which is a different question. What it covers that the other cannot is the binary's own
    // I/O path over the shapes a repository actually has — an import that goes up a directory, a
    // package whose graph is 179 files, an entry beside its own imports — and the answer has to be
    // the library's, byte for byte, for every one.
    const { findPrograms } = await import("../../../harness/programs.ts");
    const { bin: wac } = await seededBinary();
    const api = await wacBind("packages/wacc/src/api.wac") as unknown as {
      emitFiles: (p: string[], s: string[], e: string) => Uint8Array;
    };

    const dir = await Deno.makeTempDir({ prefix: "wac-allprogs-" });
    try {
      const programs = await findPrograms();
      if (programs.length < 60) throw new Error(`only ${programs.length} programs found`);
      let bytes = 0;
      for (const p of programs) {
        const out = `${dir}/o.wasm`;
        const r = await run(wac, ["compile", p.path, out]);
        if (r.code !== 0) throw new Error(`${p.path}: ${r.err || r.out}`);

        const files = await wacFiles(p.path);
        const paths = [...files.keys()];
        const want = Uint8Array.from(
          api.emitFiles(paths, paths.map((x) => files.get(x)!), p.path) as unknown as number[],
        );
        const got = await Deno.readFile(out);
        if (got.length !== want.length) {
          throw new Error(`${p.path}: the binary wrote ${got.length} bytes, the library ${want.length}`);
        }
        for (let i = 0; i < got.length; i++) {
          if (got[i] !== want[i]) throw new Error(`${p.path}: byte ${i} differs`);
        }
        bytes += got.length;
      }
      console.log(
        `    ${programs.length} programs, ${(bytes / (1024 * 1024)).toFixed(0)} MB of module, ` +
          `all identical to the library's`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "`wac sh` is a shell, and sealed unless it is granted",
  ignore: Deno.env.get("WAC_V8_SEED") !== "1",
  fn: async () => {
    const { bin: wac } = await seededBinary();

    // Applets and pipelines, with no Deno underneath and no filesystem at all. These two lines are
    // the front page's own transcript, which is why they are the ones checked here.
    const piped = await run(wac, ["sh", "-c", "seq 1 20 | grep 7 | wc -l"]);
    assertEquals(piped.out.trim(), "2", `pipeline: ${piped.out}${piped.err}`);
    const hashed = await run(wac, ["sh", "-c", "echo hello | sha256sum"]);
    assertEquals(
      hashed.out.trim().split(/\s+/)[0],
      "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
      `sha256sum: ${hashed.out}${hashed.err}`,
    );

    // **Sealed is the absence of grants, not a mode.** Granting nothing is what the short command
    // does, so the safe thing is what a person gets by typing the obvious thing — and the refusal
    // says *not granted* rather than a filesystem error, which is the distinction a caller needs.
    const denied = await run(wac, ["sh", "-c", "echo x > /tmp/wac-sh-sealed-probe"]);
    assertEquals(
      denied.err.includes("Not granted") || denied.out.includes("Not granted"),
      true,
      `an ungranted write should say so: ${denied.out}${denied.err}`,
    );
    const wrote = await Deno.stat("/tmp/wac-sh-sealed-probe").then(() => true, () => false);
    assertEquals(wrote, false, "and it must not have been written");

    // The same shell, granted, reaches the machine. `--allow-read` only: the write above stays
    // refused, so the two flags are independent rather than one switch with a long name.
    const read = await run(wac, ["sh", "--allow-read", "-c", "wc -l < spec/tour.wac"]);
    assertEquals(Number(read.out.trim()) > 100, true, `a granted read should count lines: ${read.out}${read.err}`);

    // A flag that is not a grant is refused by name rather than ignored, because a typo that
    // silently drops a grant would leave a program failing for a reason nobody would look for.
    const bogus = await run(wac, ["sh", "--allow-everything", "-c", "echo x"]);
    assertEquals(bogus.code, 2, `an unknown grant should exit 2: ${bogus.out}${bogus.err}`);
    assertEquals(bogus.err.includes("is not a grant"), true, bogus.err);
  },
});
