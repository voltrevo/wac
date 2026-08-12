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
    where: "native_hostfs: `test -h` over a real symlink and a real dangling one, against GNU on " +
      "both hosts, with `test -e` beside each — the pair is what says these are two different calls " +
      "rather than one answering for both. The fixture makes the links itself because there is no " +
      "`ln` in this system, so no script could make its own; that absence is why this sat as a gap " +
      "while `Fs.linkStat` had two callers",
  },
  READ_DIR: { where: "native_hostfs: `ls`" },
  MKDIR: { where: "native_hostfs: `mkdir d2; ls; rmdir d2`" },
  REMOVE: { where: "native_hostfs: `rm made`" },
  RENAME: { where: "native_hostfs: `mv f moved`" },
  SET_EXECUTABLE: {
    gap: "no two-host comparison. The one caller is a git checkout, and its oracle is `git status` " +
      "over a real repository — `packages/git/test/checkout.test.ts` requires an executable to come " +
      "out executable and the porcelain to be empty, which is a sharper check than two hosts " +
      "agreeing but runs on one of them. Worth pairing when native_hostfs next grows a case: the " +
      "arithmetic is duplicated three times (Deno, Node, Rust) and only the Deno copy is exercised, " +
      "so a wrong mask in the other two would not be caught here. issues/system/0132",
  },
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
  CLOSE_FEED: {
    where: "native_shell: pipelines in the corpus slice — and native_examples' `feed`, which is the " +
      "only place the *distinction* from `closeSocket` is asked on both hosts: the child has to stay " +
      "alive to say what it heard, which a stop would prevent",
  },
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
    where: "native_examples: `clocks` asks the *shape* rather than the value, which is the only thing " +
      "two clocks can agree on — this one dates, so the claim is that it is past a moment already " +
      "gone. The gap here used to say a comparison was impossible by construction; what was missing " +
      "was a program that compared the promises instead of the readings",
  },
  MONOTONIC_NANOS: {
    where: "native_examples: `clocks` reads it twice and requires the second not to be earlier — " +
      "equal is fine, a coarse clock read inside one microsecond says so — and separately requires " +
      "it not to be a plausible epoch stamp, which is what a host answering the wall clock in " +
      "disguise would produce while passing everything else",
  },
  SLEEP_MILLIS: {
    where: "native_examples: `clocks` brackets a 50ms sleep between two monotonic reads and asks " +
      "three things — it lasted at least as long as asked, it reported a reading that lands inside " +
      "the bracket rather than an invented number, and the two hosts said the same. **No upper " +
      "bound**: a sleep that overran is a loaded machine, not a broken host, and bounding it would " +
      "measure the machine — `harness/bounded.ts` makes the same argument at greater length",
  },
  RANDOM_BYTES: {
    where: "native_examples: `entropy` walks the documented range — 1 byte, the 65,536-byte Web " +
      "Crypto cap, one byte past it, and the megabyte ceiling — and asks of each that the length " +
      "came back and that a large block is not one repeated byte, which is what an unfilled chunk " +
      "looks like. The bytes are random by definition and are not compared. This entry used to " +
      "rest on `head -c 16 /dev/urandom | wc -c` in native_shell, which still runs and still says " +
      "a sealed session gets a CSPRNG **without a grant** — but sixteen bytes is on the near side " +
      "of every boundary, and 0122 was two hosts throwing above 64 KiB inside a range all three " +
      "of them bounds-checked as legal",
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
  CONNECT: {
    where: "native_examples: `writeread` listens, accepts and connects to itself on loopback, so one " +
      "program exercises all three on both hosts and the transcripts are compared. The port differs " +
      "by construction and is masked; it is allocated per run by `harness/port.ts` rather than fixed, " +
      "because these run in the parallel lane. Before this the network was exercised end to end by " +
      "`arrival_users` over ssh — but only with the native host as the *server*, so nothing compared " +
      "the three calls themselves",
  },
  LISTEN: { where: "as CONNECT — the same program, the same run" },
  BIND_DATAGRAM: {
    gap: "**every host answers it; nothing compares two of them.** `datagram.test.ts` drives the " +
      "Deno host against Deno's own UDP, which is a differential against the *runtime* rather than " +
      "between hosts. Both native hosts have arms — wasmtime's `Sock::Datagram` and V8's — and " +
      "`Cli` declares the three capabilities, so a wac program can reach one; what does not exist " +
      "yet is a program that echoes a datagram run on both. design/system 0007 step 1 ends there, " +
      "and this entry becomes a `where` when it does",
  },
  RECEIVE_FROM: { gap: "as BIND_DATAGRAM — the same step, the same work" },
  SEND_TO: { gap: "as BIND_DATAGRAM" },
  ACCEPT: { where: "as CONNECT" },
  RECV: {
    where: "native_shell: every filesystem operation of every spawned stage. `sealedsh` spawns its " +
      "stages and serves their filesystem over a handle (wac-mono 0116), so a corpus script that " +
      "reads a file is `send` and `recv` in both directions on both hosts — which is why this " +
      "stopped being a gap without a test being written for it",
  },
  SEND: {
    where: "native_shell: as RECV, and the same traffic — plus native_examples' `feed`, which asks " +
      "the part a pipeline never reaches: what the **bool** says. `send` answers `Pending<bool>` and " +
      "three JavaScript hosts were not answering it at all (`kid.in.push(...)` with the result " +
      "discarded), so a send after `closeFeed` reported success and dropped the bytes — 0121, and " +
      "0120 in the same line. The example also asks the other direction, where the native host was " +
      "the one out of step: its queues had no cap, so a child writing nine megabytes into a parent " +
      "that would not read never waited, while every JavaScript host held it at eight",
  },
  SPAWN: {
    gap: "**not implemented in the native runtime**, which is the answer rather than a missing test. " +
      "What `spawn` takes is a program's *source*, and on the JavaScript hosts that means a worker " +
      "bundle — an artifact no wasmtime host could run whatever it did with it. `native/src/main.rs` " +
      "answers -1 with a reason (not -2, which would mean this world cannot spawn at all and would " +
      "make the shell give up on `spawnSelf` too, which works). So there is nothing here for two " +
      "hosts to agree *about*, and what is compared instead is everything around it: `native_hostfs` " +
      "runs a path that is not a program on both and pins each runtime's sentence, and the three " +
      "cases the *filesystem* settles — missing, a directory, a path in a pipeline — are compared " +
      "against GNU on both hosts, where all of them used to be `command not found` and 127",
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

/**
 * The capability *fields* `platform.wac` declares, by struct.
 *
 * `opcodes()` reads the JavaScript side's numbering; this reads the language's own declaration, which
 * is what a wac program can actually ask for. The two are different questions and only this one can
 * answer "is there a capability the wasm host has never heard of" — an opcode nobody assigned a
 * number to would be missing from `ops.ts` *and* from `main.rs`, and would look consistent.
 *
 * **The `.*` is greedy on purpose.** A signature contains array types — `fn[Pending<bool>(string,
 * i32, i32, u8[])] drawPixels;` — so a bracket class stops at the `]` of `u8[]` and drops the field
 * silently. Written that way first, this reported 20 `Cli` fields where there are 31 and would have
 * certified a surface it had not looked at a third of.
 */
async function declaredFields(struct: string): Promise<string[]> {
  const src = await Deno.readTextFile("packages/platform/src/platform.wac");
  const body = new RegExp(`export struct ${struct} \\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (body === null) throw new Error(`no struct ${struct} in platform.wac`);
  return [...body[1].matchAll(/^\s*fn\[.*\]\s+(\w+);\s*$/gm)].map((m) => m[1]);
}

Deno.test("the README's capability table lists every capability there is", async () => {
  // The table in `packages/platform/README.md` is the first thing a person reads to find out what a
  // program may ask for, and it is the kind of list that goes quietly short: three capabilities had
  // been added to `platform.wac` without it — `Core.askInterrupt`, `Cli.spawnSelf` and `Page.setStyle`
  // — each by a different piece of work, none of which was looking at a README.
  //
  // `tools/docSignatures.test.ts` checks that every name a README *quotes* exists. This is the other
  // direction, which nothing had: that every name that exists is quoted. A reader cannot tell a
  // capability that is missing from the table from one that does not exist.
  const table = await (async () => {
    const src = await Deno.readTextFile("packages/platform/README.md");
    const from = src.indexOf("| | capability | grant |");
    if (from < 0) throw new Error("the capability table is gone from the README");
    return src.slice(from, src.indexOf("\n\n", from));
  })();
  for (const struct of ["Core", "Cli", "Page"]) {
    const declared = await declaredFields(struct);
    const missing = declared.filter((f) => !table.includes(`\`${f}\``));
    assertEquals(
      missing.join(" "),
      "",
      `${struct}: declared in platform.wac and absent from the README's table`,
    );
  }
});

Deno.test("every capability the language declares, the host with no JavaScript supplies", async () => {
  // design/0001's aim is that the same programs run on a bootable kernel-and-wasmtime stack *and*
  // without it. That makes "is anything in the JavaScript hosts load-bearing that the wasm side
  // cannot supply?" a question with a definite answer, and this is it: for `Cli` and `Core`, nothing.
  //
  // The two known exceptions are behavioural rather than structural and are covered elsewhere:
  // `spawn` of a *foreign* program answers -1 with a reason on the native host (see `SPAWN` above),
  // and `Page` does not exist there at all — which is the next assertion rather than a hole.
  const caps = await nativeCapabilities();
  for (const struct of ["Cli", "Core"]) {
    const declared = await declaredFields(struct);
    // The count first: an extraction that quietly matched nothing would make the loop below vacuous,
    // which is how this test would come to certify a surface it never read.
    assertEquals(
      declared.length >= 8,
      true,
      `only ${declared.length} ${struct} fields found — has the extraction broken?`,
    );
    const missing = declared.filter((f) => !caps.has(f));
    assertEquals(
      missing.join(" "),
      "",
      `${struct}: the native runtime wires no arm for these, so a program that calls one traps ` +
        `with "not implemented in the native runtime yet" rather than getting an answer`,
    );
  }

  // And `Page` is the whole of what it cannot supply — stated as an equality rather than "some are
  // missing", so a capability *moved* onto `Page` to dodge the check above would fail here instead.
  const page = await declaredFields("Page");
  assertEquals(
    page.filter((f) => caps.has(f)).join(" "),
    "",
    "a `Page` field has a native arm, which means either the host grew a page or the struct grew a " +
      "field that is not about one",
  );
  assertEquals(page.length, 11, `Page declares ${page.length} fields; the ledger's page-only list has 11`);
});

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
    "DRAW_PIXELS GET_VALUE NEXT_EVENT NEXT_FILE OFFER_DOWNLOAD ON RENDER SET_STYLE SET_TEXT SET_VALUE TITLE",
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
