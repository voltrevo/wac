#!/usr/bin/env -S deno run
// Differential-testing oracle for arbitrary-precision integers: JavaScript's `BigInt`, in one batch.
//
// **This file is the reference, not the test.** Same role `packages/gzip/test/fuzz/oracle.py` and
// `packages/datetime/test/oracle.ts` play. It is not part of the TypeScript that
// `issues/system/0161` is moving.
//
// Two quite different things are asked of it, and they are in one file because they share the
// arithmetic:
//
//   - **`u64` semantics**, which are the *compiler's* rather than this package's. Division above
//     2^63 must not be signed, `>>` must not sign-extend, `as@ u32` must truncate. A wrong quotient
//     deep in `divmod` was once traced here first, and ruling the compiler out in one run is what
//     made it clear the bug was in `divmod`'s own estimate.
//   - **`Big` arithmetic and text**, where a decimal string in and a decimal string out is the whole
//     interface and `BigInt` is exact for every operation this package has.
//
// Values travel as **decimal text**, which is what `Big` reads and writes anyway, except in the u64
// rows where the whole question is about bit patterns and they travel as sixteen hex digits.
//
// Input is lines on stdin:
//
//     u64 <op> <aHex16> <bHex16> <gotHex16>      div rem shr mul add sub trunc ge, unsigned
//     big <op> <a> <b> <got>                     add sub mul div rem shl shr cmp cmpabs neg abs,
//                                                all decimal; and `identity`/`absrem`, which are
//                                                claims about a pair rather than one value
//     text <op> <in> <got>                       roundtrip bitlen iszero tohex
//     text fromhex <hexIn> <gotDecimal>          hex text in, decimal out — the anchor for a corpus
//                                                generated as hex and then used as decimal
//
// `<b>` is `-` for a unary operation. Failures go to stdout as `FAIL <reason>`; the last line is
// `DONE <count>`.

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

const u = (hex: string): bigint => BigInt("0x" + hex);
const asU64 = (v: bigint): bigint => BigInt.asUintN(64, v);
const hex16 = (v: bigint): string => asU64(v).toString(16).padStart(16, "0");

function u64Check(op: string, a: bigint, b: bigint, got: string, say: (s: string) => void): void {
  let want: bigint;
  switch (op) {
    case "div":
      if (b === 0n) return;
      want = a / b;
      break;
    case "rem":
      if (b === 0n) return;
      want = a % b;
      break;
    case "shr":
      want = a >> b;
      break;
    case "mul":
      want = asU64(a * b);
      break;
    case "add":
      want = asU64(a + b);
      break;
    case "sub":
      want = asU64(a - b);
      break;
    case "trunc":
      want = a & 0xffffffffn;
      break;
    case "ge":
      want = a >= b ? 1n : 0n;
      break;
    case "mulwide":
      // Two u32s widened, which is the shape the multiply-subtract inner loop uses.
      want = (a & 0xffffffffn) * (b & 0xffffffffn);
      break;
    default:
      say(`unknown u64 op ${JSON.stringify(op)}`);
      return;
  }
  if (hex16(want) !== got) {
    say(`u64 ${a} ${op} ${b}: got 0x${got} (${u(got)}), want 0x${hex16(want)} (${asU64(want)})`);
  }
}

function bigCheck(op: string, a: bigint, b: bigint, got: string, say: (s: string) => void): void {
  let want: bigint;
  switch (op) {
    case "add":
      want = a + b;
      break;
    case "sub":
      want = a - b;
      break;
    case "mul":
      want = a * b;
      break;
    case "div":
      if (b === 0n) return;
      // Truncating towards zero, which is what a magnitude-and-sign implementation does and what
      // BigInt does. A floor division would differ on every negative case, which is why the sign
      // pairs in the caller's corpus are not decoration.
      want = a / b;
      break;
    case "rem":
      if (b === 0n) return;
      want = a % b;
      break;
    case "pow":
      want = a ** b;
      break;
    case "shl":
      want = a << b;
      break;
    case "shr":
      want = a >> b;
      break;
    case "cmp":
      want = a < b ? -1n : a > b ? 1n : 0n;
      break;
    case "cmpabs": {
      const x = a < 0n ? -a : a;
      const y = b < 0n ? -b : b;
      want = x < y ? -1n : x > y ? 1n : 0n;
      break;
    }
    case "neg":
      want = -a;
      break;
    case "abs":
      want = a < 0n ? -a : a;
      break;
    case "identity":
      // `b` is the divisor and `got` is `q*b + r` computed by the caller from what this package
      // answered. The claim is that it equals `a` — a constraint on the quotient and the remainder
      // *together*, which comparing each on its own does not make.
      want = a;
      break;
    case "absrem":
      // |r| < |b|, sent as 1 when it holds. The caller cannot say this to itself without trusting
      // its own comparison, which is the thing being checked two lines up.
      want = 1n;
      break;
    default:
      say(`unknown big op ${JSON.stringify(op)}`);
      return;
  }
  if (want.toString() !== got) say(`${a} ${op} ${b}: got ${got}, want ${want}`);
}

function main(): number {
  const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
  const out: string[] = [];
  const say = (s: string) => {
    if (out.length < 40) out.push(`FAIL ${s}`);
  };

  for (const line of lines) {
    const f = line.split(" ");
    if (f[0] === "u64") {
      u64Check(f[1], u(f[2]), u(f[3]), f[4], say);
    } else if (f[0] === "big") {
      bigCheck(f[1], BigInt(f[2]), f[3] === "-" ? 0n : BigInt(f[3]), f[4], say);
    } else if (f[0] === "text") {
      const op = f[1];
      const input = f[2];
      const got = f[3];
      if (op === "roundtrip") {
        const want = BigInt(input).toString();
        if (want !== got) say(`decimal round trip of ${input}: got ${got}, want ${want}`);
      } else if (op === "bitlen") {
        const v = BigInt(input) < 0n ? -BigInt(input) : BigInt(input);
        const want = v === 0n ? 0 : v.toString(2).length;
        if (String(want) !== got) say(`bit length of ${input}: got ${got}, want ${want}`);
      } else if (op === "iszero") {
        const want = BigInt(input) === 0n ? "1" : "0";
        if (want !== got) say(`isZero of ${input}: got ${got}, want ${want}`);
      } else if (op === "tohex") {
        // No `0x`: `formatHex` writes the digits and the sign and nothing else, which is what
        // `parseHex` accepts with or without a prefix.
        const v = BigInt(input);
        const want = (v < 0n ? "-" : "") + (v < 0n ? -v : v).toString(16);
        if (want !== got) say(`hex of ${input}: got ${got}, want ${want}`);
      } else if (op === "fromhex") {
        // The anchor. A corpus generated as hex and converted to decimal by the code under test
        // would otherwise be a corpus of whatever that conversion produced, and every later check
        // would agree with it. This is the one line that says the two spellings name one number.
        const neg = input.startsWith("-");
        const body = (neg ? input.slice(1) : input).replace(/^0[xX]/, "");
        const want = (neg ? -1n : 1n) * BigInt("0x" + body);
        if (want.toString() !== got) say(`fromHex ${input}: got ${got}, want ${want}`);
      } else {
        say(`unknown text op ${JSON.stringify(op)}`);
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
