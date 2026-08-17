#!/usr/bin/env -S deno run
// Differential-testing oracle: JavaScript's `RegExp`, driven in one batch.
//
// The oracle is exact for the subset implemented, and exact in a strong sense: JavaScript's regexes
// backtrack, so the *choice* a pattern makes among several possible matches is specified, not just
// whether one exists. `(a|ab)c` against "abc" has one answer and a leftmost-longest engine would give
// a different one. Capture positions are compared too, since that is where a backtracking engine's
// semantics actually live — and positions need the `d` flag, which is what makes this comparison
// possible at all rather than a comparison of matched *text*.
//
// **This file is the reference, not the test.** Same role `packages/gzip/test/fuzz/oracle.py` and
// `packages/datetime/test/oracle.ts` play. It is not part of the TypeScript that
// `issues/system/0161` is moving.
//
// ## Bytes, and why the decoding is latin-1
//
// `packages/regex` matches **bytes**; JavaScript's indices are UTF-16 code units. Everything compared
// here is ASCII, so the two coincide — but only if the hex on the wire is decoded one byte to one
// code unit. `TextDecoder` would fold a stray 0x80 into one replacement character and quietly shift
// every index after it, so this maps bytes to code units directly and a non-ASCII byte in a corpus
// shows up as a disagreement rather than as a silent renumbering.
//
// Input is lines on stdin:
//
//     m      <patHex> <inputHex> <answer>   a match, compared against `new RegExp(pat, "d")`
//     mi     <patHex> <inputHex> <answer>   the same with the `i` flag
//     accept <patHex> <0|1>                 whether we compile it; JS-invalid must never be accepted
//     refusals <rounds> <percent>           at most this share of the `accept` lines may be a
//                                           pattern JavaScript compiles and we refuse
//
// `<answer>` is `null`, or groups separated by `;`, each `start,end` or `-` for one that did not
// participate. Failures go to stdout as `FAIL <reason>`; the last line is `DONE <count>`.

function readAll(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(1 << 20);
  for (;;) {
    const n = Deno.stdin.readSync(buf);
    if (n === null || n === 0) break;
    chunks.push(buf.slice(0, n));
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Hex to a string of one code unit per byte, so an index is a byte offset. */
function fromHex(h: string): string {
  let out = "";
  for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return out;
}

type Match = Array<[number, number] | null> | null;

function oracle(pattern: string, input: string, flags: string): Match {
  const m = new RegExp(pattern, flags + "d").exec(input) as RegExpExecArray & {
    indices?: Array<[number, number] | undefined>;
  };
  if (m === null) return null;
  const idx = m.indices;
  if (idx === undefined) throw new Error("the runtime does not support the d flag");
  const groups: Match = [];
  for (let i = 0; i < idx.length; i++) {
    const pair = idx[i];
    groups.push(pair === undefined ? null : [pair[0], pair[1]]);
  }
  return groups;
}

const show = (m: Match): string =>
  m === null ? "null" : m.map((g) => (g === null ? "-" : `${g[0]},${g[1]}`)).join(";");

function main(): number {
  const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
  const out: string[] = [];
  const say = (s: string) => {
    if (out.length < 40) out.push(`FAIL ${s}`);
  };
  // A pattern JavaScript compiles and this engine refuses is not a disagreement — the subset is
  // documented — but it is a *comparison that did not happen*, and if a change started refusing most
  // generated patterns every remaining comparison could pass while almost nothing was compared. So
  // the ratio is counted here rather than by the caller, which cannot see `jsOk`.
  let refusedInSubset = 0;

  for (const line of lines) {
    const f = line.split(" ");
    if (f[0] === "m" || f[0] === "mi") {
      const pattern = fromHex(f[1]);
      const input = fromHex(f[2]);
      const flags = f[0] === "mi" ? "i" : "";
      let want: Match;
      try {
        want = oracle(pattern, input, flags);
      } catch (e) {
        say(`/${pattern}/${flags}: the oracle rejected it, so it is a bad test case — ${e}`);
        continue;
      }
      if (show(want) !== f[3]) {
        say(`/${pattern}/${flags} on ${JSON.stringify(input)}: got ${f[3]}, RegExp says ${show(want)}`);
      }
    } else if (f[0] === "accept") {
      const pattern = fromHex(f[1]);
      let jsOk = true;
      try {
        new RegExp(pattern, "d");
      } catch {
        jsOk = false;
      }
      // One direction only. A pattern JavaScript compiles may still be outside this engine's
      // subset — lookaround, backreferences — and refusing it is the honest answer. A pattern
      // JavaScript refuses and this accepts is the dangerous case: it means the pattern was parsed
      // as something else.
      if (!jsOk && f[2] === "1") {
        say(`/${pattern}/ is not a valid JavaScript regex but was accepted`);
      }
      if (jsOk && f[2] === "0") refusedInSubset++;
    } else if (f[0] === "refusals") {
      const rounds = Number(f[1]);
      const percent = Number(f[2]);
      if (refusedInSubset * 100 > rounds * percent) {
        say(`the compiler refused ${refusedInSubset}/${rounds} patterns JavaScript compiles, ` +
          `over the ${percent}% this calls a comparison`);
      }
    } else {
      say(`unknown check ${JSON.stringify(f[0])}`);
    }
  }

  for (const line of out) console.log(line);
  console.log(`DONE ${lines.length}`);
  return 0;
}

Deno.exit(main());
