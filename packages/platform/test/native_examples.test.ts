// The capability layer itself, across two hosts: every runnable example in `example/`.
//
// The other native tests drive the boundary through `packages/sh` and `packages/box` — a lot of code
// above a little of it. These are the programs written *to demonstrate the capabilities*, one idea
// each: two reads in flight, a filter, a program running inside another with a world of its own, a
// program that runs itself, a filesystem round trip, what a build is allowed to do. If the two hosts
// agree on all of them, the agreement is about the boundary rather than about the shell.
//
// It found two things the first time it ran, which is why it is here rather than in a note:
//
//   1. **`probe` said `net=failed` where Deno said `net=denied`.** The native host answered an
//      ungranted `connect` with "networking is not implemented", which is a fact about the runtime
//      and irrelevant to a program that would be refused on every host. "Not granted" outranks "not
//      implemented", and `probe` is the program that reads the difference.
//   2. **`overlap` disagrees on purpose**, and the two hosts are both right — see below.
//
// ## The one line that is a race, on both hosts
//
// `overlap` asks `isDone()` immediately after submitting two reads, and no host promises *when* a
// read completes. On an idle machine Deno says "one finished already" every time and the native
// runtime says "both still running" every time — which looks exactly like a property of each host,
// and is not: under the full suite Deno says "both still running" too.
//
// This test pinned the idle answers first and the gate caught it within one run. So the line is
// **normalised on both sides** rather than expected per host: what is compared is that the two hosts
// agree about everything else, and that each printed *one of the two* legal answers rather than
// something else. design/0001's D12 is the decision that would make this deterministic.

import { buildApp } from "../build.ts";
import { holdPort } from "../../../harness/port.ts";
import { buildNative } from "../native.ts";
import { type Bounded, boundedInputAgain, DEFAULT_SECONDS, hangReport } from "../../../harness/bounded.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const CRATE = "native";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: "wac-examples-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

async function run(cmd: string, args: string[], stdin: string, where: string): Promise<Bounded> {
  // Asks again at three times the bound if the first attempt does not finish — see 0128.
  return await boundedInputAgain(DEFAULT_SECONDS, cmd, args, stdin, { cwd: where });
}

async function nativeBinary(): Promise<string | null> {
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
      `SKIPPING the native half: cargo did not build ${CRATE}.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}\n` +
        `  The Deno half below still runs. See issues/closed/0087.`,
    );
    return null;
  }
  return `${Deno.cwd()}/${CRATE}/target/release/wacland`;
}

/** One example: what to build it with, what to run it with, and what it reads. */
type Case = {
  name: string;
  args: string[];
  stdin: string;
  grants: { read?: boolean; write?: boolean; env?: boolean; net?: boolean };
  /**
   * A line with more than one legal answer, and every answer it may have.
   *
   * Normalised away before comparing, and checked to be one of these — which is the difference
   * between allowing a race and ignoring a line.
   */
  racy?: string[];
  /**
   * This example needs a port, and the runner allocates a free one per run.
   *
   * Not a fixed number in `args`: these tests run in the parallel lane, and `harness/port.ts` exists
   * because binding a port somebody else has taken is a real failure here rather than a theoretical
   * one. The port reaches the program as its last argument and comes back in its transcript, which
   * is why a `mask` goes with it.
   */
  port?: true;
  /**
   * A measurement to mask before comparing.
   *
   * `crowd` prints how long its calls took, which two runs of the *same* host would not agree on
   * either. Masking is right where the number is a measurement; where it is an answer, masking would
   * be the test quietly agreeing with itself.
   */
  mask?: RegExp;
};

const CASES: Case[] = [
  { name: "hexdump", args: [], stdin: "a b c\nd e\n", grants: {} },
  { name: "wc", args: [], stdin: "a b c\nd e\n", grants: {} },
  { name: "roundtrip", args: ["hello"], stdin: "", grants: { read: true, write: true } },
  { name: "probe", args: [], stdin: "", grants: { read: true } },
  { name: "twin", args: [], stdin: "", grants: {} },
  { name: "inside", args: ["."], stdin: "", grants: { read: true, write: true } },
  { name: "crowd", args: ["4"], stdin: "", grants: {}, mask: /elapsed \d+ms/g },
  // **A child that only computes**, stopped by its parent, on both hosts. Nothing else here needs a
  // host to *terminate* anything: every other program writes, so ending its queues is enough to make
  // it notice. Issue 0123 said this had no reproduction in the repository — it does now, and what
  // makes it one is that the child never writes again after its first line.
  { name: "stop", args: [], stdin: "", grants: {} },
  // **The three clocks**, which were named gaps because a clock answers differently on every run.
  // What is comparable is the *shape* `Core` promises — monotonic never goes backwards, a sleep
  // waits at least as long as it was asked and reports a monotonic reading, the wall clock dates —
  // so the example prints verdicts rather than measurements and two hosts can agree on all five.
  { name: "clocks", args: [], stdin: "", grants: {} },
  // **`randomBytes` across its whole documented range**, which is the other capability whose answer
  // cannot be compared byte for byte — so, again, verdicts. The ledger's entry for it used to rest on
  // `head -c 16 /dev/urandom`, and sixteen bytes is on the near side of every boundary that matters:
  // Web Crypto refuses more than 65,536 bytes in one call, so Deno and the browser threw on anything
  // larger while Node, which chunked, did not (0122). Four sizes, one of them one byte past the cap.
  { name: "entropy", args: [], stdin: "", grants: {} },
  // **What `send` answers when the far end has stopped listening**, which is a bool the three
  // JavaScript hosts were not answering at all: `kid.in.push(...)` with the result discarded and the
  // promise unawaited, so a send after `closeFeed` claimed success and dropped the bytes (0121) and
  // never waited for room (0120). The native runtime answered `stream.write` from the start, so this
  // example is the two of them being asked the same question.
  { name: "feed", args: [], stdin: "", grants: {} },
  // **The network, which had no two-host comparison at all** — `CONNECT`, `LISTEN` and `ACCEPT` were
  // three named gaps whose entry said the network is exercised end to end by `arrival_users` over
  // ssh, but only with the native host as the *server*. This is one program doing all three against
  // itself on loopback, so both hosts answer the same question.
  {
    name: "writeread",
    args: [],
    stdin: "",
    grants: { net: true },
    port: true,
    // The port is the one thing that differs between two runs, by construction.
    mask: /connected on port \d+/g,
  },
  {
    name: "overlap",
    args: ["in.txt", "in.txt"],
    stdin: "",
    grants: { read: true },
    racy: ["one finished already", "both still running"],
  },
];

/**
 * A directory of its own for each run, with the one fixture in it.
 *
 * **Not one shared directory**, which is what this had first and which failed on `roundtrip` — it
 * prints how many entries its `readDir` saw, and the test was writing a `.wasm` and a `.json` for
 * every case into the same place between the two runs. The hosts agreed perfectly and the directory
 * had changed underneath them, which reads exactly like a difference and is not one.
 */
function workspace(name: string, which: string): string {
  const dir = `${tmp}/run/${name}-${which}`;
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(`${dir}/in.txt`, "a b c\nd e\n");
  return dir;
}

Deno.test("the capability examples answer the same on both hosts", async () => {
  const native = await nativeBinary();

  for (const c of CASES) {
    const jsPath = `${tmp}/${c.name}-deno`;
    await buildApp(`packages/platform/example/${c.name}.wac`, jsPath, c.grants);
    // Held until the moment the program binds — `holdPort` picks a free number and keeps it, which is
    // the difference between avoiding a collision and reducing the odds of one.
    const jsPort = c.port === undefined ? null : holdPort();
    jsPort?.release();
    const js = await run(
      jsPath,
      [...c.args, ...(jsPort === null ? [] : [String(jsPort.port)])],
      c.stdin,
      workspace(c.name, "deno"),
    );
    // Each example is asserted to have *said something* on its own, so a skipped native half still
    // tests that the Deno side runs — and so that two silent hosts cannot agree.
    //
    // Both streams, because `crowd` reports through `warn` and the first version of this checked
    // standard output alone and called a working program silent.
    assertEquals(js.out.length + js.err.length > 0, true, `deno ${c.name} printed nothing`);

    if (native === null) continue;
    await buildNative(`packages/platform/example/${c.name}.wac`, `${tmp}/${c.name}`, c.grants);
    const rsPort = c.port === undefined ? null : holdPort();
    rsPort?.release();
    const rs = await run(
      native,
      [`${tmp}/${c.name}.json`, ...c.args, ...(rsPort === null ? [] : [String(rsPort.port)])],
      c.stdin,
      workspace(c.name, "native"),
    );

    const hide = (s: string) => {
      let out = c.mask === undefined ? s : s.replace(c.mask, "<measured>");
      for (const answer of c.racy ?? []) out = out.replace(answer, "<either>");
      return out;
    };
    // Each host must have printed *one of* the legal answers, not merely something maskable: that is
    // the difference between allowing a race and ignoring a line.
    for (const [name, r] of [["deno", js], ["native", rs]] as const) {
      if (c.racy !== undefined) {
        assertEquals(
          c.racy.some((answer) => r.out.includes(answer)),
          true,
          `${name} ${c.name} said none of ${JSON.stringify(c.racy)}: ${r.out}`,
        );
      }
    }
    assertEquals(hide(rs.out), hide(js.out), `${c.name}: stdout`);
    assertEquals(hide(rs.err), hide(js.err), `${c.name}: stderr`);
    const stuck = hangReport(c.name, [{ name: "deno", run: js }, { name: "native", run: rs }]);
    if (stuck !== null) throw new Error(stuck);
    assertEquals(rs.code, js.code, `${c.name}: status`);
  }
});
