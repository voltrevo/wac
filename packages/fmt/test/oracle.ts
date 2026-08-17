#!/usr/bin/env -S deno run
// Differential-testing oracle for floating-point text: JavaScript's own `Number`, in one batch.
//
// **This file is the reference, not the test.** Same role `packages/gzip/test/fuzz/oracle.py` and
// `packages/datetime/test/oracle.ts` play. It is not part of the TypeScript that
// `issues/system/0161` is moving.
//
// What it answers, and why each needs a host:
//
//   - **`String(x)` for a double** is the whole specification `ftoa` matches. There is no shorter
//     statement of it and no second implementation worth preferring.
//   - **round-tripping an f32** has to be judged by a parser that is *not* ours, or the test becomes
//     an encoder and decoder agreeing about a shared mistake. `Number(s)` then `Math.fround` is that
//     parser.
//   - **shortest** needs `toPrecision`, which is the cheap way to ask "does any decimal with fewer
//     significant digits also round-trip".
//   - **correctly-rounded parsing** needs a decimal-to-binary conversion that rounds once. Parsing
//     to f64 and narrowing rounds twice and disagrees near f32 boundaries; `Math.fround(Number(s))`
//     computes it in one step from the string.
//
// Input is lines on stdin. Floats travel as their **bits** in hex, because a decimal spelling of the
// input would be the very thing under test:
//
//     f64 <bits16> <ourText>        `ftoa`, against String(x)
//     f32 <bits8> <ourText>         an f32's text: must round-trip, and be shortest
//     p32 <textHex> <ourBits8>      `atof32`, against Math.fround(Number(s))
//     p64 <textHex> <ourBits16>     `atof`, against Number(s)
//
// Failures go to stdout as `FAIL <reason>`; the last line is `DONE <count>`.

const view = new DataView(new ArrayBuffer(8));

function f64Of(hex: string): number {
  for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return view.getFloat64(0);
}

function f32Of(hex: string): number {
  for (let i = 0; i < 4; i++) view.setUint8(i, parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return view.getFloat32(0);
}

function bits64(x: number): string {
  view.setFloat64(0, x);
  let out = "";
  for (let i = 0; i < 8; i++) out += view.getUint8(i).toString(16).padStart(2, "0");
  return out;
}

function bits32(x: number): string {
  view.setFloat32(0, x);
  let out = "";
  for (let i = 0; i < 4; i++) out += view.getUint8(i).toString(16).padStart(2, "0");
  return out;
}

/** Significant digits in a decimal string: no sign, point, exponent or padding. */
function significantDigits(s: string): number {
  const mantissa = s.replace(/e.*$/i, "").replace(/[-.]/g, "");
  const trimmed = mantissa.replace(/^0+/, "").replace(/0+$/, "");
  return trimmed.length === 0 ? 1 : trimmed.length;
}

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

const fromHex = (h: string): string => {
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
};

function main(): number {
  const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
  const out: string[] = [];
  const say = (s: string) => {
    if (out.length < 40) out.push(`FAIL ${s}`);
  };

  for (const line of lines) {
    const f = line.split(" ");
    if (f[0] === "f64") {
      const x = f64Of(f[1]);
      const want = String(x);
      if (want !== f[2]) say(`${want}: got ${JSON.stringify(f[2])}`);
    } else if (f[0] === "f32") {
      const x = f32Of(f[1]);
      const s = f[2];
      // Two properties, checked separately. Round-tripping alone would be satisfied by printing the
      // exact value, which is never what is wanted.
      if (!Object.is(Math.fround(Number(s)), x)) {
        say(`${s} does not read back as the f32 ${x}`);
        continue;
      }
      // Trailing zeros are exponent, not information — 8324640000000 carries six significant digits,
      // and counting thirteen made this check reject a correct answer.
      const digits = significantDigits(s);
      for (let p = 1; p < digits; p++) {
        if (Object.is(Math.fround(Number(x.toPrecision(p))), x)) {
          say(`${s} is not shortest: ${x.toPrecision(p)} also round-trips`);
          break;
        }
      }
    } else if (f[0] === "p32") {
      const s = fromHex(f[1]);
      const want = bits32(Math.fround(Number(s)));
      if (want !== f[2]) {
        say(`${JSON.stringify(s)}: parsed to bits ${f[2]}, Math.fround(Number(s)) is ${want} (${
          Math.fround(Number(s))
        })`);
      }
    } else if (f[0] === "p64") {
      const s = fromHex(f[1]);
      const want = bits64(Number(s));
      if (want !== f[2]) {
        say(`${JSON.stringify(s)}: parsed to bits ${f[2]}, Number(s) is ${want} (${Number(s)})`);
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
