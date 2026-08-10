// `packages/box/src/bin/sh.wac` — the shell with every applet in this package as a command.
//
// This binary had no test at all, which mattered once it stopped merely *calling* its applets. It
// now runs each one as a spawned child: its own wasm instance, its own grants, its own two streams.
// The three things that can go wrong with that are all here — the program has to be able to be its
// own applets, the child has to stand where the shell stands, and a child's error output must not
// arrive in the pipe.
//
// Compared against bash where the answer is bash's to give. `packages/sh` has its own differential
// suite of 539 scripts against bash; this file is about the *wiring*, not the language.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const dir = await Deno.makeTempDir({ prefix: "box-shell-" });
/**
 * Remove what this file built, however it ends.
 *
 * `Deno.test` has no suite-level teardown, so a module-level temp used by several tests had nowhere to
 * be cleaned up and was left behind — one built binary of about 700 KiB per run of the suite. Five
 * hundred of them were sitting in `/tmp` when a parallel run finally died with "No space left on
 * device", in the middle of a package that had nothing to do with it. `unload` fires on the way out
 * whether the tests passed, failed or threw, which is the only hook that covers all three.
 */
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(dir, { recursive: true });
  } catch {
    // Already gone, or never made. Nothing to report on the way out.
  }
});

const shell = `${dir}/wacsh`;
await buildApp("packages/box/src/bin/sh.wac", shell, { read: true, write: true, env: true });

function run(args: string[], stdin = "", cwd = dir) {
  const r = new Deno.Command(shell, { args, cwd, stdin: "piped", stdout: "piped", stderr: "piped" })
    .spawn();
  const w = r.stdin.getWriter();
  void w.write(new TextEncoder().encode(stdin)).then(() => w.close());
  return r.output().then((out) => ({
    code: out.code,
    out: new TextDecoder().decode(out.stdout),
    err: new TextDecoder().decode(out.stderr),
  }));
}

const sh = (script: string, stdin = "", cwd = dir) => run(["-c", script], stdin, cwd);

Deno.test("the shell's applets are programs of its own, spawned", async () => {
  // The multi-call entry, used directly: this binary *is* its applets, which is what makes
  // `spawnSelf` able to run them. Without it a spawned applet would start another shell.
  const direct = await run(["sort", "-n"], "10\n2\n33\n");
  assertEquals(direct.out, "2\n10\n33\n", direct.err);

  // And through the shell, which is the same bundle spawned again with different arguments.
  const piped = await sh("printf '10\\n2\\n33\\n' | sort -n | head -2");
  assertEquals(piped.out, "2\n10\n", piped.err);
  assertEquals(piped.code, 0, piped.err);
});

Deno.test("a spawned applet stands where the shell stands", async () => {
  // The shell's `cd` has to reach its children, or `cd sub; cat f` reads the wrong file — a spawned
  // program used to inherit the *host's* directory, which made the shell's own state invisible to
  // everything it ran. `spawn` and `spawnSelf` take a directory for this reason.
  await Deno.mkdir(`${dir}/sub`, { recursive: true });
  await Deno.writeTextFile(`${dir}/sub/f.txt`, "hello from sub\n");

  const r = await sh("cd sub; cat f.txt; pwd");
  assertEquals(r.out, `hello from sub\n${dir}/sub\n`, r.err);

  const theirs = await new Deno.Command("bash", {
    args: ["-c", "cd sub; cat f.txt; pwd"],
    cwd: dir,
    stdout: "piped",
    stderr: "null",
  }).output();
  assertEquals(r.out, new TextDecoder().decode(theirs.stdout), "and bash agrees");
});

Deno.test("a spawned applet's error output stays out of the pipe", async () => {
  // The regression this exists for: a child had *one* stream back to its parent, so its complaint
  // arrived on the same handle as its output — `cat nosuch | wc -c` counted the error message, and
  // `cat nosuch` printed it to standard output. A child has two handles now.
  const piped = await sh("cat nosuchfile | wc -c");
  assertEquals(piped.out.trim(), "0", `the pipe carried the complaint: ${piped.out}`);
  assertEquals(piped.err.includes("nosuchfile"), true, piped.err);

  const alone = await sh("cat nosuchfile");
  assertEquals(alone.out, "", `it went to standard output: ${alone.out}`);
  assertEquals(alone.err.includes("nosuchfile"), true, alone.err);
  assertEquals(alone.code, 1, alone.err);

  // bash puts the complaint on stderr and nothing in the pipe, which is the whole claim.
  const theirs = new Deno.Command("bash", {
    args: ["-c", "cat nosuchfile | wc -c"],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  assertEquals(
    new TextDecoder().decode(theirs.stdout).trim(),
    piped.out.trim(),
    "bash counts nothing either",
  );
});

Deno.test("...and a redirection of standard error takes it, through a spawned applet", async () => {
  // `2>` refused until 2026-08-08, and this pinned the refusal — "worth pinning beside the streams
  // work, now that a child really has two of them". The streams are what made implementing it
  // possible: an applet's complaint arrives on its own handle, so there are two buffers to place.
  //
  // Here rather than only in `packages/sh`'s corpus because the *spawned* path is this package's:
  // `cat` is an applet in another process, and its error stream crosses the bridge before anything
  // can route it.
  const dropped = await sh("cat nosuchfile 2>/dev/null; echo st=$?");
  assertEquals(dropped.err, "", `the complaint should have gone nowhere: ${dropped.err}`);
  assertEquals(dropped.out, "st=1\n", dropped.err);

  const kept = await sh("cat nosuchfile 2>&1 | wc -l");
  assertEquals(kept.out.trim(), "1", `the complaint should have gone down the pipe: ${kept.err}`);
});

// **Was tagged flaky against wac-mono 0082, and the cause is fixed**: it failed twice, both times
// under a full suite, with `Uncaught (in promise) Error: the child's output is not being read`. The
// throw is deliberate — that is how a host says false to `cli.write`, and `yes` is written to stop on
// a false — but the op that called the sink did not *await* it, so the rejection escaped and killed
// the parent instead of ending the producer. Issue 0115, and `platform/test/sinks.test.ts` is the
// deterministic test the race never gave anyone.
Deno.test("an endless producer stops at the cap rather than filling memory", async () => {
  // `yes` writes for ever by design, and `head -1` wants one line. A real shell ends this because
  // `head` closing its input stops `yes`; this shell runs its stages one at a time, so what ends it
  // is the 8 MiB cap on a queue nobody is reading — `write` starts answering false and `yes` is
  // written to notice. Before the cap existed on a *spawned* child's queue, a browser tab died of
  // this: the in-process route had one and the new route did not. Issue 0038 is the real fix.
  const r = await sh("yes | head -1; echo status=$?");
  assertEquals(r.out, "y\nstatus=0\n", r.err);

  // And the input a parent *sends* is never dropped, however much of it there is. The first cap
  // applied to every queue including a child's input, and on a loaded machine this came back as
  // "status=0" with no `y` at all: 8 MiB went into `head`'s input before `head` began reading, and
  // the overflow was discarded in silence. A cap belongs where a producer can be told to stop.
  // Fifty thousand lines rather than the million it would take to reach 8 MiB: the exact size is not
  // the point, and a million `seq` writes costs half a minute of bridge round trips (issue 0039).
  // What this pins is that a large payload crosses a pipeline intact, which is what silently failed.
  const big = await sh("seq 1 50000 | tail -1");
  assertEquals(big.out.trim(), "50000", big.err);
});

Deno.test("...and an endless producer in a pipeline that cannot stream does not kill the shell", async () => {
  // **The third place the same bytes pile up**, and the one that had no cap. A pipeline `canStream`
  // refuses runs its stages one at a time, so a stage's whole output lands in the shell's own `Buf`
  // before the next stage starts — and `yes` never ends, so that `Buf` grew until the wasm allocator
  // refused it and took the shell with it: `error: requested new array is too large`, about eleven
  // seconds in, with the rest of the script never running. Issue 0127.
  //
  // Two shapes, and the difference matters. `nosuchcmd` is a stage that cannot run at all; `x=1 cat`
  // is a stage that runs perfectly well and merely cannot be *streamed*, because a prefix assignment
  // is not a simple spawnable word. Only the second is about streaming; both used to die.
  for (const script of ["yes | nosuchcmd; echo after=$?", "yes | x=1 cat | head -1; echo after=$?"]) {
    const r = await sh(script);
    // The shell is alive at the end of the script, which is the whole claim.
    assertEquals(
      r.out.includes("after="),
      true,
      `${script}: the shell did not survive its own pipeline: ${JSON.stringify(r.out + r.err)}`,
    );
    assertEquals(
      r.err.includes("exceeded what this shell can hold"),
      true,
      `${script}: nothing said the output had been cut: ${JSON.stringify(r.err)}`,
    );
  }

  // **The status is the refusal's, and this is a deliberate deviation from bash.** It reported 127
  // here until the shell learned to tell "the command failed" from "we could not run it": bash's
  // rule is the last stage's status, `nosuchcmd` is 127, and the two happened to agree.
  //
  // They agree by luck, and the luck runs out in the case that matters — `n=$(seq 1 1500000 | wc -c)`
  // captured `0` with status 0, because the overflowing stage produced nothing and `wc` counted an
  // empty input honestly. A plausible number with the reason on a stream no script reads is the
  // wrong-answer shape this repository keeps removing. bash never faces it, since it forks every
  // stage and the kernel holds the pipe, so following its rule here is following it past where it
  // was defined.
  //
  // The cost, stated rather than hidden: a refused stage ends the pipeline, so `nosuchcmd`'s "command
  // not found" is not printed and the status is 1 rather than 127. What a person sees instead is the
  // shell saying it could not hold the output — which is the true reason their pipeline did not run.
  const status = await sh("yes | nosuchcmd; echo after=$?");
  assertEquals(status.out.trim(), "after=1", status.out);
  assertEquals(
    status.err.includes("exceeded what this shell can hold"),
    true,
    `the reason should be the one a person can act on: ${status.err}`,
  );

  // And a pipeline the shell *can* run keeps bash's rule exactly: the last stage answers, even when
  // an earlier one failed on its own merits.
  const normal = await sh("nosuchcmd | wc -l; echo after=$?");
  assertEquals(normal.out.trim().split("\n").pop(), "after=0", normal.out);

  // What did *not* change: a pipeline that cannot stream but stays under the cap is unaffected, and
  // it is the case a cap set too low would break silently.
  const fine = await sh("seq 1 200000 | x=1 wc -l");
  assertEquals(fine.out.trim(), "200000", fine.err);
});

Deno.test("a pipeline runs its stages at once, so a consumer can end a producer", async () => {
  // The measurement issue 0038 was filed on: `seq 1 200000 | head -1` took 11.8 seconds, because
  // every stage ran to completion and handed its whole output to the next. Streaming makes it
  // 0.15 seconds — `head` closing its input is what stops `seq`.
  //
  // Bounded in time rather than compared against a stopwatch, because a shared machine makes any
  // exact figure a lie. Half a million lines is the discriminator: producing them all costs well
  // over thirty seconds, and not producing them costs nothing, so a fifteen-second bound tells the
  // two apart with room to spare even under load.
  const started = Date.now();
  const r = await sh("seq 1 500000 | head -1");
  const took = Date.now() - started;
  assertEquals(r.out, "1\n", r.err);
  assertEquals(
    took < 15_000,
    true,
    `${took} ms — a pipeline that gathers would still be producing lines`,
  );
});

Deno.test("...and every stage still gets its whole input, in order", async () => {
  // What streaming can break, and did: `readStdin` promises *all* of standard input, and a child's
  // input arrives over time. Served with one chunk, `seq 1 5 | sort -r` printed `1` — `sort` reads to
  // the end before sorting, and the end came after one line. Every stage below reads its input
  // whole, which is the shape that fails.
  const cases: [string, string][] = [
    ["seq 1 5 | sort -r", "5\n4\n3\n2\n1\n"],
    ["seq 1 5 | tac", "5\n4\n3\n2\n1\n"],
    ["seq 1 5 | sort -r | head -2", "5\n4\n"],
    ["seq 1 5 | wc -l", "5\n"],
    ["printf 'b\\na\\nb\\n' | sort | uniq", "a\nb\n"],
    ["seq 1 1000 | tail -1", "1000\n"],
    ["seq 1 100 | sort -n | tail -1", "100\n"],
  ];
  for (const [script, want] of cases) {
    const r = await sh(script);
    assertEquals(r.out, want, `${script}: ${r.err}`);
  }

  // And against bash, which is the only opinion that matters about what a pipeline means.
  for (const script of ["seq 1 20 | sort -r | head -3", "seq 1 50 | tac | tail -2"]) {
    const ours = await sh(script);
    const theirs = new Deno.Command("bash", {
      args: ["-c", script],
      cwd: dir,
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    assertEquals(ours.out, new TextDecoder().decode(theirs.stdout), script);
  }
});

Deno.test("a spawned command is handed the shell's own standard input, not a copy", async () => {
  // `cat; cat` prints the input once between the two, because both children read the *same* stream and
  // the second finds what the first left. This shell printed it twice until issue 0042: a shell hands
  // each command what is left of the input and cannot know how much a program read — with an inherited
  // descriptor it does not have to, which is how every real shell answers this.
  const twice = await sh("cat; cat", "once\ntwice\n");
  assertEquals(twice.out, "once\ntwice\n", twice.err);

  const theirs = new Deno.Command("bash", {
    args: ["-c", "cat; cat"],
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const w = theirs.stdin.getWriter();
  await w.write(new TextEncoder().encode("once\ntwice\n"));
  await w.close();
  assertEquals(twice.out, new TextDecoder().decode((await theirs.output()).stdout), "and bash agrees");

  // A command that ignores its input leaves it for the next one, which is the other half of the same
  // claim and the reason "assume it read everything" is not a fix.
  const kept = await sh("seq 1 2; cat", "kept\n");
  assertEquals(kept.out, "1\n2\nkept\n", kept.err);

  // And `read` — a builtin, so it runs *in* the shell — still takes one line and leaves the rest,
  // whether the next command is spawned or not.
  const mixed = await sh('read x; echo "[$x]"; cat', "one\ntwo\n");
  assertEquals(mixed.out, "[one]\ntwo\n", mixed.err);
});

Deno.test("...and an inherited input streams rather than being read into memory first", async () => {
  // The other thing an inherited descriptor buys. Feeding a child means having the bytes first, so this
  // used to read *all* of standard input before `head` saw any of it — unbounded for a pipe that never
  // ends. `yes` writes for ever; `head -1` takes one line and the pipeline ends.
  // GNU `yes` as the producer, plumbed by bash: an endless standard input is the whole test, and
  // `Deno.Command` cannot supply one without something on the other end of the pipe.
  const started = Date.now();
  const r = new Deno.Command("bash", {
    args: ["-c", `yes | "$0" -c 'head -1'`, shell],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  const took = Date.now() - started;
  const out = new TextDecoder().decode(r.stdout);
  assertEquals(out, "y\n", new TextDecoder().decode(r.stderr));
  assertEquals(took < 15_000, true, `${took} ms — reading all of an endless input would never finish`);
});

Deno.test("a spawned command gets what the shell has left of its input, not the process's — 0066", async () => {
  // The bug: a here-document on an *enclosing compound* filled the shell's input without touching the
  // flag that says "the process's stream has been drained", so `mayInherit` said yes and the child was
  // handed a descriptor that had never held those bytes. It read the process's empty input and reported
  // success. Called in process the same script is right, which is why only a *spawning* shell shows it —
  // and `packages/sh`'s own twelve are called, so this is the shell that can.
  //
  // bash is the oracle for every case, including the two that must keep inheriting.
  const cases: [string, string][] = [
    ["a here-document into a compound, after a read",
      "{ read a; cat; } <<EOF\none\ntwo\nthree\nEOF"],
    ["a here-document into a compound", "{ cat; } <<EOF\nheld\nEOF"],
    ["a here-document into the command itself", "cat <<EOF\nonly\nEOF"],
    ["a pipeline into a compound, after a read", `printf 'a\nb\nc\n' | { read x; cat; }`],
    ["a redirection into a compound, after a read",
      `printf 'p\nq\n' > in.txt; { read a; cat; } < in.txt`],
    ["an empty here-document gives the child nothing, rather than the terminal",
      "{ cat; } <<EOF\nEOF"],
  ];
  for (const [what, script] of cases) {
    const ours = await sh(script);
    const theirs = new Deno.Command("bash", {
      args: ["-c", script],
      cwd: dir,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
      clearEnv: true,
    }).outputSync();
    assertEquals(ours.out, new TextDecoder().decode(theirs.stdout), `${what}: ${script}`);
  }

  // And the inheriting cases still inherit, which is the property the flag must not break: a child
  // reading the *real* stream sees what a previous child left, because it is one descriptor and not a
  // copy. Issue 0042.
  const shared = await sh("cat; cat", "one\ntwo\n");
  assertEquals(shared.out, "one\ntwo\n", shared.err);
  const piped = await sh("cat", "through\n");
  assertEquals(piped.out, "through\n", piped.err);
});
