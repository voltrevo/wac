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
// And the bignum underneath them, against `BigInt`. A `FixedBig` arrives as its limbs, little-endian
// bytes in hex, because that is what it is; the operands arrive as a u64 in hex and a shift, because
// that is the only shape `bigops.wac` can build one from across any boundary.
//
//     shift <vHex16> <bits> <limbsHex>
//     mul   <vHex16> <bits> <m> <times> <limbsHex>
//     sum   <aHex16> <ashift> <bHex16> <bshift> <limbsHex>
//     sub   <aHex16> <ashift> <bHex16> <bshift> <limbsHex>
//     cmp   <aHex16> <ashift> <bHex16> <bshift> <-1|0|1>
//
// And one property rather than a value:
//
//     midpoint <textHex>            the decimal is *exactly* halfway between two adjacent doubles
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

/** Limb bytes, little-endian, back to the number they are. */
function limbsToBig(hex: string): bigint {
  let v = 0n;
  for (let i = hex.length - 2; i >= 0; i -= 2) v = (v << 8n) | BigInt(parseInt(hex.slice(i, i + 2), 16));
  return v;
}

const bigOf = (hex: string): bigint => BigInt("0x" + (hex === "" ? "0" : hex));

/** A double as an exact rational. */
function exactDouble(x: number): { num: bigint; den: bigint } {
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const be = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  const f = be === 0 ? frac : frac + (1n << 52n);
  const g = be === 0 ? -1074 : be - 1075;
  return g >= 0 ? { num: f << BigInt(g), den: 1n } : { num: f, den: 1n << BigInt(-g) };
}

/** A plain `<digits>e-<scale>` decimal as an exact rational, or null if it is not one. */
function exactValue(s: string): { num: bigint; den: bigint } | null {
  const m = /^(-?)(\d+)e-(\d+)$/.exec(s);
  if (m === null) return null;
  const num = BigInt(m[2]) * (m[1] === "-" ? -1n : 1n);
  return { num, den: 10n ** BigInt(m[3]) };
}

/** The double just below `x`, and just above it, by bit pattern. */
function nextDown(x: number): number {
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits - 1n);
  return view.getFloat64(0);
}

function nextUp(x: number): number {
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits + 1n);
  return view.getFloat64(0);
}

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
    } else if (f[0] === "shift") {
      const want = bigOf(f[1]) << BigInt(f[2]);
      const got = limbsToBig(f[3]);
      if (got !== want) say(`${bigOf(f[1])} << ${f[2]}: got ${got}, want ${want}`);
    } else if (f[0] === "mul") {
      const want = (bigOf(f[1]) << BigInt(f[2])) * BigInt(f[3]) ** BigInt(f[4]);
      const got = limbsToBig(f[5]);
      if (got !== want) {
        say(`(${bigOf(f[1])} << ${f[2]}) * ${f[3]}^${f[4]}: got ${got}, want ${want}`);
      }
    } else if (f[0] === "sum" || f[0] === "sub" || f[0] === "cmp") {
      const x = bigOf(f[1]) << BigInt(f[2]);
      const y = bigOf(f[3]) << BigInt(f[4]);
      if (f[0] === "sum") {
        const got = limbsToBig(f[5]);
        if (got !== x + y) say(`${x} + ${y}: got ${got}, want ${x + y}`);
      } else if (f[0] === "sub") {
        // The minuend must be the larger; that is the contract, and a caller that broke it would be
        // asking about a negative a `FixedBig` cannot hold.
        if (x < y) {
          say(`${x} - ${y}: the minuend is the smaller, which is not a case this operation has`);
        } else {
          const got = limbsToBig(f[5]);
          if (got !== x - y) say(`${x} - ${y}: got ${got}, want ${x - y}`);
        }
      } else {
        const want = x < y ? -1 : x > y ? 1 : 0;
        if (Number(f[5]) !== want) say(`cmp(${x}, ${y}): got ${f[5]}, want ${want}`);
      }
    } else if (f[0] === "midpoint") {
      // A halfway case is only a halfway case if it really is one, and a decimal committed to a test
      // file is a claim about arithmetic nobody re-does. This re-does it, exactly and in rationals.
      //
      // `Number(s)` lands on *one* of the two doubles the value sits between — which one depends on
      // ties-to-even, which is the very rule under test — so both neighbours are tried rather than
      // guessed at.
      const s = fromHex(f[1]);
      const at = exactValue(s);
      if (at === null) {
        say(`${s} is not a plain decimal, so it cannot be checked as a midpoint`);
      } else {
        const v = Number(s);
        const isMidOf = (a: number, b: number): boolean => {
          const x = exactDouble(a);
          const y = exactDouble(b);
          const sum = x.num * y.den + y.num * x.den;
          const den = x.den * y.den * 2n;
          return at.num * den === sum * at.den;   // cross-multiplied, so nothing is divided
        };
        if (!isMidOf(nextDown(v), v) && !isMidOf(v, nextUp(v))) {
          say(`${s} is not the midpoint of two adjacent doubles`);
        }
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
