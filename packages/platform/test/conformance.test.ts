// What a second host has to answer the same way, opcode by opcode — and what nothing yet checks.
//
// design/system/0001's open questions name this as the largest risk in the direction: "the native core
// is the first large subsystem here with nothing independent to check it against, in a repo whose
// rigour is mostly differential." Since then a good deal *has* been checked — the arrival test moves an
// image between the two hosts, `native_hostfs.test.ts` compares twelve filesystem operations and every
// grant refusal, `native_shell.test.ts` runs a slice of the shell corpus on both — but that coverage
// grew a file at a time, and **nothing knew what it added up to.**
//
// This is the ledger. For every opcode on the two-host surface it names where the comparison lives, or
// says plainly that there is none. It is not a second copy of those tests and it does not re-run them:
// duplicating a differential is how two of them come to disagree.
//
// ## The surface is derived, and the derivation is where I tripped
//
// The opcodes come from `host/ops.ts` and the native host's capabilities from the `("Core", "name")`
// table in `native/src/main.rs`; an opcode with no capability there is page-only. That mapping is
// `SCREAMING_SNAKE` to `camelCase` **except for two**, and a naive conversion reported `WRITE_STDOUT`
// and `WRITE_STDERR` as missing from a runtime that plainly writes — they are `Cli.write` and
// `Cli.writeErr`. The exceptions are listed rather than guessed, because a mapping that is right 36
// times out of 38 is the kind that gets believed.
//
// ## Three of the first entries were wrong, which is the argument for writing it down
//
// I filled this in from memory of tests I had written myself, and then checked each claim against the
// file it named. `OUTPUT_ERROR` and `READ_STDIN` had no comparison at all — every two-host runner
// passes `stdin: "null"`, so the one thing none of them exercises is a program reading its input — and
// `LINK_STAT` was an embellishment: `find .` is compared on both hosts and calls `stat`, not
// `linkStat`. A ledger of remembered coverage is worse than none, because it reads like an audit.
//
// ## Why a ledger rather than more tests
//
// An unaccounted-for surface is the failure this repository keeps finding in its own measurements: a
// suite that covers twelve of thirty-eight and reports twelve passes reads exactly like one that
// covers everything. Naming the twenty-six is worth more than quietly adding a thirteenth, and it is
// what makes adding the thirteenth an obvious next move rather than an idea somebody has to have.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/**
 * The opcodes whose wac-side name is not the camelCase of the opcode.
 *
 * Two, and both are the standard streams. Kept here rather than fixed in either file: the opcode is
 * named for the stream it writes and the capability for what a caller does, and both are the better
 * name in their own place.
 */
const RENAMED: Record<string, string> = {
  WRITE_STDOUT: "write",
  WRITE_STDERR: "writeErr",
};

const camel = (op: string) =>
  RENAMED[op] ??
  op.toLowerCase().split("_").map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");

async function opcodes(): Promise<string[]> {
  const src = await Deno.readTextFile("packages/platform/host/ops.ts");
  return [...src.matchAll(/^ {2}([A-Z][A-Z_0-9]*): \d+,$/gm)].map((m) => m[1]);
}

async function nativeCapabilities(): Promise<Set<string>> {
  const src = await Deno.readTextFile("native/src/main.rs");
  return new Set([...src.matchAll(/\("(?:Core|Cli|Page)", "(\w+)"\) => Cap::/g)].map((m) => m[1]));
}

/**
 * Where each opcode's two-host comparison lives, or why there is none.
 *
 * `where` names a test that runs the *same wac* on both hosts and compares. A `gap` is an opcode no
 * such test reaches — not an accusation, a work list, and the reason each one is hard is worth as much
 * as the entry itself.
 */
type Cover = { where: string } | { gap: string };

const COVERAGE: Record<string, Cover> = {
  // ── The filesystem: twelve operations and every grant refusal, on both hosts ──
  READ_FILE: { where: "native_hostfs: `cat f`, and refused with no grant" },
  WRITE_FILE: { where: "native_hostfs: `touch`, and write-only grants" },
  STAT: { where: "native_hostfs: `stat f`" },
  LINK_STAT: {
    gap: "two callers now — `test -h` in the shell and `tar`, both through `Fs.linkStat`, which " +
      "dispatches rather than answering `stat` everywhere (that is what let `tar` ask the *host* " +
      "about a path in an image). Still no two-host script reaches it: the corpus has no `tar` and " +
      "no `test -h`. `find .` is compared on both hosts and does *not* reach this — it calls " +
      "`stat`, which I had assumed otherwise when first writing this ledger",
  },
  READ_DIR: { where: "native_hostfs: `ls`" },
  MKDIR: { where: "native_hostfs: `mkdir d2; ls; rmdir d2`" },
  REMOVE: { where: "native_hostfs: `rm made`" },
  RENAME: { where: "native_hostfs: `mv f moved`" },
  OPEN_INPUT: { where: "native_hostfs: `cat < f`, refused with no grant" },
  OPEN_OUTPUT: { where: "native_hostfs: `echo new > made`" },
  READ_CHUNK: {
    where: "native_hostfs: `cat sub/deep > out` streams, and 300 KB through stdin — past one chunk, " +
      "which is the only case that makes `readChunk` loop",
  },
  OUTPUT_ERROR: {
    gap: "nothing compares it. It carries the reason a `write` that answered false failed, so a host " +
      "that dropped the reason would show as an empty message rather than a wrong one",
  },

  // ── The system a session is ──
  SPAWN_SELF: {
    where: "native_hostfs: `kill %1` ends a background job on both; native_shell runs a sealed " +
      "session whose every command is a spawned child, so all three of a child's handles are " +
      "exercised rather than only its output",
  },
  EXIT_CODE: { where: "native_hostfs: the status of every AGREED script" },
  CLOSE_SOCKET: { where: "native_hostfs: `kill %1` is delivered by closing the child" },
  CLOSE_FEED: { where: "native_shell: pipelines in the corpus slice" },
  CWD: { where: "native_hostfs: every script `cd`s first, by design" },
  WRITE_STDOUT: { where: "native_shell: 25 corpus scripts, byte for byte" },
  WRITE_STDERR: { where: "native_hostfs: stderr compared on every AGREED script" },
  ARG_COUNT: { where: "native_shell: `sealedsh -c` passes its script as an argument" },
  ARG: { where: "native_shell: same" },
  READ_STDIN: {
    where: "native_hostfs: ten scripts with real piped input — this gap is what found the bug that " +
      "every filter under a spawning shell read nothing on the native host",
  },

  // ── Named gaps. Each says what makes it hard, because that is the next person's starting point ──
  NOW_MILLIS: {
    gap: "no two-host comparison: a clock answers differently by construction, so the comparable " +
      "thing is the *shape* — monotonicity, and that an image's mtimes survive a move — which " +
      "`arrival` checks incidentally rather than as a claim about this opcode",
  },
  MONOTONIC_NANOS: {
    gap: "as NOW_MILLIS. D13's virtual clock is the design answer and would make it comparable",
  },
  SLEEP_MILLIS: {
    gap: "`native_examples` runs the capability examples on both, which includes two sleeps out of " +
      "order — but through `waitAny`, so a regression in sleep alone would show as a timing flake " +
      "rather than a difference",
  },
  RANDOM_BYTES: {
    where: "native_shell: `head -c 16 /dev/urandom | wc -c` on both hosts, and `head -c 1` beside " +
      "it. The bytes are random by definition and are not compared; the two claims that *are* " +
      "comparable are the length and that a sealed session gets a CSPRNG **without a grant** — " +
      "`Backing.Synth` carries `randomBytes` and nothing else — and both are now asked on both",
  },
  LOG: { gap: "no comparison: `log` goes to the host's own stream, which the two hosts frame differently" },
  WARN: { gap: "as LOG" },
  ENV: {
    where: "native_shell: the seal, on both hosts. `sealing.test.ts` had asked it on one, which is " +
      "half a claim about a design whose whole point is that the same system appears on two — and " +
      "the two runtimes reach the environment by completely different routes. Both binaries are " +
      "built **with** the env grant and a session still sees none of it, with a canary that the " +
      "grant is live on each: an unsealed shell prints the machine's `$HOME` on both, or the seal " +
      "below would be passing against a runtime that never reads the environment for anybody",
  },
  CONNECT: { gap: "the network is exercised end-to-end by `arrival_users` over ssh, but only on the native host as the *server*; no opcode-level comparison" },
  LISTEN: { gap: "as CONNECT" },
  ACCEPT: { gap: "as CONNECT" },
  RECV: {
    where: "native_shell: every filesystem operation of every spawned stage. `sealedsh` spawns its " +
      "stages and serves their filesystem over a handle (wac-mono 0116), so a corpus script that " +
      "reads a file is `send` and `recv` in both directions on both hosts — which is why this " +
      "stopped being a gap without a test being written for it",
  },
  SEND: { where: "native_shell: as RECV, and the same traffic" },
  SPAWN: {
    gap: "only `spawnSelf` is compared. `spawn` of a *foreign* program has no two-host test, and it " +
      "is the one whose grant intersection differs most between runtimes",
  },
  PUSH_CHILD: {
    gap: "**no longer exercised constantly**, which is what this entry used to say. wac-mono 0116 " +
      "turned spawning on for every session binary, so an applet is a child rather than a frame " +
      "and this route is now only `packages/box/example/boxsh.wac` and any world that cannot " +
      "spawn. `packages/box/test/routes.test.ts` compares the two routes against each other — 821 " +
      "of 821 corpus scripts agree — but on **one host**, so this is still a two-host gap. And the " +
      "two hosts are known to differ here: the JavaScript hosts cap a frame's output at 8 MiB and " +
      "answer `Captured.truncated`, while the native runtime's frame is a `Vec` that grows, so it " +
      "never truncates and always answers false. Nothing compares them, which is exactly what makes " +
      "it worth writing down",
  },
  POP_CHILD: { gap: "as PUSH_CHILD" },
  ASK_INTERRUPT: {
    gap: "answers no on every host but a page, so there is nothing for two non-page hosts to " +
      "disagree about. The page's answer is checked in a real browser by `browser_live`",
  },
};

Deno.test("every opcode on the two-host surface is accounted for", async () => {
  const ops = await opcodes();
  const caps = await nativeCapabilities();
  const shared = ops.filter((o) => caps.has(camel(o)));
  const pageOnly = ops.filter((o) => !caps.has(camel(o)));

  // The derivation itself, asserted: a mapping that silently stopped matching would report the whole
  // surface as page-only and this file would have nothing to say while looking complete.
  assertEquals(shared.length >= 35, true, `only ${shared.length} shared opcodes — has the mapping broken?`);
  assertEquals(
    pageOnly.sort().join(" "),
    "DRAW_PIXELS GET_VALUE NEXT_EVENT NEXT_FILE OFFER_DOWNLOAD ON RENDER SET_TEXT SET_VALUE TITLE",
    // Pinned rather than derived, on purpose and against this file's own grain: a capability the
    // native host *dropped* would arrive here looking exactly like a page-only one, so this is the
    // assertion that has to be a written-down expectation. It was wrong when first typed — `GET_VALUE`
    // was missed — which is the argument for pinning it against a measured set rather than a
    // remembered one, and for the count check above catching the coarse version of the same mistake.
    "the page-only set moved; a capability the native host dropped would look like one",
  );

  const unlisted = shared.filter((o) => COVERAGE[o] === undefined);
  assertEquals(
    unlisted.join(", "),
    "",
    "opcodes with no entry in COVERAGE. A new capability needs a comparison on both hosts, or an " +
      "entry saying what makes one hard — quietly uncovered is the one option this file exists to stop",
  );

  const listedButGone = Object.keys(COVERAGE).filter((o) => !shared.includes(o));
  assertEquals(listedButGone.join(", "), "", "COVERAGE names opcodes that are not on the shared surface");
});

Deno.test("the ledger says how much of the surface is actually compared", async () => {
  const ops = await opcodes();
  const caps = await nativeCapabilities();
  const shared = ops.filter((o) => caps.has(camel(o)));
  const covered = shared.filter((o) => "where" in (COVERAGE[o] ?? {}));

  // **Printed, not merely asserted.** A number nobody sees is a number nobody acts on, and the point
  // of the ledger is that the gap is visible from a normal run rather than by reading this file.
  console.log(
    `    two-host conformance: ${covered.length} of ${shared.length} opcodes have a comparison; ` +
      `${shared.length - covered.length} are named gaps`,
  );

  // A floor rather than a target: this is allowed to go up without editing the test, and a change
  // that takes it *down* — a comparison deleted, an opcode added with a gap entry and forgotten —
  // has to be deliberate.
  assertEquals(
    covered.length >= 24,
    true,
    `only ${covered.length} opcodes are compared across hosts; this was 19 when the ledger was written`,
  );
});
