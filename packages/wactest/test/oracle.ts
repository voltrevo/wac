#!/usr/bin/env -S deno run
// Differential-testing oracle for 64-bit decimal formatting: JavaScript's `BigInt`, in one batch.
//
// **This file is the reference, not the test.** `packages/wactest`'s own formatters are the ones
// every failure message in every wac test goes through, so they are worth an exact oracle rather
// than a table: `BigInt.toString()` is that, for every pattern there is.
//
// Values travel as their **bit pattern**, sixteen hex digits, because the whole question is what
// decimal a pattern names and a decimal spelling of the input would be the answer smuggled in.
//
// Input is lines on stdin:
//
//     u <bits16> <got>     the pattern read as an unsigned 64-bit integer
//     i <bits16> <got>     ...and as a signed one
//
// Failures go to stdout as `FAIL <reason>`; the last line is `DONE <count>`.

function readAll(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(1 << 16);
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

  for (const line of lines) {
    const f = line.split(" ");
    if (f[0] !== "u" && f[0] !== "i") {
      say(`unknown check ${JSON.stringify(f[0])}`);
      continue;
    }
    const bits = BigInt("0x" + f[1]);
    const want = (f[0] === "u" ? BigInt.asUintN(64, bits) : BigInt.asIntN(64, bits)).toString();
    if (want !== f[2]) say(`${f[0]}toa64 of 0x${f[1]}: got ${f[2]}, want ${want}`);
  }

  for (const line of out) console.log(line);
  console.log(`DONE ${lines.length}`);
  return 0;
}

Deno.exit(main());
