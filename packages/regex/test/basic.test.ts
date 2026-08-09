// POSIX **basic** regular expressions, judged against GNU grep.
//
// `src/basic.wac` translates basic to the engine's own dialect, and until this file the translation was
// only ever exercised through two callers — `packages/box`'s grep and `packages/sh`'s. A translation
// tested only through its users is tested for the cases its users happen to reach; the package that owns
// the syntax should be the one that knows whether it is right.
//
// The oracle is **`/bin/grep`, spelled out**. `grep` at an interactive prompt in this container is a
// shell function dispatching to ugrep, which differs from GNU on exactly these corners — it calls `*a` an
// error where GNU matches a literal asterisk. `Deno.Command` execs a binary and never sees a shell
// function, so this is safe either way, but the path is written down because the reason is not obvious.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/regex/test/probe.wac") as unknown as {
  execBasic(pattern: Uint8Array, input: Uint8Array, at: number): Int32Array;
  whyBasic(pattern: Uint8Array): string;
  whyExtended(pattern: Uint8Array): string;
  execExtended(pattern: Uint8Array, input: Uint8Array, at: number): Int32Array;
  basicAsExtended(pattern: Uint8Array): Uint8Array;
};

const enc = new TextEncoder();
const dec = new TextDecoder();
const b = (s: string) => enc.encode(s);

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/**
 * Whether GNU grep finds `pattern` in each of `lines`, in whichever dialect `flags` selects.
 *
 * **One grep for the whole batch, because the batch is what costs.** This asked grep once per
 * (pattern, line) and the four sweeps below are 26 patterns against every byte, 400 generated
 * patterns and two hand-written lists — around eighteen thousand processes for four thousand
 * questions about the same twenty-six patterns. A pattern is what grep compiles; the lines are what
 * it then reads, which is the shape a line-oriented tool already has.
 *
 * `-n` rather than `-c`: the count says how many lines matched and the question here is *which*, so
 * the numbers come back and the caller reads its own subjects out of them. A rejection is still a
 * property of the pattern, so exit 2 refuses the whole batch, which is what asking one at a time did.
 *
 * **A subject with a newline in it would silently misalign every answer after it**, since the
 * mapping is line number to index — so that is refused rather than trusted. None of the callers
 * below has one; the check is here so a later one cannot quietly acquire it.
 */
async function gnuMatchesAll(
  pattern: string,
  lines: string[],
  flags: string[] = [],
): Promise<(boolean | "rejected")[]> {
  for (const l of lines) {
    if (l.includes("\n")) throw new Error(`a batched subject contains a newline: ${JSON.stringify(l)}`);
  }
  const child = new Deno.Command("/bin/grep", {
    args: [...flags, "-n", "-e", pattern],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C" },
    clearEnv: true,
  }).spawn();
  // Started before the write, not after: grep answers as it reads, and a batch big enough to fill
  // the stdout pipe would park it there while this side was still writing stdin — both ends blocked
  // on each other. Draining concurrently is what makes the batch safe at any size.
  const outcome = child.output();
  const w = child.stdin.getWriter();
  try {
    await w.write(enc.encode(lines.map((l) => `${l}\n`).join("")));
    await w.close();
  } catch {
    // grep exited before reading, which a bad pattern does.
  }
  const r = await outcome;
  if (r.code === 2) return lines.map(() => "rejected" as const);
  const hit = new Set<number>();
  for (const out of dec.decode(r.stdout).split("\n")) {
    const colon = out.indexOf(":");
    if (colon > 0) hit.add(Number(out.slice(0, colon)));
  }
  return lines.map((_, i) => hit.has(i + 1));
}

function ours(pattern: string, line: string): boolean | "rejected" {
  const out = mod.execBasic(b(pattern), b(line), 0);
  if (out[0] === -1) return "rejected";
  if (out[0] === -2) throw new Error(`budget exhausted on ${JSON.stringify(pattern)}`);
  return out[0] === 1;
}

/** The two dialects, which differ in their operators and agree about everything inside a bracket. */
const DIALECTS: { flags: string[]; run: (p: string, l: string) => boolean | "rejected" }[] = [];

function oursExtended(pattern: string, line: string): boolean | "rejected" {
  const out = mod.execExtended(b(pattern), b(line), 0);
  if (out[0] === -1) return "rejected";
  if (out[0] === -2) throw new Error(`budget exhausted on ${JSON.stringify(pattern)}`);
  return out[0] === 1;
}

Deno.test("basic patterns mean what GNU grep says they mean", async () => {
  // The six characters whose spelling is inverted between the dialects, each written both ways, plus the
  // rules that are not about them: `*` with nothing to repeat, bracket expressions, and the anchors.
  const patterns = [
    "a|b", "a\\|b", "a+", "a\\+", "a?", "a\\?", "a{2}", "a\\{2\\}",
    "(a)", "\\(a\\)", "\\(ab\\)*", "a*", "*a", "^*a", "\\(*a\\)",
    "a.b", "a\\.b", "^ab", "ab$", "^ab$", "[ab]", "[|]", "[+?{}()]", "[^ab]",
    "[]a]", "[^]a]", "a\\{2,3\\}", "\\(a\\|b\\)c", "x\\|", "\\(\\)",
    "a\\\\b", "\\.", "\\*", "^", "$", "", "ab*c", "a\\|b\\|c",
  ];
  const subjects = [
    "", "a", "b", "ab", "abc", "a|b", "a+b", "a?b", "a{2}", "aa", "aab",
    "(a)", "*a", "a.b", "axb", "a\\b", "abab", "ac", "bc", "]a", "aaa",
  ];
  let checked = 0;
  for (const p of patterns) {
    const wants = await gnuMatchesAll(p, subjects);
    for (const [i, s] of subjects.entries()) {
      const want = wants[i];
      const got = ours(p, s);
      assertEquals(
        got,
        want,
        `basic ${JSON.stringify(p)} against ${JSON.stringify(s)} ` +
          `— translated to ${JSON.stringify(dec.decode(mod.basicAsExtended(b(p))))}`,
      );
      checked++;
    }
  }
  // Said rather than assumed: a loop that silently checked nothing would pass.
  assertEquals(checked > 700, true, `only ${checked} pairs were compared`);
});

Deno.test("generated basic patterns mean what GNU grep says they mean", async () => {
  // The list above is hand-picked, which means it covers what I thought of. This builds patterns from the
  // pieces instead — every one of the inverted six in both spellings, in every position — and is the part
  // that would catch a translation rule I got right in one context and wrong in another.
  const atoms = ["a", "b", ".", "[ab]", "\\.", "\\(a\\)", "(", ")", "|", "\\|", "+", "\\+", "?", "\\?"];
  const tails = ["", "*", "\\{2\\}", "{2}", "\\?", "?"];
  let checked = 0;
  let s = 12345;
  const next = (n: number) => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return (s >>> 8) % n;
  };
  for (let i = 0; i < 400; i++) {
    const p = atoms[next(atoms.length)] + tails[next(tails.length)] +
      (next(2) === 0 ? atoms[next(atoms.length)] : "");
    const gen = ["", "a", "ab", "a|b", "a+b", "aab", "(a)", "a?b", "a.b"];
    const wants = await gnuMatchesAll(p, gen);
    for (const [i, subject] of gen.entries()) {
      const want = wants[i];
      const got = ours(p, subject);
      assertEquals(
        got,
        want,
        `basic ${JSON.stringify(p)} against ${JSON.stringify(subject)} ` +
          `— translated to ${JSON.stringify(dec.decode(mod.basicAsExtended(b(p))))}`,
      );
      checked++;
    }
  }
  assertEquals(checked > 3000, true, `only ${checked} pairs were compared`);
});

/**
 * Bracket expressions, which are POSIX's in both dialects and **not** this engine's.
 *
 * `[[:digit:]]` was a set of the six characters `[ : d i g t` followed by a required `]`, so
 * `grep '[[:digit:]]'` matched nothing at all and said nothing — a caller who greps for digits and gets
 * no lines concludes there are none. `[]a]` was the empty class for the same reason.
 *
 * Every byte, because a class is a claim about all of them and the twelve names were typed by hand:
 * `[:punct:]` is the one nobody can check by reading.
 */
DIALECTS.push({ flags: [], run: ours }, { flags: ["-E"], run: oursExtended });

Deno.test("bracket expressions mean what GNU grep says they mean, byte by byte", async () => {
  const patterns = [
    "[[:alpha:]]", "[[:alnum:]]", "[[:digit:]]", "[[:upper:]]", "[[:lower:]]", "[[:space:]]",
    "[[:blank:]]", "[[:cntrl:]]", "[[:print:]]", "[[:graph:]]", "[[:punct:]]", "[[:xdigit:]]",
    "[^[:digit:]]", "[[:alpha:][:digit:]]", "[[:digit:]abc]", "[a-c[:space:]]",
    "[]a]", "[^]a]", "[]]", "[a-]", "[-a]", "[.a.]", "[=a=]", "[[:foo:]]", "[[:alpha:]", "[a",
  ];
  // One byte per subject, every byte a line can hold. NUL cannot reach `grep` through argv or a line
  // here, and LF is the line terminator itself.
  // Every byte a line can hold, as one batch per (pattern, dialect). NUL cannot reach `grep` through
  // a line here, and LF is the line terminator itself.
  const bytes: number[] = [];
  for (let byte = 1; byte <= 255; byte++) {
    if (byte !== 10) bytes.push(byte);
  }
  const lines = bytes.map((byte) => String.fromCharCode(byte));
  let checked = 0;
  for (const pattern of patterns) {
    for (const { flags, run } of DIALECTS) {
      const wants = await gnuMatchesAll(pattern, lines, flags);
      for (const [i, line] of lines.entries()) {
        const got = run(pattern, line);
        assertEquals(
          got,
          wants[i],
          `grep ${flags.join(" ")} ${JSON.stringify(pattern)} against byte ${bytes[i]}`,
        );
        checked++;
      }
    }
  }
  assertEquals(checked > 10000, true, `only ${checked} pairs were compared`);
});

/**
 * The anchors GNU spells with a backslash, which were passing through as literals.
 *
 * `\<` and `\>` are word edges and `` \` `` and `\'` are the buffer's, which in a line-oriented grep
 * are the line's. Unknown escapes were the character itself, so `grep '\<a'` searched for a `<`, found
 * none, and reported no lines — the same silence as the brackets above, in a different syntax.
 */
Deno.test("GNU's backslash anchors are anchors, in both dialects", async () => {
  const patterns = ["\\<a", "a\\>", "\\<abc\\>", "\\`a", "a\\'", "\\`abc\\'", "\\<", "\\>", "x\\<y"];
  const subjects = [
    "a", "ab", "ba", "abc", "a b", "b a", "-a-", "a-b", "_a", "a_", "1a", "a1", "", "aa",
    "abc def", "def abc", "x<y", "x`y", "a'", "`a",
  ];
  let checked = 0;
  for (const pattern of patterns) {
    for (const { flags, run } of DIALECTS) {
      const wants = await gnuMatchesAll(pattern, subjects, flags as string[]);
      for (const [i, subject] of subjects.entries()) {
        const got = run(pattern, subject);
        assertEquals(got, wants[i], `grep ${(flags as string[]).join(" ")} ${JSON.stringify(pattern)} against ${JSON.stringify(subject)}`);
        checked++;
      }
    }
  }
  assertEquals(checked > 300, true, `only ${checked} pairs were compared`);
});

/**
 * What a refusal *says*, which is a separate question from whether it refuses.
 *
 * A refused pattern used to come back as "bad pattern", and `grep '\(ab\)\1'` is not a bad pattern —
 * GNU runs it. Telling a caller their pattern is wrong when the gap is this engine's sends them to fix
 * something already right, which is the failure `packages/box`'s flag refusals exist to avoid, one layer
 * down. So: where GNU refuses too, its words; where GNU accepts, a sentence that names *us*.
 */
Deno.test("a refusal says whose problem it is, in GNU's words where GNU has any", async () => {
  // Ours, and what GNU says on stderr for the same pattern — empty when GNU accepts it.
  const cases: { pattern: string; extended?: boolean; want: string }[] = [
    { pattern: "[z-a]", want: "Invalid range end" },
    { pattern: "[[:foo:]]", want: "Invalid character class name" },
    { pattern: "[[:alpha:]", want: "Unmatched [, [^, [:, [., or [=" },
    { pattern: "[a", want: "Unmatched [, [^, [:, [., or [=" },
    { pattern: "a\\", want: "Trailing backslash" },
    { pattern: "\\(a", want: "Unmatched ( or \\(" },
    { pattern: "a\\)", want: "Unmatched ) or \\)" },
    // The other kind: GNU compiles these and this engine cannot run them.
    { pattern: "\\(ab\\)\\1", want: "backreferences are not implemented" },
  ];

  for (const c of cases) {
    const got = c.extended ? mod.whyExtended(b(c.pattern)) : mod.whyBasic(b(c.pattern));
    assertEquals(got, c.want, `the reason for ${JSON.stringify(c.pattern)}`);

    // And the half that keeps this honest: where GNU refuses, it must be refusing for the same reason,
    // in the same words. A message copied from memory drifts from the tool it is copied from.
    const r = new Deno.Command("/bin/grep", {
      args: ["-e", c.pattern], stdin: "null", stdout: "null", stderr: "piped",
      env: { LC_ALL: "C" }, clearEnv: true,
    }).outputSync();
    const theirs = dec.decode(r.stderr).trim().replace(/^\/bin\/grep: /, "");
    if (theirs !== "") {
      assertEquals(got, theirs, `GNU's own sentence for ${JSON.stringify(c.pattern)}`);
    } else {
      // GNU had none, so this is a gap of ours and must say so rather than blame the pattern.
      assertEquals(got.includes("not implemented"), true, `${JSON.stringify(c.pattern)}: GNU accepts it, so the refusal must name us — got ${JSON.stringify(got)}`);
    }
  }
});
