// The corpus, for the TypeScript tools that still read it — derived, not held.
//
// **This used to be the corpus**: 946 script literals and the list of programs box carries. It is now
// `packages/sh/test/wac/corpus.wac`, because the generator that asks the oracle and the tests that replay
// its answers are wac, and data that two languages hold twice is data that drifts.
//
// So this file parses `vectors.txt` — written by `tools/wac/shvectors.wac` from the wac corpus — and
// exports what the remaining consumers need: `tools/designClaims.test.ts`, which checks the counts the
// READMEs state, and `tools/corpusStderr.ts`, which compares standard error against the oracle's.
//
// The scripts and the split come out of the same file the replays read, so there is one source and one
// derived artefact rather than two lists that have to be kept level.

const VECTORS = new URL("./vectors.txt", import.meta.url).pathname;

type Parsed = { scripts: string[]; needsProgram: boolean[]; programs: string[] };

function parse(text: string): Parsed {
  const bytes = new TextEncoder().encode(text);
  const dec = new TextDecoder();
  const scripts: string[] = [];
  const needsProgram: boolean[] = [];
  let programs: string[] = [];
  let at = 0;

  const line = (): { text: string; next: number } => {
    let end = at;
    while (end < bytes.length && bytes[end] !== 0x0a) end++;
    return { text: dec.decode(bytes.subarray(at, end)), next: end + 1 };
  };

  // Header, up to and including `count:`.
  for (;;) {
    const l = line();
    at = l.next;
    if (l.text.startsWith("programs: ")) programs = l.text.slice("programs: ".length).split(" ");
    if (l.text.startsWith("count: ")) break;
    if (at >= bytes.length) throw new Error(`${VECTORS}: no count in the header`);
  }

  // Records: `S <n>` then n bytes, `P 0|1`, `X <status>`, `O <n>` + bytes, `E <n>` + bytes.
  while (at < bytes.length) {
    const s = line();
    if (!s.text.startsWith("S ")) break;
    const slen = Number(s.text.slice(2));
    scripts.push(dec.decode(bytes.subarray(s.next, s.next + slen)));
    at = s.next + slen + 1;
    const p = line();
    needsProgram.push(p.text === "P 1");
    at = p.next;
    for (const tag of ["X", "O", "E"]) {
      const l = line();
      at = l.next;
      if (tag === "X") continue;
      if (l.text.startsWith(`${tag}# `)) continue; // over the cap: a length and a marker, no bytes
      at += Number(l.text.slice(2)) + 1;
    }
  }
  return { scripts, needsProgram, programs };
}

const parsed = parse(Deno.readTextFileSync(VECTORS));

/** Every script, in the order they were written. */
export const CORPUS: string[] = parsed.scripts;

/** The external programs box carries. */
export const PROGRAMS: string[] = parsed.programs;

/** Kept as an alias: this asked "can `packages/sh`'s own shell still run it", which is the same set. */
export const DELETED: string[] = parsed.programs;

const NEEDS = new Map(parsed.scripts.map((s, i) => [s, parsed.needsProgram[i]]));

/**
 * Whether a script names an external command — the line between `packages/sh`'s half of the corpus and
 * `packages/box`'s.
 *
 * Answered from the captured file rather than recomputed, so both halves and both languages agree by
 * construction. A script this has never seen is asked the old way, by name.
 */
export function needsProgram(script: string): boolean {
  const known = NEEDS.get(script);
  if (known !== undefined) return known;
  return PROGRAMS.some((p) => new RegExp(`(^|[|;&(\`$\\s{])${p}\\b`).test(script));
}

/** Whether a script runs a program `packages/sh` has already given up. */
export function usesDeleted(script: string): boolean {
  return needsProgram(script);
}
