// Our standard error against bash's, for the whole shell corpus.
//
//   deno task corpus:stderr [--from N] [--count N]
//
// **Nothing compared standard error until this existed.** `packages/sh/test/differential.test.ts`
// runs every corpus script through bash and through this shell and asserts stdout and the exit
// status — with `stderr: "null"`, so the messages were never even captured. `packages/box`'s half
// captures them and uses them only to decorate a failure. So a repository that measures GNU's exact
// wording tool by tool (`cannotOpen` has five sentences, each read off the tool it belongs to) had no
// differential over the thing those sentences are.
//
// Measured, the first time it ran: 735 of 821 scripts print nothing on either side, 28 matched, and
// **58 differed**. After the shell learned to name itself and its arithmetic learned to name the token
// it stopped at, 67 match and 19 differ. Forty of those were one fact — a builtin's diagnostic did not name the shell, so
// this said `[: too many arguments` where bash says `bash: line 1: [: too many arguments`. That is
// fixed (`prefixed` in `packages/sh/src/exec.wac`), and what is left is below.
//
// ## The one thing normalised, and why only that
//
// bash names itself and the line: `bash: line 1: `, `bash: -c: line 1: `, and `environment: line 1: `
// inside a function it was given on the command line. We are not bash and our name is `sh`, so that
// prefix is mapped to `sh: ` rather than stripped — mapped, because stripping would hide a diagnostic
// where *we* forgot to name ourselves, which is exactly the bug this found.
//
// Nothing else is normalised. Every remaining difference is a real one and is pinned below with the
// reason, so a *new* divergence fails and a *fixed* one fails too — a pin that has gone stale is a
// thing somebody should delete, not a thing to leave passing.

import { CORPUS } from "../packages/sh/test/corpus.ts";
import { announceHeavy } from "./suiteGate.ts";

// Announced so `tools/suiteGate.ts` can see this from another agent's suite: this builds
// programs and runs them, and nothing else made it visible. issues/system 0142.
const doneHeavy = announceHeavy("corpus:stderr");
globalThis.addEventListener("unload", () => doneHeavy());
import { buildApp } from "../packages/platform/build.ts";
import "../harness/spawnRetry.ts";

/**
 * Where our standard error still differs from bash's, exactly, with the reason.
 *
 * Generated from a run rather than typed: a table of remembered output is worse than none, and this
 * one was measured against the installed bash on 2026-08-09.
 */
export const KNOWN: { script: string; bash: string; ours: string }[] = [
  { script: "seq 1 0 3; echo status=$?", bash: "seq: invalid Zero increment value: '0'\nTry 'seq --help' for more information.", ours: "seq: step must not be zero" },
  { script: "printf 'x\\n' | grep '[' ; echo status=$?", bash: "grep: Invalid regular expression", ours: "grep: Unmatched [, [^, [:, [., or [=" },
  { script: "echo $((a b))", bash: "sh: a b: syntax error in expression (error token is \"b\")", ours: "sh: a b: syntax error in expression (error token is \"0\")" },
  { script: "x=abc; echo [${x!}]; echo after", bash: "sh: [${x!}]: bad substitution", ours: "sh: ${x!}: bad substitution" },
  { script: "x=abc; echo [${x:}]; echo after", bash: "sh: [${x:}]: bad substitution", ours: "sh: ${x:}: bad substitution" },
  { script: "printf", bash: "printf: usage: printf [-v var] format [arguments]", ours: "printf: usage: printf format [arguments]" },
  { script: "printf \"\\xZ\\n\"", bash: "sh: printf: missing hex digit for \\x", ours: "" },
  { script: "printf \"%z\\n\" x", bash: "sh: printf: `\\': invalid format character", ours: "sh: printf: `%z': invalid format character" },
  { script: "printf \"ab%z\\n\" x", bash: "sh: printf: `\\': invalid format character", ours: "sh: printf: `%z': invalid format character" },
  { script: "printf \"%s%z\" a b", bash: "sh: printf: `%z': missing format character", ours: "sh: printf: `%z': invalid format character" },
  { script: "echo `", bash: "sh: unexpected EOF while looking for matching ``'", ours: "sh: unexpected token" },
  { script: "cat <<EOF", bash: "sh: warning: here-document at line 1 delimited by end-of-file (wanted `EOF')", ours: "" },
  { script: "cat <<EOF\nno terminator", bash: "sh: warning: here-document at line 1 delimited by end-of-file (wanted `EOF')", ours: "" },
  { script: "return 4; echo after=$?", bash: "sh: return: can only `return' from a function or sourced script", ours: "return: can only `return' from a function or sourced script" },
  { script: "[ ( -f /etc/passwd ) ]; echo $?", bash: "sh: syntax error near unexpected token `-f'\nsh: `[ ( -f /etc/passwd ) ]; echo $?'", ours: "sh: unexpected token" },
  { script: "[ ( -f /nosuch -o -f /etc/passwd ) -a -d /etc ]; echo $?", bash: "sh: syntax error near unexpected token `-f'\nsh: `[ ( -f /nosuch -o -f /etc/passwd ) -a -d /etc ]; echo $?'", ours: "sh: unexpected token" },
  { script: "[ ! ( -f /etc/passwd ) ]; echo $?", bash: "sh: syntax error near unexpected token `('\nsh: `[ ! ( -f /etc/passwd ) ]; echo $?'", ours: "sh: unexpected token" },
  { script: "[ ( ( -f /etc/passwd ) ) ]; echo $?", bash: "sh: syntax error near unexpected token `('\nsh: `[ ( ( -f /etc/passwd ) ) ]; echo $?'", ours: "sh: unexpected token" },
  { script: "[ ( -n x ) -a ( -z \"\" ) ]; echo $?", bash: "sh: syntax error near unexpected token `-n'\nsh: `[ ( -n x ) -a ( -z \"\" ) ]; echo $?'", ours: "sh: unexpected token" },
];

/**
 * Why each of the above differs, by group. Kept as prose rather than a field per row because the
 * twenty-seven are seven reasons, and a reason repeated twenty times is a reason nobody reads.
 *
 *   **`$((a b))`, `$((a b c))`** — the last of the arithmetic rows, and the reason is structural.
 *   bash evaluates names inline and names the offending token from the text as written; this shell
 *   substitutes every name *before* evaluating — which is what reproduces `x=1+2; echo $((x))` being
 *   3 — so by the time the parser fails, `a b c` is `0 0 0` and the offset it reports points into the
 *   substituted text. bash says `b c` and this says `0 0`. Closing it means moving substitution into
 *   the evaluator, which is a design change rather than a message fix.
 *
 *   The other seven arithmetic rows are **gone**: the token bash names is now named
 *   (`Arith.tokenAt`), the wording is bash's, and `a=b; b=a` blames `b` as bash does, by detecting
 *   the cycle rather than counting rounds.
 *
 *   **`${x!}` and `${x:}`** — bash quotes the whole word including what surrounds it,
 *   `[${x!}]: bad substitution`; we quote the expansion alone.
 *
 *   **`[ ( … ) ]`** — bash refuses these at *parse* time with two lines naming the token and echoing
 *   the line; ours is one line from the `[` builtin. Five rows, and the shape of the difference is
 *   the parser's rather than the message's.
 *
 *   **`seq`, `grep`, `printf`** — three applets whose wording is their own: `seq`'s zero increment,
 *   `grep`'s regex complaint, and `printf`'s usage line, which lacks `[-v var]` because `-v` is not
 *   implemented. `printf "\xZ"` prints nothing where bash warns about the missing hex digit — the
 *   only row here where we are *silent* and bash is not.
 *
 *   **`echo \``, `cat <<EOF`** — unterminated input, where bash says what it was looking for and we
 *   say that something was unterminated.
 */

const args = Deno.args;
const flag = (name: string, fallback: number): number => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? Number(args[at + 1]) : fallback;
};

/** bash naming itself and the line, mapped to our own name — see the note at the top. */
export function sameName(text: string): string {
  // `\S*bash` because bash names itself by however it was invoked: `bash:` from a bare name and
  // `/usr/bin/bash:` from a path, which is what `packages/box/test/jobs.test.ts` gets and what the
  // first version of this missed.
  return text.replace(/^(?:\S*bash|environment)(?:: -c)?: line \d+: /gm, "sh: ");
}

if (import.meta.main) {
  const dir = await Deno.makeTempDir({ prefix: "corpus-stderr-" });
  const shell = `${dir}/wacsh`;
  await buildApp("packages/box/src/bin/sh.wac", shell, { read: true, write: true, env: true });

  const run = (cmd: string, script: string, cwd: string) => {
    const r = new Deno.Command("timeout", {
      args: ["10", cmd, "-c", script],
      cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      // **`C.UTF-8`, not `C`** — the locale this machine actually has, and the one every
      // applet is measured against. `box`'s `wc -w` counts by code point since issues/system 0143,
      // so pinned to `C` the real `wc` answers 1 where ours answers 2 for `a\xc2\xa0b`, and a corpus
      // script feeding non-ASCII to it would fail on the locale rather than on the shell. Measured
      // before moving: `tr`, `cut`, `fold`, `grep`, `head`, `sort` and `uniq` produce identical bytes
      // under both, bash's own `[[ =~ ]]`, `case` ranges and collation are identical too because
      // glibc's `C.UTF-8` orders by code point, and `box` has no `sed` — which is the one tool that
      // does differ. issues/system 0145.
      env: { LC_ALL: "C.UTF-8", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: cwd },
      clearEnv: true,
    }).outputSync();
    const d = new TextDecoder();
    // 124 is `timeout`'s, not a shell's — see `corpusThrough.ts`, which has kept them apart since it
    // was written. A bound that fired has no stderr to compare, so it is skipped rather than counted
    // as a difference in wording.
    return { err: d.decode(r.stderr), code: r.code, hung: r.code === 124 };
  };

  const from = flag("from", 0);
  const cases = CORPUS.slice(from, from + flag("count", CORPUS.length));
  const pinned = new Map(KNOWN.map((k) => [k.script, k]));
  let agree = 0;
  const hung: string[] = [];
  const fresh: string[] = [];
  const stale: string[] = [];

  for (let i = 0; i < cases.length; i++) {
    const script = cases[i];
    const a = `${dir}/a${i}`, b = `${dir}/b${i}`;
    Deno.mkdirSync(a, { recursive: true });
    Deno.mkdirSync(b, { recursive: true });
    const bashRan = run("bash", script, a);
    const oursRan = run(shell, script, b);
    const theirs = sameName(bashRan.err).trimEnd();
    const ours = oursRan.err.trimEnd();
    Deno.removeSync(a, { recursive: true });
    Deno.removeSync(b, { recursive: true });

    // A bound that fired has no sentence to compare — see `run`. Counted on its own so a loaded
    // machine reads as a loaded machine rather than as forty new wording differences.
    if (bashRan.hung || oursRan.hung) {
      hung.push(script);
      continue;
    }

    const known = pinned.get(script);
    if (theirs === ours) {
      agree++;
      if (known !== undefined) {
        stale.push(`${JSON.stringify(script)}\n  pinned as different; it now agrees — delete the row`);
      }
      continue;
    }
    if (known === undefined) {
      fresh.push(`${JSON.stringify(script)}\n  bash: ${JSON.stringify(theirs)}\n  ours: ${JSON.stringify(ours)}`);
      continue;
    }
    if (known.bash.trimEnd() !== theirs || known.ours.trimEnd() !== ours) {
      stale.push(
        `${JSON.stringify(script)}\n  pinned bash: ${JSON.stringify(known.bash)}\n  actual bash: ${JSON.stringify(theirs)}` +
          `\n  pinned ours: ${JSON.stringify(known.ours)}\n  actual ours: ${JSON.stringify(ours)}`,
      );
    }
  }

  await Deno.remove(dir, { recursive: true }).catch(() => {});
  console.log(`${agree} of ${cases.length - hung.length} scripts print the same on standard error as bash`);
  if (hung.length > 0) {
    console.log(`  ${hung.length} did not finish inside the bound and were not compared:`);
    for (const h of hung) console.log(`      ${JSON.stringify(h)}`);
  }
  for (const f of fresh) console.log(`new difference:\n${f}`);
  for (const s of stale) console.log(`stale pin:\n${s}`);
  if (fresh.length > 0 || stale.length > 0) Deno.exit(1);
}
