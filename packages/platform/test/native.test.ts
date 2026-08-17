// One program, two substantially different hosts, and the same answer.
//
// design/0001's arrival test in miniature — "load the same image in two substantially different hosts
// and demonstrate the same behaviour in both", where **substantially different means one JavaScript
// host and one that is not** (D9). Two JavaScript hosts satisfy the words and prove nothing: they share
// the transport, the worker model and the event loop. This is the first test in the repo that does not.
//
// The program is `example/wacland.wac`, whose stages are 0087's "done when" in the order a host
// acquires them: output, arguments, two requests completing out of order, a `waitAny` that comes back
// on its deadline, a spawned child waited for alongside a ticket of another kind, and a child given
// less than its parent has. Both hosts reach the end, so the comparison is the whole run.
//
// **What is compared and what is not.** Two of the lines carry monotonic nanoseconds, which are a
// measurement rather than an answer — two hosts that agreed on those would be suspicious rather than
// correct, since one of them takes longer to start. So the transcripts are compared with those numbers
// masked, and the *relationships* between them are asserted separately on each host: the quick sleep
// settles before the slow one, and the gap is about what was asked for.
//
// The canary is that the masking is not doing the work: a run with every number masked and no other
// assertion would report agreement between two hosts that printed nothing. So the test also pins the
// exact line count, the stage-3 ordering, and that stage 4 timed out.
//
// ## When cargo is not there
//
// The runtime is Rust and the rest of the repo is not. If cargo is missing the native half is skipped —
// **loudly**, and the Deno half still runs and still asserts, so a skip cannot be mistaken for a pass.
// Silent skipping is how a differential test comes to compare nothing.

import { buildApp } from "../build.ts";
import { buildNative } from "../native.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const ENTRY = "packages/platform/example/wacland.wac";
const CRATE = "native";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

type Run = { code: number; out: string; err: string };

async function runIt(cmd: string, args: string[]): Promise<Run> {
  const r = await new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
    // Stage 6's environment half reads this. Set here rather than inherited so the two hosts are
    // asked the same question whatever the shell happened to export.
    env: { ...Deno.env.toObject(), WACLAND_PROBE: "seen" },
  }).output();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

/** The native binary, built if cargo is here, or null with the reason said out loud. */
async function nativeBinary(): Promise<string | null> {
  try {
    const built = await new Deno.Command("cargo", {
      args: ["build", "--release", "--quiet"],
      cwd: CRATE,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (built.code !== 0) {
      throw new Error(new TextDecoder().decode(built.stderr));
    }
  } catch (e) {
    console.warn(
      `SKIPPING the native half of the arrival test: cargo did not build ${CRATE}.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}\n` +
        `  The Deno half below still runs. See issues/closed/0087.`,
    );
    return null;
  }
  return `${CRATE}/target/release/wacland`;
}

const tmp = await Deno.makeTempDir({ prefix: "wac-native-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

/** The two lines carrying monotonic nanoseconds, with the number replaced by its name. */
function masked(out: string): string {
  return out.replace(/(stage 3 (?:quick|slow) )\d+/g, "$1<nanos>");
}

/** What one host said about stage 3, as numbers. */
function stage3(out: string): { first: number; quick: number; slow: number } {
  const find = (re: RegExp) => Number(re.exec(out)?.[1] ?? NaN);
  return {
    first: find(/stage 3 first (-?\d+)/),
    quick: find(/stage 3 quick (\d+)/),
    slow: find(/stage 3 slow (\d+)/),
  };
}

/** Everything the conformance program must have done, whichever host ran it. */
function assertConformant(r: Run, host: string): void {
  const lines = r.out.split("\n").filter((l) => l.length > 0);
  assertEquals(r.code, 0, `${host} exited ${r.code}: ${r.err}`);
  // The line count, so that masking a number cannot hide a stage that never ran.
  assertEquals(lines.length, 16, `${host}: ${r.out}`);
  assertEquals(lines[0], "wacland: stage 1 output");
  assertEquals(r.err.trim(), "wacland: stage 1 warn", `${host} put the warning on the wrong stream`);
  assertEquals(lines.includes("wacland: stage 2 argCount 2"), true, r.out);
  assertEquals(lines.includes("wacland: stage 2 arg 1 two"), true, r.out);

  const s3 = stage3(r.out);
  // 0087's first criterion. The *long* sleep is submitted first, so a host that answered in
  // submission order — or that resolved every ticket as it was made — says 0 here.
  assertEquals(s3.first, 1, `${host} settled the two sleeps in submission order`);
  assertEquals(s3.quick < s3.slow, true, `${host}: quick ${s3.quick} did not settle before ${s3.slow}`);
  // Both are monotonic nanoseconds from the host's own origin, so only the *gap* is comparable. 120
  // and 10 were asked for; anything between 50 and 500 ms of separation says the two sleeps really
  // slept for different lengths rather than both returning at once.
  const gapMs = (s3.slow - s3.quick) / 1e6;
  assertEquals(gapMs > 50 && gapMs < 500, true, `${host}: the sleeps were ${gapMs}ms apart`);

  // 0087's second criterion: a deadline with nothing ready comes back rather than hanging, and -1 is
  // what `platform.wac` says "nothing settled" is spelled.
  assertEquals(lines.includes("wacland: stage 4 timeout -1"), true, r.out);

  // Stage 6, both halves. **The env half is the one that discriminates**: `GRANT_READ` is bit 1 and
  // every encoding of these flags agrees about bit 1, so a host that decoded the higher bits
  // differently would pass the read half and this whole file. `GRANT_ENV` is bit 8.
  assertEquals(lines.includes("wacland: stage 6 withheld denied"), true, r.out);
  assertEquals(lines.includes("wacland: stage 6 granted ok"), true, r.out);
  assertEquals(lines.includes("wacland: stage 6 env withheld denied"), true, r.out);
  assertEquals(lines.includes("wacland: stage 6 env granted seen"), true, r.out);

  // 0087's third criterion, and the one it calls the point: a child spawned, its bytes read back, and
  // its exit waited for *alongside* a ticket of a completely different kind. A readiness table that
  // only handles one sort of event fails here and nowhere else.
  assertEquals(lines.includes("wacland: stage 5 first 0"), true, `${host} did not wait over both: ${r.out}`);
  assertEquals(lines.includes("wacland: stage 5 heard wacland: I am the child"), true, r.out);
  assertEquals(lines.includes("wacland: stage 5 status 7"), true, `${host}: the child's own status`);

  // **A child gets what its parent granted, and no more.** Asked twice on purpose: a child refused
  // when its parent had nothing to give is not evidence of an intersection, so this program is built
  // *with* reading and the two answers must differ. One answer would pass on a host that denied
  // everything and on a host that granted everything.
  assertEquals(lines.includes("wacland: stage 6 withheld denied"), true, `${host}: ${r.out}`);
  assertEquals(lines.includes("wacland: stage 6 granted ok"), true, `${host}: ${r.out}`);

  assertEquals(lines[lines.length - 1], "wacland: reached the end of what is implemented");
}

Deno.test("the same program says the same thing on a JavaScript host and one that is not", async () => {
  const denoProgram = `${tmp}/wacland-deno`;
  // **With reading**, which stage 6 needs: it hands a child `GRANT_NONE` and then `GRANT_READ`, and
  // a parent that could not read either way would prove nothing about the ceiling.
  await buildApp(ENTRY, denoProgram, { read: true, env: true });
  const js = await runIt(denoProgram, ["one", "two"]);

  // The Deno half on its own, so that a skipped native half still tests something.
  assertConformant(js, "deno");

  const native = await nativeBinary();
  if (native === null) return;

  await buildNative(ENTRY, `${tmp}/wacland`, { read: true, env: true });
  const rs = await runIt(native, [`${tmp}/wacland.json`, "one", "two"]);
  assertConformant(rs, "native");

  // And the transcripts are the same, once the two measurements are masked.
  assertEquals(masked(rs.out), masked(js.out), "the two hosts disagree");
  assertEquals(rs.err, js.err, "the two hosts disagree about the error stream");
  // The canary for the masking itself: it must not have eaten the whole line.
  assertEquals(masked(rs.out).includes("stage 3 quick <nanos>"), true, masked(rs.out));
  assertEquals(masked(rs.out).includes("<nanos><nanos>"), false, "the mask is too greedy");
});

Deno.test("the manifest carries the field order rather than the runtime holding a copy", async () => {
  // The failure this guards is silent and expensive: insert a capability in the middle of `Core` in
  // `platform.wac`, and a runtime with its own idea of the order builds a `Core` whose `log` is the
  // previous field's function. Every call would go somewhere plausible.
  const m = await buildNative(ENTRY, `${tmp}/order`, {});
  const core = m.structs.find((s) => s.name === "Core");
  if (core === undefined) throw new Error("no Core in the manifest");
  assertEquals(core.fields.map((f) => f.name), [
    "nowMillis",
    "monotonicNanos",
    "sleepMillis",
    "randomBytes",
    "log",
    "warn",
    "waitAny",
    // Appended, not inserted, and that is the whole discipline this test enforces: a capability added
    // in the *middle* of `Core` shifts every field after it, and a runtime with its own idea of the
    // order would build a `Core` whose `log` is the previous field's function.
    "askInterrupt",
  ]);
  // Every field names a signature that is actually in the callback table — the lookup the runtime does.
  for (const f of core.fields) {
    assertEquals(
      m.callbacks.some((c) => c.type === f.type),
      true,
      `Core.${f.name} wants ${f.type}, which is in no callback`,
    );
  }
  assertEquals(core.methods.find((x) => x.name === "of")?.export, "$bind$sm_Core_of");
});
