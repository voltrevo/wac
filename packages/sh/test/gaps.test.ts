// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
// What this shell says about the things it does not do.
//
// A gap has three possible answers and they are not equally good. Doing something plausible anyway is
// the worst — `tr -d 12` translating, `wc -m` counting bytes, `grep -E 'a|b'` searching for the literal
// — because it is a wrong answer nothing can see. Refusing is better. Saying *which side is incomplete*
// is better still, and that is the only one of the three that tells the truth: a caller who writes
// `wc -m` has written a real flag, and answering "invalid option" says their command is wrong when this
// program is merely unfinished.
//
// So this file asserts the property rather than the wording: **no option that GNU has is ever called
// invalid.** The letters come from the installed tools' own `--help`, so the table in `program.wac`
// cannot drift away from the coreutils on this machine without something failing.
//
// ## One process, not one per option
//
// This used to spawn the built shell once per option — about 135 of them — and take 17 to 31
// seconds, which is most of what `packages/sh` costs. The oracle is not what was expensive: a
// `--help` costs 2.5ms and there are nine of them, while starting our own binary costs **167ms**,
// because it is a 400 KB bundle that instantiates a wasm module every time.
//
// So the cases run as one script, and the assertion is read off the combined standard error: if the
// word "invalid option" is absent, every option was accepted and there is nothing to attribute. A
// trailing sentinel proves the batch reached the end rather than dying somewhere in the middle.
//
// When the fast path *does* find something, it says which option only after re-running them
// singly — which is the one case where 135 spawns are worth it, and is not the case that runs on
// every commit.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/** The short options a real tool documents, from its own help text. */
async function gnuOptions(tool: string): Promise<string[]> {
  const r = await new Deno.Command(tool, { args: ["--help"], stdout: "piped", stderr: "piped" })
    .output().catch(() => null);
  if (r === null || !r.success) return [];
  const help = new TextDecoder().decode(r.stdout);
  const letters = new Set<string>();
  // Both spellings on a line: GNU documents `-r, -R, --recursive` and `-c, -C, --complement`, and an
  // anchor at the start of the line sees only the first — so this swept neither `rm -R` nor `tr -C`
  // while claiming to sweep every option GNU has. Found from the other end, in wac-mono 0105, where the
  // same omission put three real flags in the table that decides who gets blamed.
  for (const m of help.matchAll(/(?:^\s+|,\s*)-([a-zA-Z])(?=[,\s=[]|$)/gm)) letters.add(m[1]);
  return [...letters];
}

Deno.test("a long option is one word, not a bundle of short ones", async () => {
  const { buildApp } = await import("../../platform/build.ts");
  const built = await Deno.makeTempFile({ prefix: "wacsh-long-" });
  try {
    await buildApp("packages/sh/src/sh.wac", built, { read: true, write: true, env: true });
    const err = (script: string) => {
      const r = new Deno.Command(built, {
        args: ["-c", script],
        stdout: "null",
        stderr: "piped",
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
        clearEnv: true,
      }).outputSync();
      return new TextDecoder().decode(r.stderr).trim();
    };

    // Read as a bundle, the first letter this could not implement was the *second dash*, so the refusal
    // named a character the caller never typed: `ls: invalid option -- '-'`.
    //
    // **One scanner is left here**, and it is `ls` in `exec.wac`. The others — `options`, `head`'s
    // counter, `tr`'s loop — went with the programs they belonged to (wac-mono 0103), and
    // `packages/box/test/flags.test.ts` asks the same question of the applets that replaced them.
    assertEquals(err("ls --all"), "ls: long options are not implemented: --all");
    assertEquals(err("ls --sort=size"), "ls: long options are not implemented: --sort=size");
    // `echo` is not a getopt program: GNU's prints `--nonsense` and says nothing.
    assertEquals(err("echo --nonsense"), "");
    // And a name this shell does not have at all is 127 rather than an option complaint, which is the
    // difference the deletion made: `wc --lines` used to reach a scanner here.
    // `sh: ` because bash prefixes what the *shell* says, and "command not found" is the shell
    // speaking rather than `wc` — see `speaksAsTheShell` in `exec.wac`.
    assertEquals(err("wc --lines"), "sh: wc: command not found");
  } finally {
    await Deno.remove(built);
  }
});

Deno.test({
  name: "no option that GNU has is called invalid — a gap says it is a gap",
  fn: async () => {
    const { buildApp } = await import("../../platform/build.ts");
    const built = await Deno.makeTempFile({ prefix: "wacsh-gaps-" });
    try {
      await buildApp("packages/sh/src/sh.wac", built, { read: true, write: true, env: true });

      // **One tool, and it is a builtin.** This list was eight of the twelve programs this package
      // carried; they are deleted (wac-mono 0103) and `packages/box/test/flags.test.ts` asks the same
      // question of the applets that replaced them, over more tools than were ever here.
      //
      // Leaving them in the list would have been worse than useless: this shell answers 127 for a name
      // it does not have, 127 says nothing about options, and the sweep would have gone green while
      // checking nothing at all.
      //
      // `ls` stays because it is a *builtin* rather than a program — a shell needs `ls` before it needs
      // a toolbox — and it was the one place where an option was read as a filename: `ls -l` said
      // "cannot access '-l': No such file or directory", blaming the caller for a real flag.
      const tools = ["ls"];
      const cases: { tool: string; letter: string; script: string }[] = [];
      for (const tool of tools) {
        for (const letter of await gnuOptions(tool)) {
          // The pattern for `grep` and the sets for `tr` are there so a *working* flag is exercised
          // rather than a usage error.
          cases.push({
            tool,
            letter,
            script: tool === "grep"
              ? `echo x | grep -${letter} x`
              : tool === "tr"
              ? `echo x | tr -${letter} a b`
              : `echo x | ${tool} -${letter}`,
          });
        }
      }
      // If the tool were missing this test would pass while checking nothing. `ls` alone has about
      // forty options, so this is still a real floor rather than a nominal one.
      assertEquals(cases.length > 25, true, `only ${cases.length} options found — are the coreutils installed?`);

      const shell = (script: string) => {
        const r = new Deno.Command(built, {
          args: ["-c", script],
          stdout: "piped",
          stderr: "piped",
          env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
          clearEnv: true,
        }).outputSync();
        const dec = new TextDecoder();
        return { out: dec.decode(r.stdout), err: dec.decode(r.stderr) };
      };

      // ── The fast path: every case in one process ────────────────────────────
      const SENTINEL = "__gaps_reached_the_end__";
      const batch = shell([...cases.map((c) => c.script), `echo ${SENTINEL}`].join("; "));
      const finished = batch.out.includes(SENTINEL);
      const complained = batch.err.includes("invalid option");
      if (finished && !complained) return;

      // ── The slow path: only now is it worth 135 processes ───────────────────
      const blamed: string[] = [];
      for (const c of cases) {
        const r = shell(c.script);
        if (r.err.includes("invalid option")) {
          blamed.push(`${c.script}: GNU's ${c.tool} has -${c.letter}, and this called it invalid:\n    ${r.err.trim().split("\n")[0]}`);
        }
      }

      if (blamed.length > 0) {
        throw new Error(`${blamed.length} of ${cases.length} options were called invalid:\n  ${blamed.join("\n  ")}`);
      }
      // Nothing to blame, so the batch itself is what went wrong: it stopped early, and the cases
      // after that point were never run. Saying so beats passing on a partial sweep.
      throw new Error(
        finished
          ? `the batch said "invalid option" but no single case does — the batching is wrong, not the shell:\n${batch.err.trim()}`
          : `the batch stopped before the end, so it checked fewer than ${cases.length} options.\n` +
            `  stderr: ${batch.err.trim().split("\n").slice(0, 3).join("\n  ")}`,
      );
    } finally {
      await Deno.remove(built);
    }
  },
});

/**
 * The redirections this shell does not perform, and what it does with the command anyway.
 *
 * The same three answers as above, and the same ranking — except here the worst one had actually been
 * chosen twice, in opposite directions:
 *
 *   - `2>&1` was a **syntax error**, which says the caller wrote something invalid. They did not: the
 *     lexer made it three tokens and the redirection parser refused a target that was not a word.
 *   - `echo hi 2>/dev/null` printed the refusal, **swallowed `hi`, and exited 0** — `writeTo` answered
 *     true for a descriptor it cannot write, so both callers believed the output had gone to a file.
 *     A command that did not run and reported success is the one outcome worse than either.
 */
Deno.test({
  name: "the descriptor forms work, and the ones that cannot are named",
  fn: async () => {
    const { buildApp } = await import("../../platform/build.ts");
    const built = await Deno.makeTempFile({ prefix: "wacsh-redir-" });
    try {
      await buildApp("packages/sh/src/sh.wac", built, { read: true, write: true, env: true });
      const run = async (script: string) => {
        const r = await new Deno.Command(built, {
          args: ["-c", script],
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
        }).output();
        const d = new TextDecoder();
        return { out: d.decode(r.stdout), err: d.decode(r.stderr), code: r.code };
      };

      // **These used to be the refusals this test existed for.** `2>&1` was a syntax error, then a
      // named gap; `2>` said "redirecting fd 2 is not implemented". They are a two-entry descriptor
      // table now (2026-08-08), and what this asserts is the routing rather than the wording — the
      // corpus compares the bytes against bash.
      const merged = await run("echo hi 1>&2");
      assertEquals(merged.out, "", "1>&2 leaves nothing on standard output");
      assertEquals(merged.err, "hi\n", "…and puts it on standard error");

      const dropped = await run("ls /nosuchfile 2>/dev/null; echo st=$?");
      assertEquals(dropped.err, "", "2>/dev/null takes the complaint");
      assertEquals(dropped.out, "st=2\n", "…and leaves the status alone");

      const both = await run("echo out 2>&1");
      assertEquals(both.out, "out\n", "2>&1 with nothing on the error stream changes nothing");

      // **What is still refused, and named rather than called a syntax error.** There is no `exec 3>`
      // in this shell, so a descriptor above 2 has nowhere to come from, and closing standard output is
      // refused because bash reports a per-command write error rather than dropping the output.
      //
      // `1>&3` is bash's answer too — `3: Bad file descriptor` — but `3>&1` is *not*: bash makes a
      // third descriptor there and carries on, because it has descriptors to make. This refuses it,
      // which is a real divergence and the honest one: a shell that cannot create the descriptor should
      // not pretend the redirection happened.
      // **A name that exists and cannot be run *that way*.** `&` starts a separate instance of this
      // program with the command as its arguments, so it can only run what the build has as a
      // *program* — and this build has none, being `packages/sh` alone. Both of these used to reach
      // the spawn and come back as `No such file or directory`, which says the caller typed a name
      // that is not there when it is a builtin of this very shell. wac-mono 0135, which is open: the
      // gap is that they cannot be backgrounded at all, and this is only the sentence about it.
      for (const [script, want] of [
        ["echo hi 1>&3", "3: Bad file descriptor"],
        ["echo hi 3>&1", "3: Bad file descriptor"],
        ["echo hi 1>&-", "closing standard output is not implemented"],
        ["echo hi 3>f", "redirecting fd 3 is not implemented"],
        ["echo hi & wait", "a builtin cannot be backgrounded"],
        ["jobs & wait", "a builtin cannot be backgrounded"],
        ["f() { echo fn; }; f & wait", "a shell function cannot be backgrounded"],
      ]) {
        const got = await run(script);
        assertEquals(got.err.includes(want), true, `${script} should say ${want}: ${JSON.stringify(got.err)}`);
        assertEquals(got.err.includes("syntax error"), false, `${script} is not a syntax error`);
        assertEquals(
          got.err.includes("No such file or directory"), false,
          `${script} must not blame the caller for a name this shell has: ${JSON.stringify(got.err)}`,
        );
      }
    } finally {
      await Deno.remove(built);
    }
  },
});

// **Arithmetic assignment and increment: a gap that read as the caller's mistake, and one that read as
// nothing at all.**
//
// The caller substitutes variables before the evaluator sees the expression — that split is what makes
// `a=b; b=c; c=7; echo $((a))` answer 7 — so `$((x++))` arrives as `5++` and `$((x=7))` as `5=7`, and
// both came back as *syntax errors*: this shell telling a caller their bash is malformed when it is
// this shell that is unfinished. `$((++x))` was worse: `++5` parses as two unary pluses, so it answered
// **5** where bash answers 6, having incremented nothing and said nothing.
//
// The forms are recognised before substitution now, and refused by name. The half that must keep
// working is the reason the check looks at the *name* beside the operator rather than the operator:
// `5--3` is `5 - (-3)` and answers 8 in both shells.
Deno.test("arithmetic increment and assignment are refused by name, not called syntax errors", async () => {
  const { buildApp } = await import("../../platform/build.ts");
  const built = await Deno.makeTempFile({ prefix: "wacsh-arith-" });
  try {
    await buildApp("packages/sh/src/sh.wac", built, { read: true, write: true, env: true });
    const run = (script: string) => {
      const r = new Deno.Command(built, {
        args: ["-c", script],
        stdout: "piped",
        stderr: "piped",
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
        clearEnv: true,
      }).outputSync();
      const dec = new TextDecoder();
      return { out: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim() };
    };

    for (const script of ["x=5; echo $((x++))", "x=5; echo $((++x))", "x=5; echo $((x=7))",
                          "x=5; echo $((x+=2))", "x=5; echo $((x--))"]) {
      const { out, err } = run(script);
      if (!err.includes("is not implemented")) {
        throw new Error(`${script}: expected a refusal naming the gap, got ${JSON.stringify(err)}`);
      }
      if (err.includes("syntax error")) {
        throw new Error(`${script}: called the caller's expression malformed: ${JSON.stringify(err)}`);
      }
      if (out !== "") throw new Error(`${script}: answered ${JSON.stringify(out)} as well`);
    }

    // The cases that are not increments, and must not become refusals: a subtracted negative, and the
    // comparisons whose spelling contains `=`.
    for (const [script, want] of [["echo $((5--3))", "8"], ["echo $((7 - -3))", "10"],
                                  ["echo $((1==1))", "1"], ["echo $((2!=1))", "1"],
                                  ["x=3; echo $((x<=3))", "1"], ["x=3; echo $((x>=4))", "0"]]) {
      const { out, err } = run(script);
      if (out !== want) throw new Error(`${script}: got ${JSON.stringify(out)} want ${want} (${err})`);
    }
  } finally {
    await Deno.remove(built);
  }
});

