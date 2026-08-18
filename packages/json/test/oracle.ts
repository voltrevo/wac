#!/usr/bin/env -S deno run
// Differential-testing oracle for JSON: the host's own `JSON.parse`, in one batch.
//
// **This file is the reference, not the test.** Same role `packages/gzip/test/fuzz/oracle.py` and
// `packages/datetime/test/oracle.ts` play. It is not part of the TypeScript that
// `issues/system/0161` is moving.
//
// Two questions, and they are different:
//
//   - **accept or reject.** `JSON.parse` throwing is the oracle for the half of a parser that is
//     defined by what it refuses, which is where lenient hand-written parsers differ from the spec.
//   - **the same tree.** Accepting is only half of it: the value has to be right. Compared as parsed
//     trees rather than as text, because numbers are emitted from their source span and JavaScript
//     reorders integer-like object keys.
//
// Documents travel as **hex**, because half the corpus is not valid UTF-8 and a document that went
// through a text encoding would not be the document under test — the very bytes are the subject.
//
// Input is lines on stdin:
//
//     parses <docHex> <0|1>              whether `JSON.parse` accepts it
//     sametree <oursHex> <theirsHex>     our canonical output and the original, as one tree each
//     number <docHex> <bits16>           `Number(text)`'s bit pattern, for a bare JSON number
//     restringify <docHex> <textHex>     `JSON.stringify(JSON.parse(doc))`, as text
//     utf8valid <bytesHex> <0|1>         whether a *strict* `TextDecoder` accepts these bytes
//     json5corpus                        every vendored JSON5 input, as `case <inputHex>`
//     json5cmp <i> <0|1> <ourTextHex>    `agree`, or `differ <reasonHex>`, for corpus case `i`
//
// The last two **produce** rather than judge, and answer on their own channel — see `emit` in
// `main`. They exist so that the JSON5 corpus never has to be parsed by the parser it is testing.
//
// `restringify` carries both halves of this package's relationship with the host: the agreement tests
// pass our canonical output as `<textHex>`, and the two *divergence* tests pass what JavaScript is
// claimed to produce — `-0` printing as `0`, duplicate keys collapsing to one. A recorded divergence
// that stopped being one would otherwise sit in a comment saying it still was.
//
// Failures go to stdout as `FAIL <reason>`; the last line is `DONE <count>`.

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

function bytesOf(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function hexOf(s: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(s)) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * The vendored JSON5 corpus, read here rather than by the caller.
 *
 * **The wac side never parses this file**, which is the point of serving it from here: the parser
 * under test would otherwise be the thing reading its own corpus, and a misread would arrive as
 * hundreds of disagreements about JSON5 rather than as one about the harness. `json5corpus` hands
 * over the inputs and `json5cmp` keeps the expected answers on this side entirely.
 */
type Vendored = { source: string; cases: { input: string; json: string | null }[] };
let corpus: Vendored | undefined;
function json5Corpus(): Vendored {
  if (corpus === undefined) {
    corpus = JSON.parse(
      Deno.readTextFileSync(new URL("./vendor/json5.json", import.meta.url)),
    ) as Vendored;
  }
  return corpus;
}

/**
 * A document as the string `JSON.parse` would be given.
 *
 * `fatal: true`, so a document that is not valid UTF-8 is a *rejection* here rather than a string
 * full of replacement characters — which is what a lenient decode would silently turn `["\x81"]`
 * into, and the reason `packages/json/test/wac/utf8_test.wac` exists at all.
 */
function textOf(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function parses(bytes: Uint8Array): boolean {
  const text = textOf(bytes);
  if (text === null) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      Object.hasOwn(b as object, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    );
  }
  return false;
}

const view = new DataView(new ArrayBuffer(8));
function bits64(x: number): string {
  view.setFloat64(0, x);
  let out = "";
  for (let i = 0; i < 8; i++) out += view.getUint8(i).toString(16).padStart(2, "0");
  return out;
}

function main(): number {
  const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
  const out: string[] = [];
  const say = (s: string) => {
    if (out.length < 40) out.push(`FAIL ${s}`);
  };
  // Answers, for the two ops that **produce** rather than judge. Printed before the `FAIL` lines and
  // never interleaved with them, because the caller indexes these by position: a judged op that
  // failed partway through would otherwise shift every answer after it.
  const emit: string[] = [];

  for (const line of lines) {
    const f = line.split(" ");
    if (f[0] === "parses") {
      const bytes = bytesOf(f[1]);
      const want = parses(bytes) ? "1" : "0";
      if (want !== f[2]) {
        const shown = textOf(bytes) ?? `<${f[1]}>`;
        say(`${JSON.stringify(shown)}: we say ${f[2] === "1" ? "accept" : "reject"}, JSON.parse ${
          want === "1" ? "accepts" : "rejects"
        }`);
      }
    } else if (f[0] === "sametree") {
      const ourText = textOf(bytesOf(f[1]));
      const theirText = textOf(bytesOf(f[2]));
      if (theirText === null) continue;   // the host cannot read the original; not this check
      let theirs: unknown;
      try {
        theirs = JSON.parse(theirText);
      } catch {
        continue;                          // host disagrees about the document; not this check
      }
      if (ourText === null) {
        say(`we emitted bytes that are not UTF-8 for ${JSON.stringify(theirText.slice(0, 60))}`);
        continue;
      }
      let ours: unknown;
      try {
        ours = JSON.parse(ourText);
      } catch (e) {
        say(`we emitted unparseable JSON for ${JSON.stringify(theirText.slice(0, 60))} — ${e}`);
        continue;
      }
      if (!deepEqual(ours, theirs)) {
        say(`tree differs for ${JSON.stringify(theirText.slice(0, 60))} — we emitted ${
          JSON.stringify(ourText.slice(0, 60))
        }`);
      }
    } else if (f[0] === "restringify") {
      const doc = textOf(bytesOf(f[1]));
      const want = textOf(bytesOf(f[2]));
      if (doc === null || want === null) {
        say(`restringify was given bytes that are not UTF-8`);
        continue;
      }
      let got: string;
      try {
        got = JSON.stringify(JSON.parse(doc));
      } catch (e) {
        say(`the oracle cannot parse ${JSON.stringify(doc.slice(0, 60))} — ${e}`);
        continue;
      }
      if (got !== want) {
        say(`${JSON.stringify(doc.slice(0, 60))}: expected ${JSON.stringify(want)}, ` +
          `JSON.stringify(JSON.parse(x)) is ${JSON.stringify(got)}`);
      }
    } else if (f[0] === "utf8valid") {
      // The bytes on their own, not wrapped in a document: this is the UTF-8 question rather than
      // the JSON one, and `fatal: true` is the whole of it — a lenient decode turns every malformed
      // sequence into U+FFFD and answers "valid" to all of them.
      const want = textOf(bytesOf(f[1])) === null ? "0" : "1";
      if (want !== f[2]) {
        say(`[${f[1]}]: we say ${f[2] === "1" ? "valid" : "invalid"}, a strict TextDecoder says ${
          want === "1" ? "valid" : "invalid"
        }`);
      }
    } else if (f[0] === "number") {
      const text = textOf(bytesOf(f[1]));
      if (text === null) {
        say(`a number that is not UTF-8: ${f[1]}`);
        continue;
      }
      const want = bits64(Number(text));
      if (want !== f[2]) {
        say(`${text}: parsed to bits ${f[2]}, Number(s) is ${want} (${Number(text)})`);
      }
    } else if (f[0] === "json5corpus") {
      // One request line, one answer per case. `ask` checks `DONE` against what it *sent*, so a
      // batch of one that answers 467 times is exactly the shape it expects.
      for (const c of json5Corpus().cases) emit.push(`case ${hexOf(c.input)}`);
    } else if (f[0] === "json5cmp") {
      // `json5cmp <index> <0|1> <ourTextHex>` — the index is into the corpus above, so the expected
      // answer never crosses the boundary and cannot be misread on the way.
      //
      // Compared after re-spelling: the vendored answer is `JSON.stringify` of the reference's
      // value, so comparing raw text would be comparing *number formatting* — `0.0` comes back as
      // `0.0` from a parser that keeps the bytes it read, and as `0` from `JSON.stringify`.
      // Re-reading our output and writing it again puts both sides in one spelling without touching
      // the value; a number we got wrong is still wrong afterwards.
      const c = json5Corpus().cases[Number(f[1])];
      if (c === undefined) {
        emit.push(`differ ${hexOf(`no corpus case at index ${f[1]}`)}`);
        continue;
      }
      const accepted = f[2] === "1";
      let ours: string;
      if (!accepted) {
        ours = "reject";
      } else {
        const text = textOf(bytesOf(f[3] ?? ""));
        if (text === null) {
          ours = "accepted, but the bytes it produced are not UTF-8";
        } else {
          try {
            ours = JSON.stringify(JSON.parse(text));
          } catch {
            ours = `accepted, but the text it produced is not JSON: ${JSON.stringify(text)}`;
          }
        }
      }
      const agrees = c.json === null ? !accepted : ours === c.json;
      emit.push(
        agrees ? "agree" : `differ ${
          hexOf(`${JSON.stringify(c.input)}: json5 says ${c.json ?? "reject"}, we say ${ours}`)
        }`,
      );
    } else {
      say(`unknown check ${JSON.stringify(f[0])}`);
    }
  }

  for (const line of emit) console.log(line);
  for (const line of out) console.log(line);
  console.log(`DONE ${lines.length}`);
  return 0;
}

Deno.exit(main());
