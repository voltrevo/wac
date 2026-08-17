#!/usr/bin/env -S deno run
// Differential-testing oracle: the JavaScript engine's own Unicode data, driven in one batch.
//
// The host is the only reference here with the whole of Unicode in it — `toLowerCase`,
// `toUpperCase`, a `u`-mode `RegExp` for simple case folding, and `\p{…}` for the general
// categories. python's `unicodedata` would answer some of these and not the folding, and swapping in
// a second source for half the checks would make the disagreements harder to read rather than easier.
//
// **This file is the reference, not the test.** Same role `packages/gzip/test/fuzz/oracle.py` and
// `packages/datetime/test/oracle.ts` play: the thing compared against, invoked the way `gunzip` is.
// It is not part of the TypeScript that `issues/system/0161` is moving.
//
// ## Why the input is sparse
//
// Every check here is over all 1 114 112 code points, and three of the four are functions that agree
// with the identity almost everywhere. So the caller sends the places where its answer is *not* the
// identity, and this rebuilds the whole function from that and sweeps it — which makes the transport
// a few thousand lines instead of a few million, and, more usefully, makes a missing entry and a
// wrong entry the same kind of failure.
//
// UTF-8 encoding is the exception: it differs from the identity everywhere, so that one is sent in
// full.
//
// Input is lines on stdin:
//
//     case  <cp> <lower> <upper>   every cp where either simple mapping moves it
//     fold  <cp> <to>              every cp whose simple case fold moves it
//     sweep <case|fold|print>      run that whole-range sweep; without it the table is context only
//     print <cp> <0|1>             every cp whose printability differs from cp-1's
//     utf8  <cp> <hex>             every cp and the bytes it encodes to
//     str   <what> <in> <out>      a whole-string operation, hex in and hex out
//     eqf   <a> <b> <0|1>          two hex strings and whether they compare fold-equal
//     valid <hex> <0|1>            bytes and whether they are well-formed UTF-8
//     count <hex> <n>              bytes and their scalar count, -1 for invalid
//
// A table arriving without its `sweep` line is *context* — the fold sweep needs the case mappings to
// ask whether a code point folds with its own uppercase, and running the case sweep over a table sent
// for that reason would report every code point it did not need.
//
// Failures go to stdout as `FAIL <reason>`; the last line is `DONE <count>`.

const MAX = 0x10ffff;

/** The single code point `s` maps to, or -1 if it is not exactly one. */
function single(s: string): number {
  const points = [...s];
  return points.length === 1 ? points[0].codePointAt(0)! : -1;
}

/**
 * Whether the host says these two code points are the same letter ignoring case.
 *
 * A `u`-mode `RegExp` canonicalizes by Unicode **simple case folding**, which is a different table
 * from `toLowerCase` and the one this package's `fold` is supposed to be. Using case mapping as the
 * oracle for case folding is what let `ı` and `i` into the same class: they share an uppercase and
 * are not the same letter.
 */
function sameLetter(a: number, b: number): boolean {
  return new RegExp("\\u{" + a.toString(16) + "}", "iu").test(String.fromCodePoint(b));
}

const isSurrogate = (cp: number) => cp >= 0xd800 && cp <= 0xdfff;

function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const bytesToHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

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

function main(): number {
  const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
  const out: string[] = [];
  const say = (s: string) => {
    if (out.length < 40) out.push(`FAIL ${s}`);
  };

  // The sparse tables, rebuilt from what was sent.
  const lower = new Map<number, number>();
  const upper = new Map<number, number>();
  const fold = new Map<number, number>();
  const printTransitions: Array<[number, boolean]> = [];
  let sawCase = false, sawFold = false, sawPrint = false, sawUtf8 = false;

  const enc = new TextEncoder();
  const strict = new TextDecoder("utf-8", { fatal: true });

  for (const line of lines) {
    const f = line.split(" ");
    const n = (i: number) => Number(f[i]);
    switch (f[0]) {
      case "sweep":
        if (f[1] === "case") sawCase = true;
        else if (f[1] === "fold") sawFold = true;
        else if (f[1] === "print") sawPrint = true;
        else say(`unknown sweep ${JSON.stringify(f[1])}`);
        break;
      case "case":
        if (n(1) !== n(2)) lower.set(n(1), n(2));
        if (n(1) !== n(3)) upper.set(n(1), n(3));
        break;
      case "fold":
        fold.set(n(1), n(2));
        break;
      case "print":
        printTransitions.push([n(1), n(2) === 1]);
        break;
      case "utf8": {
        sawUtf8 = true;
        const want = bytesToHex(enc.encode(String.fromCodePoint(n(1))));
        if (want !== f[2]) say(`U+${n(1).toString(16)}: encoded ${f[2]}, TextEncoder says ${want}`);
        break;
      }
      case "str": {
        const input = strict.decode(hexToBytes(f[2]));
        const want = f[1] === "lower" ? input.toLowerCase() : input.toUpperCase();
        const got = strict.decode(hexToBytes(f[3]));
        if (got !== want) {
          say(`${f[1]} ${JSON.stringify(input)}: got ${JSON.stringify(got)}, host says ${JSON.stringify(want)}`);
        }
        break;
      }
      case "eqf": {
        const a = strict.decode(hexToBytes(f[1]));
        const b = strict.decode(hexToBytes(f[2]));
        const x = [...a], y = [...b];
        let want = x.length === y.length;
        for (let i = 0; want && i < x.length; i++) {
          want = sameLetter(x[i].codePointAt(0)!, y[i].codePointAt(0)!);
        }
        if (want !== (n(3) === 1)) {
          say(`${JSON.stringify(a)} vs ${JSON.stringify(b)}: foldEqual ${f[3]}, host says ${want ? 1 : 0}`);
        }
        break;
      }
      case "valid": {
        let hostOk = true;
        try {
          strict.decode(hexToBytes(f[1]));
        } catch {
          hostOk = false;
        }
        if (hostOk !== (n(2) === 1)) {
          say(`[${f[1]}]: wac ${f[2]}, TextDecoder ${hostOk ? 1 : 0}`);
        }
        break;
      }
      case "count": {
        let want = -1;
        try {
          want = [...strict.decode(hexToBytes(f[1]))].length;
        } catch { /* stays -1 */ }
        if (want !== n(2)) say(`[${f[1]}]: counted ${f[2]}, host says ${want}`);
        break;
      }
      default:
        say(`unknown check ${JSON.stringify(f[0])}`);
    }
  }

  if (sawCase) sweepCase(lower, upper, say);
  if (sawFold) sweepFold(fold, lower, upper, say);
  if (sawPrint) sweepPrintable(printTransitions, say);
  if (sawUtf8) {
    // Every code point, or the sweep was a sample wearing the word "every".
    const want = MAX + 1 - 2048;
    const sent = lines.reduce((a, l) => a + (l.startsWith("utf8 ") ? 1 : 0), 0);
    if (sent !== want) say(`the utf8 sweep sent ${sent} code points, not ${want}`);
  }

  for (const line of out) console.log(line);
  console.log(`DONE ${lines.length}`);
  return 0;
}

/**
 * Simple case mapping at every code point, and the simple/full boundary with it.
 *
 * Where the host maps one code point to several, simple mapping must leave it alone — so the
 * caller's table must have no entry there, which is what a diff against a table built only from
 * single-code-point mappings says.
 */
function sweepCase(
  lower: Map<number, number>,
  upper: Map<number, number>,
  say: (s: string) => void,
): void {
  let multi = 0;
  for (let cp = 0; cp <= MAX; cp++) {
    if (isSurrogate(cp)) continue;
    const ch = String.fromCodePoint(cp);

    const lo = single(ch.toLowerCase());
    if (lo < 0) multi++;
    const wantLower = lo >= 0 ? lo : cp;
    const gotLower = lower.get(cp) ?? cp;
    if (gotLower !== wantLower) {
      say(`lower U+${cp.toString(16)}: got ${gotLower}, want ${wantLower}` +
          (lo < 0 ? ` (the host maps it to ${JSON.stringify(ch.toLowerCase())}, so simple mapping must leave it)` : ""));
    }

    const up = single(ch.toUpperCase());
    if (up < 0) multi++;
    const wantUpper = up >= 0 ? up : cp;
    const gotUpper = upper.get(cp) ?? cp;
    if (gotUpper !== wantUpper) {
      say(`upper U+${cp.toString(16)}: got ${gotUpper}, want ${wantUpper}` +
          (up < 0 ? ` (the host maps it to ${JSON.stringify(ch.toUpperCase())}, so simple mapping must leave it)` : ""));
    }
  }
  if (multi === 0) say("no multi-code-point mappings found, so the simple/full boundary proves nothing");
}

/**
 * Simple case folding, checked as a relation rather than against a second table.
 *
 * There is no `String.prototype.foldCase`, so the oracle is `RegExp` in `u` mode, which
 * canonicalizes by simple case folding — the definition. Two rules: whatever a code point folds to
 * has to be the same letter, and a code point that is the same letter as its own case mapping has to
 * fold with it.
 */
function sweepFold(
  fold: Map<number, number>,
  lower: Map<number, number>,
  upper: Map<number, number>,
  say: (s: string) => void,
): void {
  const foldOf = (cp: number) => fold.get(cp) ?? cp;
  for (let cp = 0; cp <= MAX; cp++) {
    if (isSurrogate(cp)) continue;
    const f = foldOf(cp);
    if (f !== cp && !sameLetter(cp, f)) {
      say(`U+${cp.toString(16)} folds to U+${f.toString(16)}, which the host says is a different letter`);
    }
    const up = upper.get(cp);
    if (up !== undefined && sameLetter(cp, up) && foldOf(up) !== f) {
      say(`U+${cp.toString(16)} and its uppercase U+${up.toString(16)} are the same letter and fold apart: ${f} vs ${foldOf(up)}`);
    }
    const lo = lower.get(cp);
    if (lo !== undefined && sameLetter(cp, lo) && foldOf(lo) !== f) {
      say(`U+${cp.toString(16)} and its lowercase U+${lo.toString(16)} are the same letter and fold apart: ${f} vs ${foldOf(lo)}`);
    }
  }
  if (fold.size < 1000) say(`only ${fold.size} code points fold to anything, which is too few`);
}

/**
 * Printability at every code point, rebuilt from the caller's transitions.
 *
 * The table is hundreds of ranges, so the failure mode is not a wrong value but a wrong *boundary* —
 * and a transition list is exactly the boundaries, so a disagreement names the one that moved.
 */
function sweepPrintable(transitions: Array<[number, boolean]>, say: (s: string) => void): void {
  const notPrintable = /\p{Cc}|\p{Cn}|\p{Cs}|\p{Zl}|\p{Zp}/u;
  transitions.sort((a, b) => a[0] - b[0]);
  let at = 0;
  let current = false;
  let wrong = 0, first = -1;
  for (let cp = 0; cp <= MAX; cp++) {
    while (at < transitions.length && transitions[at][0] === cp) {
      current = transitions[at][1];
      at++;
    }
    const host = isSurrogate(cp) ? false : !notPrintable.test(String.fromCodePoint(cp));
    if (current !== host) {
      wrong++;
      if (first < 0) first = cp;
    }
  }
  if (wrong !== 0) {
    say(`isPrintable disagrees with the host on ${wrong} code points, first U+${first.toString(16).toUpperCase()}`);
  }
}

Deno.exit(main());
