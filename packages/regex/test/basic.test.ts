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

/** Whether GNU grep, reading basic regular expressions, finds `pattern` in `line`. */
async function gnuMatches(pattern: string, line: string): Promise<boolean | "rejected"> {
  const child = new Deno.Command("/bin/grep", {
    args: ["-c", "-e", pattern],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C" },
    clearEnv: true,
  }).spawn();
  const w = child.stdin.getWriter();
  try {
    await w.write(enc.encode(`${line}\n`));
    await w.close();
  } catch {
    // grep exited before reading, which a bad pattern does.
  }
  const r = await child.output();
  if (r.code === 2) return "rejected";
  return dec.decode(r.stdout).trim() === "1";
}

function ours(pattern: string, line: string): boolean | "rejected" {
  const out = mod.execBasic(b(pattern), b(line), 0);
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
    for (const s of subjects) {
      const want = await gnuMatches(p, s);
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
    for (const subject of ["", "a", "ab", "a|b", "a+b", "aab", "(a)", "a?b", "a.b"]) {
      const want = await gnuMatches(p, subject);
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
