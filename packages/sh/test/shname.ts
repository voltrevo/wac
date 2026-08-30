// What this shell says on standard error, against what bash says — the shared half.
//
// `sameName` and `KNOWN` are the two things that are not a *tool*: one small rule about naming and
// one table of measured differences. They live here rather than in `tools/corpusStderr.ts` because
// three tests want them and only one of those is that tool — `packages/sh/test/stderr.test.ts`,
// `packages/sh/test/differential.test.ts` and `packages/box/test/jobs.test.ts`.
//
// **Split out on 2026-08-30 so the tool can move to wac.** `issues/system/0289b` records the knot:
// the tool could not be ported while three TypeScript tests imported from it, which reads as 1,474
// lines that have to move together. They do not — this file is the five lines and the table that
// three of them actually wanted, and the tool is now free to go on its own.
//
// Nothing here changed in the move; `git log -p` on the lines below starts in `tools/corpusStderr.ts`.

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

/** bash naming itself and the line, mapped to our own name — see the note at the top. */
export function sameName(text: string): string {
  // `\S*bash` because bash names itself by however it was invoked: `bash:` from a bare name and
  // `/usr/bin/bash:` from a path, which is what `packages/box/test/jobs.test.ts` gets and what the
  // first version of this missed.
  return text.replace(/^(?:\S*bash|environment)(?:: -c)?: line \d+: /gm, "sh: ");
}
