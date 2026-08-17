// keccak256 in TypeScript, so the trie oracle beside it shares nothing with the code it checks.
//
// This did not exist before, and its absence was written into `proof_wac.test.ts` as a limitation: *"They
// share `keccak256`, which is anchored to three published vectors of its own — and could not be otherwise,
// since a trie root **is** a keccak256."* The "could not be otherwise" was true of the arrangement rather
// than of the problem — the builder ran in TypeScript and reached into wac for the one primitive it lacked,
// because `node:crypto` has SHA-3 and not keccak256, and neither does OpenSSL here (`KECCAK-KMAC-*` is a
// different thing). Once the *tests* moved to wac and the builder became a subprocess, the shared symbol was
// the only thing left tying the two halves together, and forty lines removes it.
//
// So the oracle is now independent all the way down: its own RLP (`rlp.ts`), its own trie (`trie.ts`), its
// own permutation. Two things anchor it. Ethereum's seven published roots in `vendor/trieanyorder.json`
// would catch a broken permutation, but illegibly — "the `dogs` root is wrong" has four suspects in it — so
// `test/wac/proof_test.wac` also asks the oracle for `keccak256("")` and `keccak256("abc")` directly and
// checks both against the published digests *and* against `packages/crypto`, whose own side of the same two
// values is pinned in `packages/crypto/test/wac/keccak_test.wac`.
//
// Written for clarity rather than speed: `bigint` lanes, one permutation per node, a few thousand nodes.

const MASK = (1n << 64n) - 1n;

const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rotation offsets, indexed `[x][y]` as the specification tabulates them. */
const R: number[][] = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const rotl = (x: bigint, n: number): bigint =>
  n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

/** Keccak-f[1600] on 25 lanes in place, lane `x + 5y`. */
function permute(a: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    // θ — each column's parity, folded into the columns either side of it.
    const c: bigint[] = [];
    for (let x = 0; x < 5; x++) c.push(a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20]);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) a[x + 5 * y] ^= d;
    }
    // ρ and π — rotate each lane, then move it.
    const b: bigint[] = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y], R[x][y]);
    }
    // χ — the only non-linear step, along each row.
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        a[x + 5 * y] = b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y] & MASK) & b[(x + 2) % 5 + 5 * y]);
      }
    }
    // ι — break the round's symmetry.
    a[0] ^= RC[round];
  }
}

/**
 * keccak256, which is the original padding rather than SHA-3's.
 *
 * The single byte of difference — `0x01` here, `0x06` in SHA-3 — is the whole reason `node:crypto` cannot
 * stand in for this, and it is the mistake worth naming: a digest that looks like SHA3-256 and is not.
 */
export function keccak256(input: Uint8Array): Uint8Array {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const a: bigint[] = new Array(25).fill(0n);
  for (let at = 0; at < padded.length; at += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[at + i * 8 + b]);
      a[i] ^= lane;
    }
    permute(a);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = a[i];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}
