// Arbitrary-precision arithmetic as a service, so a wac exercise can name operands wac cannot compute.
//
// **Not `test/oracle.ts`, which is the judge.** That file is handed answers and says which it rejects;
// this one is handed requests and produces values. They both need `BigInt` and they are still two
// files, because a `FAIL` means opposite things in them — there, "these two implementations disagree";
// here, "the caller asked for something it did not mean". Folding them together would make that word
// ambiguous in the one place it has to be sharp.
//
// `packages/bignum` *is* the arbitrary-precision arithmetic, so its coverage driver has a problem no
// other package's has: the operands that reach the interesting branches — a divisor whose top limb is
// `0xffffffff`, a dividend that is an exact multiple of it, a carry that propagates the whole length of
// a value — cannot be written down without arithmetic wider than `i64`. The old `cov.ts` had
// JavaScript's `BigInt` to hand because it *was* JavaScript. A wac driver does not.
//
// So this is that arithmetic, and **nothing else**. It shares nothing with the code it feeds: `BigInt`
// is the runtime's, not ours, which is what makes it usable as an oracle at all.
//
// ## Why a service and not a corpus
//
// The same reason `packages/mpt/test/oracle.ts` gives, and it is worth repeating because the
// alternative here was tempting: the deterministic families are 20.4 KB of decimal digits and could
// simply have been committed as a fixture. They are not, because then every decision about *which*
// operands matter — which limb boundaries, which deltas, how many limbs of ones — would live in a data
// file that nothing derives, rather than in the exercise that cares. Change the anchor list and a
// fixture goes stale silently; change it here and the next run asks a different question.
//
// It also inverts the direction this repository is moving in, deliberately. `cov.ts` was JavaScript
// *driving* wac: it instrumented the module, called its exports, and reported. This is wac driving,
// calling JavaScript for one computation it cannot do. `issues/system/0161`.
//
// ## The protocol
//
//   seed <n>                     →  ok                 reseed the generator
//   pow2 <p> <delta>             →  dec <v>            (1 << p) + delta
//   ones <limbs> <delta>         →  dec <v>            (1 << 32·limbs) - 1 + delta
//   alt  <limbs>                 →  dec <v>            alternating 0xffffffff / 0 limbs, top first
//   word <limbs> <top> <rest>    →  dec <v>            top, then limbs-1 copies of rest, as u32 limbs
//   rand <bits>                  →  dec <v>            `bits` random bits, top bit set
//   mul  <a> <b> <delta>         →  dec <v>            a·b + delta, decimals in and out
//
// and `DONE <n>` last, counting the lines read, so a batch that was never finished cannot pass for one
// that was. A request whose answer would be negative is a `FAIL`, not a clamp: the caller asked for
// something it did not mean.
//
// `rand` reproduces the generator the TypeScript driver used — xorshift32, and `randomBits` taking the
// *high* bits of each draw — so the corpus is the one this package's coverage has always been measured
// against rather than a new one that happens to be the same size.

let x = 0x1234abcd | 0;
const next = (): number => {
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return x;
};

/** `bits` random bits with the top one set, so the value has exactly the width asked for. */
const randomBits = (bits: number): bigint => {
  if (bits <= 0) return 0n;
  let v = 1n;
  let have = 1;
  while (have < bits) {
    const take = Math.min(32, bits - have);
    v = (v << BigInt(take)) | BigInt(next() >>> (32 - take));
    have += take;
  }
  return v;
};

const U32 = 0xffffffffn;

const decoder = new TextDecoder();
const input = decoder.decode(await new Response(Deno.stdin.readable).arrayBuffer());
const out: string[] = [];
let n = 0;

for (const line of input.split("\n")) {
  if (line.length === 0) continue;
  n++;
  const [op, ...rest] = line.split(" ");
  const num = (i: number): bigint => BigInt(rest[i]);
  try {
    if (op === "seed") {
      x = Number(BigInt(rest[0]) & 0xffffffffn) | 0;
      out.push("ok");
    } else if (op === "pow2") {
      const v = (1n << num(0)) + num(1);
      if (v < 0n) out.push(`FAIL pow2 ${rest.join(" ")} is negative`);
      else out.push(`dec ${v}`);
    } else if (op === "ones") {
      const v = (1n << (32n * num(0))) - 1n + num(1);
      if (v < 0n) out.push(`FAIL ones ${rest.join(" ")} is negative`);
      else out.push(`dec ${v}`);
    } else if (op === "alt") {
      const limbs = Number(num(0));
      let v = 0n;
      for (let i = 0; i < limbs; i++) v = (v << 32n) | (i % 2 === 0 ? U32 : 0n);
      out.push(`dec ${v}`);
    } else if (op === "word") {
      const limbs = Number(num(0));
      let v = num(1) & U32;
      for (let i = 1; i < limbs; i++) v = (v << 32n) | (num(2) & U32);
      out.push(`dec ${v}`);
    } else if (op === "rand") {
      out.push(`dec ${randomBits(Number(num(0)))}`);
    } else if (op === "mul") {
      const v = num(0) * num(1) + num(2);
      if (v < 0n) out.push(`FAIL mul ${rest.join(" ")} is negative`);
      else out.push(`dec ${v}`);
    } else {
      out.push(`FAIL unknown op ${op}`);
    }
  } catch (e) {
    out.push(`FAIL ${op}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

out.push(`DONE ${n}`);
console.log(out.join("\n"));
