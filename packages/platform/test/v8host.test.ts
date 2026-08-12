// Two hosts, one program, one answer — with the second host being `native/v8`.
//
// `native/v8` runs a wac program on V8 driven from Rust, with no JavaScript layer, and the only
// thing that makes it trustworthy is that programs written for the JavaScript hosts behave the same
// on it. Every capability it grew was checked that way by hand; this is that check, kept.
//
// **What is compared.** `packages/box/example/boxsh.wac` running a short script — the same shell the
// website's transcript is checked against. It is the strongest single program available: a pipeline
// exercises `pushChild`/`popChild` and the frame stack, `sha256sum` streams through
// `openInput`/`readChunk`, `wc -l` on a file reads one, and arithmetic keeps a builtin in the mix.
//
// Two wrong answers found by exactly this comparison, both of which looked like right ones:
// `sha256sum README.md` inside the shell printing the hash of the empty string, because the applet
// read the frame's queue instead of the file it had opened; and a pipeline dying with
// `grep: : No such file or directory`, because `openInput("")` means standard input and was taken
// as a path.
//
// ## One difference this deliberately does not compare
//
// `sleep 0 &` — the *background* form — diverges, and the cause is worth stating rather than
// hiding. `native/v8` implements `spawnSelf` but not `spawn(path, …)`, so the shell takes a
// different route for a command it cannot find: on Deno the spawn attempt fails and the shell says
// so, while here a child starts, fails to dispatch inside itself, and writes its complaint to a
// queue its parent never reads because the job is in the background. The foreground form is what
// this test compares, because that is the one that carries an exit code, and there the two hosts
// agree exactly — `sh: sleep: command not found`, code 127.
//
// ## When cargo is not there
//
// The host is Rust and the rest of the repo is not. If cargo cannot build it the V8 half is skipped
// **loudly**, and the Deno half still runs and still asserts — a skip must not be mistaken for a
// pass, which is how a differential test comes to compare nothing.

import { buildApp } from "../build.ts";
import { buildNative } from "../native.ts";
import "../../../harness/spawnRetry.ts";

/** The repo's own, so this file adds no dependency for two comparisons. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const ENTRY = "packages/box/example/boxsh.wac";
const CRATE = "native/v8";

/** A script that reaches four different capability families in five lines. */
const SCRIPT = [
  "seq 1 20 | grep 7 | wc -l",
  "echo $((6*7))",
  "sha256sum README.md",
  "wc -l MERGE.md",
  // A command that does not exist, which is where a host's `spawn` shows: both must report it the
  // same way and set the same code. The *background* form is deliberately not here — see below.
  "sleep 0",
  "echo code $?",
  "echo done",
].join("\n") + "\n";

/** The V8 host, built if cargo is here, or null with the reason said out loud. */
async function v8Host(): Promise<string | null> {
  try {
    const built = await new Deno.Command("cargo", {
      args: ["build", "--release", "--quiet"],
      cwd: CRATE,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (built.code !== 0) throw new Error(new TextDecoder().decode(built.stderr));
  } catch (e) {
    console.warn(
      `SKIPPING the V8 half: cargo did not build ${CRATE}.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}\n` +
        `  The Deno half below still runs. See native/v8/README.md.`,
    );
    return null;
  }
  return `${CRATE}/target/release/wacv8`;
}

async function run(bin: string, args: string[], stdin: string) {
  const p = new Deno.Command(bin, { args, stdin: "piped", stdout: "piped", stderr: "piped" })
    .spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(stdin));
  await w.close();
  const r = await p.output();
  const dec = new TextDecoder();
  return { code: r.code, out: dec.decode(r.stdout), err: dec.decode(r.stderr) };
}

Deno.test("box's shell answers the same on Deno and on the Rust host on V8", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-v8host-" });
  try {
    // The Deno half, which runs whether or not cargo is here.
    const denoBin = `${dir}/bsh-deno`;
    await buildApp(ENTRY, denoBin, { read: true, write: true });
    const onDeno = await run(denoBin, [], SCRIPT);

    // **Asserted, not merely captured.** If the two hosts were compared and nothing else, a shell
    // that printed nothing on both would pass.
    const lines = onDeno.out.trim().split("\n");
    assertEquals(lines.length, 6, `expected six answers, got: ${onDeno.out}`);
    assertEquals(lines[0], "2", "the pipeline's count");
    assertEquals(lines[1], "42", "the arithmetic");
    assertEquals(lines[2].split(/\s+/)[0].length, 64, "a sha256 is 64 hex digits");
    assertEquals(lines[4], "code 127", "an unfound command is 127");
    assertEquals(lines[5], "done");

    const v8Bin = await v8Host();
    if (v8Bin === null) return;

    const stem = `${dir}/bsh`;
    await buildNative(ENTRY, stem, { read: true, write: true });
    const onV8 = await run(v8Bin, [stem], SCRIPT);

    assertEquals(onV8.out, onDeno.out, "the two hosts disagree about what the shell printed");
    assertEquals(onV8.err, onDeno.err, "the two hosts disagree about what the shell warned");
    assertEquals(onV8.code, onDeno.code, "the two hosts disagree about the exit code");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
