// ML-KEM-768 vectors, generated fresh on every run.
//
// **The one oracle in this package that has to be Deno.** Node 22's WebCrypto rejects
// `encapsulateBits` as a key usage, and the OpenSSL on this box is 3.0, which has no ML-KEM at all
// — so `test/oracle.mjs`, which is Node, cannot answer this. Even OpenSSL 3.5 could not: its CLI
// will not export a key's *seed*, and the seed is what makes the comparison byte-for-byte rather
// than merely interoperable.
//
// Batched like every other oracle here: read every line, answer, then `DONE <n>` so a run that
// stopped halfway is not mistaken for agreement.
//
//   mlkemvec <rounds>   →  one `mlkemvec <seed> <ek> <ct> <ss>` line per round, all hex

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** WebCrypto's ML-KEM-768, with the not-yet-typed method narrowed. */
const subtle = crypto.subtle as unknown as {
  encapsulateBits(
    a: unknown,
    k: CryptoKey,
  ): Promise<{ ciphertext: ArrayBuffer; sharedKey: ArrayBuffer }>;
};

const SEED = 64, EK = 1184;

async function vector(): Promise<string> {
  const kp = await crypto.subtle.generateKey(
    { name: "ML-KEM-768" } as AlgorithmIdentifier,
    true,
    ["encapsulateBits", "decapsulateBits"] as unknown as KeyUsage[],
  ) as CryptoKeyPair;
  const seed = new Uint8Array(await crypto.subtle.exportKey("raw-seed" as "raw", kp.privateKey));
  const ek = new Uint8Array(await crypto.subtle.exportKey("raw-public" as "raw", kp.publicKey));
  const enc = await subtle.encapsulateBits({ name: "ML-KEM-768" }, kp.publicKey);
  if (seed.length !== SEED) throw new Error(`expected a ${SEED}-byte seed, got ${seed.length}`);
  if (ek.length !== EK) throw new Error(`expected a ${EK}-byte key, got ${ek.length}`);
  return `mlkemvec ${hex(seed)} ${hex(ek)} ${hex(new Uint8Array(enc.ciphertext))} ${
    hex(new Uint8Array(enc.sharedKey))
  }`;
}

const input = new TextDecoder().decode(
  new Uint8Array(await new Response(Deno.stdin.readable).arrayBuffer()),
);
const lines = input.split("\n").filter((l) => l.length > 0);
const out: string[] = [];
for (const line of lines) {
  const [op, ...rest] = line.split(" ");
  if (op === "mlkemvec") {
    for (let i = 0; i < Number(rest[0]); i++) out.push(await vector());
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}
out.push(`DONE ${lines.length}`);
console.log(out.join("\n"));
