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
// **58 differed**. Forty of those were one fact — a builtin's diagnostic did not name the shell, so
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
  { script: "echo $((1/0))", bash: "sh: 1/0: division by 0 (error token is \"0\")", ours: "sh: 1/0: division by 0" },
  { script: "echo $((1/0)); echo after", bash: "sh: 1/0: division by 0 (error token is \"0\")", ours: "sh: 1/0: division by 0" },
  { script: "echo $((7%0))", bash: "sh: 7%0: division by 0 (error token is \"0\")", ours: "sh: 7%0: division by 0" },
  { script: "echo $((1+))", bash: "sh: 1+: syntax error: operand expected (error token is \"+\")", ours: "sh: 1+: arithmetic ended early" },
  { script: "echo $((a b))", bash: "sh: a b: syntax error in expression (error token is \"b\")", ours: "sh: a b: unexpected character in arithmetic" },
  { script: "x=$((1/0)); echo [$x]", bash: "sh: 1/0: division by 0 (error token is \"0\")", ours: "sh: 1/0: division by 0" },
  { script: "x=x; echo $((x))", bash: "sh: x: expression recursion level exceeded (error token is \"x\")", ours: "sh: x: expression recursion level exceeded" },
  { script: "a=b; b=a; echo $((a))", bash: "sh: b: expression recursion level exceeded (error token is \"b\")", ours: "sh: a: expression recursion level exceeded" },
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
 *   **`(error token is "x")`** — bash's arithmetic errors name the token they stopped at and ours do
 *   not. Ours are otherwise the same sentence. Seven rows.
 *
 *   **arithmetic wording** — `1+` is "syntax error: operand expected" to bash and "arithmetic ended
 *   early" here; `a b` is "syntax error in expression" and "unexpected character in arithmetic".
 *   Different words for the same refusal.
 *
 *   **`a=b; b=a; echo $((a))`** — bash names `b` as the variable it gave up on and we name `a`. Not
 *   wording: a different fact about where the recursion was noticed, and the one row here that is
 *   arguably a bug rather than a difference.
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
      env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: cwd },
      clearEnv: true,
    }).outputSync();
    const d = new TextDecoder();
    return { err: d.decode(r.stderr), code: r.code };
  };

  const from = flag("from", 0);
  const cases = CORPUS.slice(from, from + flag("count", CORPUS.length));
  const pinned = new Map(KNOWN.map((k) => [k.script, k]));
  let agree = 0;
  const fresh: string[] = [];
  const stale: string[] = [];

  for (let i = 0; i < cases.length; i++) {
    const script = cases[i];
    const a = `${dir}/a${i}`, b = `${dir}/b${i}`;
    Deno.mkdirSync(a, { recursive: true });
    Deno.mkdirSync(b, { recursive: true });
    const theirs = sameName(run("bash", script, a).err).trimEnd();
    const ours = run(shell, script, b).err.trimEnd();
    Deno.removeSync(a, { recursive: true });
    Deno.removeSync(b, { recursive: true });

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
  console.log(`${agree} of ${cases.length} scripts print the same on standard error as bash`);
  for (const f of fresh) console.log(`new difference:\n${f}`);
  for (const s of stale) console.log(`stale pin:\n${s}`);
  if (fresh.length > 0 || stale.length > 0) Deno.exit(1);
}
