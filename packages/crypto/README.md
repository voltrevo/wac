# crypto

The hashes, AEADs, curves and one KEM the rest of this repo is built on — written in wac, calling
nothing. `packages/platform` gives a program `randomBytes` and no algorithms, so a protocol written
entirely in wac has nowhere else to get a digest or a key exchange from: `ssh`, `tls`, `tor`, `ssz`,
`bls`, `mpt`, `ens`, `ethrpc` and `box` all get theirs here. [Status](#status) lists every one with its spec
and how far it goes; the sections after it explain the parts of each that are not obvious.

Two things to read before the code. [Testing](#testing) — two oracles, because one is not enough,
and most of the suite is written in wac rather than TypeScript. [Side channels](#side-channels) —
a measurement rather than a disclaimer, which is what the warning below rests on.

> **Not for production.** Five of the routines measured below are known to leak — including
> the scalar multiplication behind every P-256 and P-384 operation — and the rest are
> uniform only at the level this can measure. See [Side channels](#side-channels) — that section
> is now a measurement rather than a disclaimer, but the conclusion is unchanged: do not
> use this where an attacker can observe timing.

A package of [wac](../../README.md) — see the root README for layout and how
to run things. All commands run from the repo root.

```wac
import { sha256 } from "../../crypto/src/sha256.wac";
import { sha512, sha384 } from "../../crypto/src/sha512.wac";
import { hmacSha256 } from "../../crypto/src/hmac.wac";
import { hkdf } from "../../crypto/src/hkdf.wac";
import { bcryptPbkdf } from "../../crypto/src/bcryptpbkdf.wac";
import { chacha20 } from "../../crypto/src/chacha20.wac";
import { aeadEncrypt, aeadTag, aeadDecrypt } from "../../crypto/src/aead.wac";
import { aesEncrypt, aesDecrypt } from "../../crypto/src/aes.wac";
import { aesCtr } from "../../crypto/src/aesctr.wac";
import { gcmEncrypt, gcmTag, gcmDecrypt } from "../../crypto/src/aesgcm.wac";
import { x25519, x25519Base } from "../../crypto/src/x25519.wac";
import { ed25519Sign, ed25519Verify, ed25519PublicKey } from "../../crypto/src/ed25519.wac";

u8[] digest = sha256(msg);                     // 32 bytes
u8[] tag    = hmacSha256(key, msg);            // 32 bytes
u8[] okm    = hkdf(salt, ikm, info, 64);       // any length
u8[] kek    = bcryptPbkdf(pass, salt, 48, 16); // OpenSSH private-key encryption
u8[] ct     = chacha20(key, 1, nonce, msg);    // same call decrypts

u8[] sealed = aeadEncrypt(key, nonce, msg);
u8[] tag    = aeadTag(key, nonce, aad, sealed);
u8[] opened = aeadDecrypt(key, nonce, aad, sealed, tag);   // traps if forged

u8[] pub    = x25519Base(secret);              // 32-byte public key
u8[] shared = x25519(secret, theirPub);        // 32-byte shared secret

u8[] vk     = ed25519PublicKey(seed);          // 32 bytes
u8[] sig    = ed25519Sign(seed, msg);          // 64 bytes
bool ok     = ed25519Verify(vk, msg, sig);
```

## X25519

Curve25519 Diffie-Hellman, RFC 7748. `src/field25519.wac` is the arithmetic in
GF(2^255-19) — ten limbs alternating 26 and 25 bits, the same technique poly1305 uses
for GF(2^130-5) — and `src/x25519.wac` is the Montgomery ladder over it, transcribed
from RFC 7748 §5 in the RFC's own variable names so the two can be read side by side.

Three independent checks, because a ladder has no partial credit: the published vectors
including the 1000-iteration chain, a differential against WebCrypto's X25519 on random
keys in both directions, and the field operations against JavaScript BigInt over 270
values weighted toward limb and modulus boundaries. The field differential is what makes
this tractable to develop at all — a wrong ladder tells you only that one of two
thousand multiplications was wrong.

## Ed25519

RFC 8032, over the same field on the twisted Edwards curve. Points are kept in extended
coordinates, and the base point is derived from y = 4/5 rather than written out, so the
x-recovery is exercised on the one point everything else depends on.

Signing and verifying are tested separately rather than only round-tripped, which is not
pedantry: the first version signed all of RFC 8032's vectors correctly and failed to
verify two of the three public keys. `sqrt(-1)` had been computed one factor of two
short, which only affects point *decoding* — a path signing never takes. A sign-then-
verify test would have passed.

**2.3ms per signature and 2.2ms per verification**, 40 operations each on this machine. The
scalar multiplication is a plain 256-step double-and-add with no windowing, which is the
slowest reasonable choice and the easiest to read against the spec — and it is still six
times faster than this package's P-256 signing, for the reason `issues/system/0224` gives.

This said "roughly 120 ms per signature" until 2026-08-20, which was true when it was
written and had been wrong by a factor of fifty since `issues/system/0209` found `ptAdd`
inverting a field element on every point addition. A timing figure in prose is a
measurement nothing re-takes.

## ML-KEM-768

`src/mlkem.wac` — FIPS 203, the post-quantum KEM formerly called Kyber. TLS 1.3 uses it
alongside X25519 in the hybrid group X25519MLKEM768, which carries a large share of real
HTTPS traffic today, so this is a deployed algorithm rather than a speculative one.

Smaller than it looks: everything is arithmetic mod q = 3329 on degree-256 polynomials,
so there is no bignum, no modular inversion and no curve with exceptional cases. Against
P-256 it is a much simpler object. The difficulty is entirely that the transform and the
sampling are silent when wrong.

The number-theoretic transform is *incomplete* — q−1 contains a 256th root of unity but
not a 512th — so X^256+1 factors into 128 quadratics and the pointwise multiply is a
degree-1 product, not a scalar one. Treating it as 256 independent products is the
mistake the structure invites, and it yields a key exchange where the two sides derive
different secrets. The 128 twiddle factors are computed, not transcribed.

**The oracle here is the strongest in the package.** WebCrypto exports an ML-KEM private
key as its 64-byte seed and FIPS 203 keygen is deterministic in it, so keygen is compared
*byte for byte* — 1184 bytes agreeing means SHA3-512, the seed split, the SHAKE128
rejection sampling, the CBD noise, the NTT, the matrix multiply and the twelve-bit
packing are all simultaneously right. Nothing weaker pins the NTT at all: it is an
internal representation, and two different transforms each work perfectly with
themselves.

## SHA-3 and SHAKE

`src/keccak.wac` — Keccak-f[1600] and the four functions FIPS 202 builds on it. Here
because ML-KEM is defined entirely in terms of them: the matrix is sampled from SHAKE128,
the noise from SHAKE256, and the key derivation uses SHA3-256 and SHA3-512. No amount of
SHA-2 substitutes.

The rho offsets and the pi permutation are *computed* from the spec's walk rather than
transcribed. FIPS 202 prints them as a 5×5 grid, and copying a grid of rotation amounts
into a flat array indexed the other way round is the classic way to produce a hash that
is wrong for every input. Deriving them is four lines and is the definition.

`node:crypto` is the oracle for all four, and it replaced a pair that was worse: WebCrypto has SHA3-256
and SHA3-512 but no SHAKE, so the extendable-output tests used to shell out to an OpenSSL 3.5 built from
source and mark themselves `ignore` when it was missing — green, and checking nothing. node has `shake128`
and `shake256` built in and synchronously, so every one of the four is checked on every run.

## keccak256

`keccak256` is Ethereum's hash and **not** SHA3-256: same permutation, same rate, same capacity, same
output length, and one byte of padding different — the original Keccak submission appends `0x01` where
FIPS 202 appends `0x06`. They agree on no input at all. Every address, ABI selector, ENS namehash and
Merkle-Patricia key is this function (wac-mono 0083, design/0003).

**Nothing on a normal machine implements it.** OpenSSL and node have SHA-3 and the SHAKEs; the original
padding predates the standard and no library ships it. So the test is three constants the Ethereum
ecosystem quotes constantly, at three message lengths — `c5d24601…` for the empty string, `56e81f17…` for the single byte
`0x80` (the empty trie root), and `a9059cbb` for the first four bytes of
`transfer(address,uint256)` — plus the argument that the machinery under them is already verified: the
sponge agrees with `node:crypto` for two *other* domain bytes, which pins the permutation, the rate
handling and the squeeze. What that cannot pin is the domain byte, and the empty message is the case where
it is the only thing the permutation sees.

The same test asserts keccak256 **disagrees** with both SHA3-256 and a SHAKE256 truncated to 32 bytes at
six lengths. One wrong padding byte gives a hash that is the right length, avalanches, and is silently the
other algorithm.

There is no streaming keccak256. `Sha3_256` hashes incrementally and hardcodes SHA-3's domain byte;
nothing here hashes a keccak256 input it cannot hold, so a second struct beside it would have no caller.

## RSA

`src/rsa.wac`, built on [bignum](../bignum/README.md) — verification only. Signing needs
the private key, and private-key RSA in a language with no constant-time story is a worse
idea than the rest of this package already is; verification touches only public values.

PKCS#1 v1.5 *and* PSS, because TLS 1.3 needs both for different things. RFC 8446 §4.4.3
forbids v1.5 in CertificateVerify — a peer must use PSS — while §4.4.2.2 allows it for
the signatures inside a certificate chain, which is how almost every certificate in the
world is signed.

The tests are mostly refusals. RSA's history is a list of verifiers that *searched* for
the padding structure instead of requiring it: Bleichenbacher's 2006 forgery worked
against implementations that parsed the DigestInfo rather than matching its bytes, and
against ones that stopped checking after finding the hash. So the DigestInfo prefix here
is a byte table to compare against, never something to parse.

About 170 ms per 2048-bit verification. `modPow` is square-and-multiply with a divmod
after each step; the exponent is public, so branching on its bits is the one place in
this package where the timing caveat genuinely does not apply.

## bcrypt_pbkdf

`src/bcryptpbkdf.wac`, on `src/blowfish.wac` — the KDF OpenSSH encrypts a private key
with, and the reason Blowfish is in a package that otherwise stops at AES. Blowfish is
here as a cost function, not as a cipher: bcrypt's value is that its key schedule rewrites
4 KB of state 129 times per hash with no parallelism available inside it, which a GPU is
far worse at than it is at SHA-512.

Three things about it are not PBKDF2, and each produces a plausible wrong answer rather
than an obvious one:

- the hash writes its output **little-endian**, against big-endian everywhere else in
  Blowfish — a bug in the original that became the standard;
- key material is written **striped**, so block *n* supplies every *stride*-th byte rather
  than a contiguous run, and getting it wrong yields the right bytes in the wrong places;
- only round 1 salts with the salt — later rounds salt with the previous round's output.

**The oracle is OpenSSH.** There is no WebCrypto equivalent and no vector I would trust
myself to transcribe, so the test derives the key for a private key that `ssh-keygen` has
actually written and decrypts it. That is stronger than a vector: the private section
opens with the same random 32-bit value twice, and since the cipher is AES-CTR a key wrong
in any bit gives an unrelated keystream, so the two agree only by a 2^-32 accident. The
embedded public key is then matched against the `.pub` file, which reaches far enough into
the stream to cover the IV as well. Run across both cipher choices, so both the striped and
the single-block output paths are covered.

The 1042 words of Blowfish tables are the fractional hex digits of pi, generated by
Machin's formula in exact integer arithmetic and checked against the three values everyone
publishes, rather than transcribed — a transcription error in 1042 constants is not
something review catches. See [The AES S-box, and a lesson about generated
tables](#the-aes-s-box-and-a-lesson-about-generated-tables) for why that is the house
style.

About 10 ms per hash at the default 16 rounds, which is the intended order of magnitude.

## P-256 and P-384

`src/fieldp.wac`, `src/weierstrass.wac`, and `src/p256.wac` / `src/p384.wac`. A different
prime and a different curve shape from Curve25519, and both differences show:

- 2^255-19 is a power of two minus a small number, so a value that overflows folds back
  as one small multiply. The NIST primes are **Solinas** primes, chosen so reduction is a
  shuffle of 32-bit words with no multiplication at all. Neither trick works for the
  other prime.
- Curve25519's Montgomery ladder needs no addition law. A short Weierstrass curve has
  one, with exceptional cases: a point plus itself needs a different formula, and a point
  plus its negation gives the identity, which has no affine coordinates. Those cases are
  most of the extra code, and each is reached by ordinary inputs.

**One implementation, two curves.** P-256 and P-384 differ in their prime, their `b`,
their order and their base point, and in nothing else — same equation, same `a = -3`,
same formulas. So `weierstrass.wac` holds the curve arithmetic once and a field element
is an array of 32-bit limbs whose *length* picks the prime: eight for P-256, twelve for
P-384. The two curve files are constants and a named API.

**The reduction is derived rather than transcribed.** FIPS 186-4 prints a table per curve
— nine terms for P-256 in D.2.3, ten for P-384 in D.2.4 — as a grid of product-word
indices to permute and add, printed most-significant-word first. Transcribing one, and
reversing it while you do, is how you get an implementation that is wrong for every
input. Instead this uses the single fact those tables are derived from:

    2^256 = 2^224 - 2^192 - 2^96 + 1        2^384 = 2^128 + 2^96 - 2^32 + 1

which is just `p` rearranged, and folds the product's top half down one word at a time.
Slightly slower than the flat table and checkable against `p` by eye. It replaced the
transcribed P-256 table, and every existing P-256 test passed unchanged — which is the
only reason to believe the derivation.

The one subtlety is the leftover: carry propagation leaves a signed multiple `k` of
2^(32n), and a negative `k` folded by subtraction can borrow, producing another negative
`k`, forever. Since `k*fold` and `k*fold + |k|*p` are congruent, a negative `k` is folded
as `|k| * (p - fold)` instead — positive, because `0 < fold < p` for both primes.

Checked against BigInt for the field and WebCrypto for ECDH and ECDSA, in both
directions. ECDSA is randomised, so "our signatures verify in WebCrypto" is a separate
test from "we verify theirs" — there is no byte-identity to compare, unlike Ed25519.

P-384 exports verification only; there is no P-384 key exchange in this stack and signing
would need a use for it. Its tests are aimed at the generalisation rather than at a second
implementation: if twelve limbs work as well as eight, the shared code is genuinely
generic.

**2.5ms per P-256 scalar multiplication** — a public key or an ECDH — and 13.7ms per
signature, which is a different story: eleven of those milliseconds are the arithmetic
modulo the group order, not the curve. `issues/system/0224`.

This said "roughly 37 ms" until 2026-08-20. Same as the ed25519 figure above: written
from a measurement, then left alone while the code got fifteen times faster.

A caller checking for the all-zero shared secret, as RFC 7748 §6.1 permits, gets it: a
low-order point multiplies to the identity and encodes as zero. This package does not
reject those itself, because whether that is an error depends on the protocol above.

## SHA-1

`src/sha1.wac`. Nothing should choose it: collisions are practical, and have been since
SHAttered in 2017. It is here because Tor's relay cell protocol specifies it for the
running digest that authenticates a circuit's cells, and a client that wants to talk to
the network implements what the network speaks.

The interface is incremental rather than one-shot, and that is the point of it. Tor's
digest is a *running* hash over every cell sent in one direction, with each cell carrying
the first four bytes of the hash so far — so the state survives between cells and has to be
readable without ending the stream. `peek` clones and finalises a copy; an implementation
that finalised in place would give a correct first answer and rubbish after it.

Three of its four round constants are written in decimal, for the same reason as the
NIST primes: a hex literal in [2^31, 2^32) is sign-extended when the target is wider, so
`0x8F1BBCDC as! u32` traps while `0x5A827999` is fine (wac issue 0054).

## Status

| Piece | Spec | State |
|---|---|---|
| SHA-256 | FIPS 180-4 | done |
| SHA-512, SHA-384 | FIPS 180-4 | done |
| HMAC-SHA-256 | RFC 2104, FIPS 198-1 | done |
| HKDF-SHA-256 | RFC 5869 | done, extract and expand separately |
| ChaCha20 | RFC 8439 | done, 32-bit counter / 96-bit nonce |
| Poly1305 | RFC 8439 | done, 26-bit limbs |
| ChaCha20-Poly1305 | RFC 8439 §2.8 | done |
| AES-128/192/256 | FIPS 197 | done, encrypt and decrypt |
| AES-CTR | SP 800-38A | done, full 128-bit counter |
| GHASH | SP 800-38D §6.4 | done |
| AES-GCM | SP 800-38D | done, any IV length |
| SHA-3, SHAKE128/256 | FIPS 202 | done |
| keccak256 | the original Keccak padding | done |
| SHA-1 | FIPS 180-4 | done, incremental — for Tor's relay digest |
| bcrypt_pbkdf, Blowfish | OpenSSH's KDF | done |
| X25519 | RFC 7748 | done |
| Ed25519 | RFC 8032 | done, sign and verify |
| P-256 | FIPS 186-4, SEC 1 | done, ECDH and ECDSA |
| P-384 | FIPS 186-4, SEC 1 | verification only |
| RSA | RFC 8017 | verification only, PKCS#1 v1.5 and PSS |
| ML-KEM-768 | FIPS 203 | done |

This table is what the package is, rather than what one milestone set out to cover — it said the
latter for a while and listed eleven rows while the package had grown to twenty-seven source files,
which reads as a smaller package that finished rather than a larger one still going.

### GHASH, and testing field arithmetic without vectors

GF(2^128) multiplication is where GCM hides. The bit order is reversed from the
obvious one — the *most* significant bit of the first byte is the coefficient of
x^0 — which is why the reduction constant appears as `0xE1...` at the top of the
high word rather than `0x87` at the bottom of the low word.

After the S-box, the lesson was that spot values do not catch a subtly wrong
table, and the same applies to a subtly wrong field. So GHASH is checked
*algebraically*, on properties no single vector can fake:

- **bilinear**: `H·(X ⊕ Y) = H·X ⊕ H·Y`, over 300 random triples
- **has the right identity**: `0x80 00…00` is 1 in this bit order
- **commutative**: `A·B = B·A`

Any of those fails immediately if the reduction constant or the bit order is
wrong, and they exercise the reduction path far more than a vector list does.

### The branch a test suite cannot reach

GCM's counter increments only the low 32 bits and *wraps* there; a carry into the
upper 96 bits would be wrong. Reaching that through `gcmEncrypt` needs 2^32
blocks, so it is unreachable in a test — and a mutation that carries all 128 bits
passed every other test in the package.

`gcmInc32` is therefore exported purely so the wrap can be pinned directly. That
is a real trade — an internal in the public surface — taken because the
alternative is an untested branch in security code of exactly the kind that is
wrong in real implementations.

### The AES S-box, and a lesson about generated tables

The S-box is generated from its definition (inverse in GF(2^8), then the affine
map) rather than transcribed, for the same reason SHA-512's constants are: 256
values is well past where a typo and a bug look alike.

The generator was wrong on the first attempt. Exactly one entry — S[0x01] — came
out as 0x63 instead of 0x7c, because an index into the antilog table needed to be
taken modulo 255 and only the input 1 reaches that case. Three spot checks
(0x00, 0x53, 0xFF) all passed straight over it.

The result was a cipher that was *right for most inputs and wrong for some*:
AES-128 matched 5 of 8 random vectors against WebCrypto. That is the worst way
for a cipher to be wrong, and a fixed-vector test can easily miss it — FIPS
197's C.1 happened to pass.

What catches it is a structural invariant rather than more spot values. The
generator now asserts the table is a permutation of 0..255 and that it is
mutually inverse with INV_SBOX, either of which fails immediately on a single
wrong entry.

### What SHA-512 is for

It is SHA-256 in 64 bits — same compression shape, wider words, 80 rounds, a
128-byte block, different rotation amounts. It earns its place as much for
exercising `u64` end to end as for the algorithm, and it did: writing it beside
SHA-256 surfaced two compiler bugs, one of them serious.

Both files declare private helpers called `rotr`, `ch` and `maj`, at 32 and 64
bits. The compiler resolved a bare function name through a global map, so
SHA-512's calls bound to SHA-256's functions. Differing widths turned that into
a wasm validation failure; at equal widths it would have been a wrong answer
with no error at all. `~` on a `u64` also emitted the 32-bit instruction. Both
are fixed upstream with regression tests.

SHA-384 is not a truncated SHA-512 — the initial state differs precisely so one
is not a prefix of the other, and a test asserts exactly that.

### Poly1305 and limbs

Poly1305 works modulo 2^130 − 5, so it needs multi-word arithmetic. The split is
five limbs of 26 bits, and the reason is arithmetic rather than taste: the
multiply forms five sums of five limb products with a factor of 5 on the folded
terms, so the widest accumulator reaches 5 · (2^26−1)² · 5 ≈ 1.1e17 against a
u64's 1.8e19 — about 164× of headroom, which is what allows carries to be
deferred to the end of the multiply instead of propagated inside it. 32-bit
limbs would not work: two of those fill a u64 exactly, leaving nothing to sum
into.

It is the one part of this package that needs `u32` and `u64` *together*, and
several steps depend on unsigned semantics directly — the borrow detection is
`(g4 >> 31) - 1` relying on both a logical shift and the wrap of 0 − 1 to
all-ones.

## Why these read the way they do

These algorithms are *defined* in unsigned terms — rotate, logical shift right,
addition modulo 2^32 — so with `u32` they transcribe almost line for line from
the standards. Written over `i32` the same code needs `>>>` for every rotate and
care at every comparison, and it is no longer obviously the spec. ChaCha20 is
the clearest case: no tables, no field arithmetic, just sixteen `u32` words.

Two places wac's shape shows through:

- **No module-level constants.** SHA-256's 64 round constants come from a
  function that builds an array. It is called once per digest rather than once
  per block, or a long message would rebuild the table every 64 bytes.
- **No multiple returns and no out-parameters.** ChaCha20's quarter round takes
  four *indices* into the state array rather than four words, because the array
  is the only way to hand four values back.

## Testing

**Most of the suite is written in wac**, in `test/wac/`, with the host supplying
only what it must — see [`wactest`](../wactest/) for the shapes that takes. What
remains in a `.test.ts` is there for one of three reasons, each stated in the
file:

- **it asserts a refusal.** A rejection here is a `trap`, and a trap unwinds the
  module rather than returning, so only the host can catch one. Every remaining
  TypeScript file in this package is refusals and nothing else.
- **it needs an outside reference to see a wrong *representative*.** The field
  differentials against BigInt — `field25519`, `p256`, `p384`, `rsa`'s modPow.
  A value congruent to the right one satisfies every relation the arithmetic can
  state about itself, so no in-language property reaches it. `field25519.wac`'s
  laws, its modulus anchors and forty boundary values all pass when the carry is
  one pass short; BigInt catches it on the first comparison.
- **it is too slow to pay on every run**, like X25519's thousand-iteration
  vector.

Two oracles, because one is not enough.

**The host.** `node:crypto` rather than WebCrypto, because a wasm call cannot
await a promise and node's equivalents are synchronous — which is what lets them
be passed into a wac test as a callback. It does SHA-2, HMAC, AES, ChaCha20-Poly1305,
SHA-3 and SHAKE, X25519, Ed25519, ECDSA and RSA, so those are compared
against it over every message length through two blocks, over key lengths that
straddle the 64-byte block boundary, and over random inputs. That covers far
more ground than a vector list, and catches padding mistakes at 55/56/63/64
bytes where they hide.

**The published vectors.** FIPS 197 appendices B and C for AES at all three key
sizes, SP 800-38A F.5.1 for CTR, the McGrew–Viega GCM cases 1–6, NIST for SHA-256 and SHA-512 including the
million-`a` case for both,
RFC 4231 for HMAC including the 131-byte key that forces the hash-the-key path,
RFC 5869 for HKDF including the empty-salt case, RFC 8439 for ChaCha20, Poly1305
and the full AEAD worked example. These matter because an oracle sharing a bug
would hide it, and because ChaCha20 and Poly1305 have no host implementation to
compare against at all.

**A BigInt reference**, for Poly1305 specifically. Its whole difficulty is the
limb arithmetic, and none of that exists when the modular arithmetic can just be
written down — so `test/oracle.mjs` carries a transparently-correct
reference and `test/wac/aead_test.wac` fuzzes the fast version against it over 400 random key/message
pairs plus saturated all-ones inputs, which is where carries propagate the full
width and the final conditional subtract fires. Fixed vectors leave most of
those paths untouched. This also caught a mis-transcribed expected value: one
hand-typed vector disagreed, and the implementation was right.

**Properties, in wac** (`test/wac/crypto_test.wac`). A vector proves one input
maps to one output; it says nothing about whether the construction depends on
everything it should. These check that a one-bit input change moves most of the
digest, that padding binds the message length, that HMAC depends on its key and
takes a different path at 64 versus 65 bytes, that ChaCha20's counter changes
the keystream and decryption undoes encryption, and that HKDF binds `info` and
produces a prefix-stable expansion.

For the AEAD the tamper cases carry the weight: an implementation that encrypts
correctly but authenticates nothing passes every round-trip test. Flipping a bit
in the ciphertext, the associated data, the tag, the key or the nonce is
rejected, as is a truncated ciphertext and a short tag — and moving a byte
across the aad/ciphertext boundary, which is exactly what the trailing length
fields in the MAC input exist to prevent.

WebCrypto has no raw block cipher, but AES-CTR with counter block B over an
all-zero plaintext returns E(B) — so the host is an oracle for the primitive
itself, not only for the mode. It does implement AES-GCM, so that whole
construction is compared against it across key sizes, AAD sizes and message
lengths — but only at a 96-bit IV, since WebCrypto rejects every other length.
The GHASH-derived `J0` path therefore has no host oracle and rests on the
published 64-bit and 480-bit IV vectors.

Verified by mutation. In GHASH and GCM: the reduction constant `0xE1` → `0x87`
fails 4 tests, reversing the bit order in the low word 6, masking the tag with
`E(inc32(J0))` instead of `E(J0)` four, a length field in bytes rather than bits
4, and the counter carrying past 32 bits 2 — that last one caught *nothing*
until the test above was added, which is why it is there. In AES: the GF
reduction polynomial 0x1B → 0x1D fails 6 tests, swapped MixColumns coefficients 7, ShiftRows off by one 7, AES-192's
round count 12 → 11 four, and the Rcon index off by one 6. Changing one SHA-256
rotation constant from 25 to 26 fails 11 tests; one ChaCha20 quarter-round rotate from 7 to 8 fails 4. In Poly1305:
the fold factor 5 → 4 fails 5, a loosened clamp mask fails 5, the high bit at
the wrong limb position fails 6, and the borrow-detect shift 31 → 30 fails 4 —
with a no-op edit failing none, so those are measuring behaviour rather than
broken compilation.

## Side channels

`test/wac/constanttime_test.wac` runs each routine twice with different secrets and the same
public input, and compares the ordered sequence of **branches taken and memory indices
used**. Both matter: a secret-dependent branch is the obvious leak, and a secret-dependent
*index* has no branch at all — `SBOX[key_byte]` touches a cache line chosen by the key,
which is how AES keys have been recovered from cache timing since 2005.

| routine | events per run | result |
|---|---:|---|
| `sha256` | 1,543 | uniform |
| `chachaBlock` | 510 | uniform |
| `poly1305` | 140 | uniform |
| `x25519Base` | 1,812,173 | uniform |
| `ed25519Sign` | 7,399,082 | uniform |
| `ghash` | 484 | uniform |
| `aesExpandKey` | 516 | **leaks** — secret-dependent index at `aes.wac:129`, `aes.wac:130`, `aes.wac:131`, `aes.wac:132` |
| `aesEncrypt` | 9,475 | **leaks** — secret-dependent index at `aes.wac:129`, `aes.wac:130`, `aes.wac:131`, `aes.wac:132`, `aes.wac:165` |
| `p256PublicKey` | 8,190,814 | uniform |
| `p256Sign` | 8,456,980 | uniform |
| `kemDecapsSecret` | 1,023,945 | uniform |
| `bcryptPbkdf` | 8,177,005 | **leaks** — secret-dependent index at `blowfish.wac:45`, `blowfish.wac:46` |

**The event counts changed on 2026-08-12 and the verdicts did not.** These are wacc's
figures now (wac issue 0105): it instruments a slightly different set — an `else` point
for an `if` that has none, and the right-hand side of a short circuit — so the numbers are
not comparable with the ones printed here before that date. What each routine *is* did not
move.

The x25519 row is the one worth reading twice: the ladder is uniform across every one of
1.6 million events, which is what "structurally uniform" was claiming without evidence.

**And the P-256 row is the one to read beside it**, because the two started as the same
shape of routine with opposite answers. `x25519`'s ladder does the same work whatever the
bit is; `weierstrass.wac`'s `jacMul` used to add only when the bit was set:

```wac
for (i32 i = 0; i < bits; i++) {
  acc = jacDouble(c, acc);
  i32 bit = (scalar[i / 8] >> (7 - (i % 8))) & 1;
  if (bit == 1) { acc = jacAdd(c, acc, p); }     // weierstrass.wac:120, until 2026-08-20
}
```

The scalar there is the private key in `curvePublicKey` and `curveEcdh`, and the **nonce**
in ECDSA signing, where leaking bits of the nonce recovers the key rather than merely
revealing it. It was measured for the first time on 2026-08-19 — the table above had no
asymmetric row at all until then, and its silence read as "not applicable" rather than
"not measured", which is the failure this section exists to avoid. `issues/system/0210`.

**The ladder was fixed on 2026-08-20, and fixing it revealed the layer underneath.** `jacMul`
adds on every bit and keeps the answer with a constant-time select; `jacAdd` and `jacDouble`
compute their exceptional cases and select between them rather than branching to them. The
trace then parted one layer down, at `reduceWide` in `fieldp.wac`, which skipped a word of
the product when it happened to be zero and folded the leftover carry a number of times that
depended on its value. That was always there: `ctcompare` reports the *first* divergence, and
while the ladder parted at the first differing scalar bit nothing behind it could be seen.
`issues/system/0223` is that one, and it is fixed too — the conditional subtractions compute
both answers and select, `lessThan` is gone from the reduction path because its loop returned
early on the first differing limb, and the carry fold runs a fixed four passes instead of
until it is done.

So `p256PublicKey` is **uniform over 8,190,814 events**, which is the whole of a P-256
scalar multiplication.

**And `p256Sign` was not, at `weierstrass.wac:276`, which was the same defect a third time.**
The multiplication modulo the group *order* — a different field from the coordinates — was
byte-at-a-time double-and-add, adding only when the bit was set. Signing put the private key
in that operand, and the nonce in it again through the inversion, whose squarings are the same
routine over a base derived from the nonce. Both secrets a signature has passed through it.
`issues/system/0224`.

It adds on every bit now and keeps the answer with a mask — and then the whole byte-wise
implementation was replaced, because making it constant-time on bytes cost 1.86× and the
layout was the real problem. `packages/crypto/src/scalarn.wac` is Montgomery multiplication
over 32-bit limbs, and it is **8,456,980 events, uniform, and 5.5× faster than the
variable-time byte version it replaced**. A signature is 2.4ms against 13.2ms.

**`cmpBE` was in there too, and no measurement caught it.** It returned on the first byte that
differed, so how many bytes it read was a function of the value — and `curvePublicKey` and
`ecdsaSign` both call it on the secret, to check it is below n. The table said
`p256PublicKey` was uniform over 8.19 million events while that was still true of it, because
both secrets the tool compares differ from n in their *first* byte, so both runs left the loop
at i=0 and agreed. **A differential is only as wide as its inputs**, and this one was found by
reading rather than by measuring. It reads every byte now, which is the 89 extra events in the
`p256PublicKey` row.

**The signing row was missing until 2026-08-20, and that is the finding rather than the leak.**
The table had `p256PublicKey`, which does not call `scMul` at all — so the routine most worth
measuring was the one not measured, and a public key leaking its private key is bad where a
signature leaking its nonce is worse, because a partial nonce leak recovers the key from
signatures the attacker already holds. The row that mattered most was missing because the row
that was easiest to add went in first.

## What the two fixes cost

**The field reduction**, 120 operations each on one program:

| | before | after |
|---|---:|---:|
| `p256PublicKey` | 2.08ms | 2.37ms |
| `p256Sign` | 12.9ms | 13.0ms |

Fourteen per cent on the scalar multiplication, and events per run 6,266,534 → 8,190,725. The
earlier fix — the ladder itself — cost 1.3ms → 2.0ms against a prediction that it would "put
P-256 near ed25519's number", which it did not come close to doing.

**The order arithmetic went the other way, in two steps.** Making the byte-wise version
constant-time cost 1.86×; replacing it with limbs and Montgomery multiplication paid that back
and more. Three A/B rounds each, with `ed25519Sign` as a control that does not touch this code:

| | bytes, leaking | bytes, constant-time | limbs, constant-time |
|---|---:|---:|---:|
| `p256PublicKey` | 2.52ms | 2.50ms | 2.48ms |
| `p256Sign` | 13.2ms | 24.9ms | **2.4ms** |
| `p256Verify` | 15.7ms | 26.9ms | **4.6ms** |
| `ed25519Sign` (control) | 2.4ms | 2.3ms | 2.3ms |

Traced events for a signature: 35.8 million, then 92.9 million, then 8.46 million.

**So the constant-time version is 5.5× faster than the variable-time one it replaced**, which is
the outcome worth aiming for and the reason the middle column was never going to be the end of
it. Verification has no secret in it at all — `ecdsaVerify` inverts `s` and multiplies by `r`
and the digest scalar, every one of which is on the wire — so its middle column was pure loss,
and paying it for one commit was preferable to keeping a second faster copy of the arithmetic
selected by whether the caller believes its operands are public. That is how a fast path ends up
on a secret.

`p256Sign` at 2.4ms is now `ed25519Sign`'s 2.3ms, which was the anomaly
`issues/system/0209` was opened about.

**Signing not moving when the field was fixed is what led to all of the above.** The scalar
multiplication was 2.4ms of a 13.2ms signature, so eleven milliseconds were always somewhere
else — and "somewhere else" turned out to be one function that was both the leak and the cost.
A fix measured only against the thing it was aimed at would have reported success and left
both.

**`ed25519Sign` and ML-KEM were added on 2026-08-20, and both were the same story again: the
routine that holds the secret was not the routine with the row.**

The table had `x25519Base` and no signing row. A uniform ladder is a fact about a ladder —
`ed25519Sign` reduces `sha512(prefix ++ msg)` modulo L, where `prefix` is half the secret key
expansion, and that is a different scalar, a different modulus and a different piece of
arithmetic. `scReduce` compared with an early return, so *how many bytes it read* was a
function of the nonce, and its subtraction was conditional on top. Two seeds parted at
`ed25519.wac:334`. `issues/system/0225`.

The subtraction decides for itself now — `r - shifted` wraps exactly when `r < shifted`, so the
borrow out answers the comparison's question and the comparison is gone. **It costs 2.8% more
rather than less**, which was measured after the code comment had already claimed less: traced
events for one signature went 7,199,946 to 7,399,146. Events rather than milliseconds because
the machine was busy enough that an unchanged control routine swung by half.

**The file's own header had been pointing at the wrong place.** It said the leak was that
"signing branches on scalar bits in the double-and-add" — and `ptMul` adds on every bit and
selects, and has for as long as anyone has looked. A header naming a leak that is not there is
worse than one naming none, because it answers the question a reader was about to ask.

**ML-KEM had no row at all**, and had two leaks and one false alarm.

`mod` reduced with `r < 0 ? r + q() : r` — a ternary, which is a branch, at fourteen call sites
inside the NTT and the polynomial arithmetic. During decapsulation those coefficients are the
decrypted message and the key's noise. **Flipping one bit of a ciphertext parted the two traces
there**, at event 1,067,742, a million events before the implicit rejection the whole
construction rests on. And that rejection was itself a ternary on `diff == 0` — one bit, and the
bit that Fujisaki-Okamoto exists to hide. Both are masks now, each canaried separately, and a
valid and an invalid ciphertext are identical over 1,528,880 events. `issues/system/0226`.

**The false alarm is the part worth reading.** The first key-variation row reported a divergence
at `mlkem.wac:201`, the rejection-sampling loop in `sampleNTT` — whose trip count depends on ρ,
and **ρ is published inside the encapsulation key**. Two seeds are two different public keys, so
the traces differ for a reason an attacker gets by reading `ek` rather than by timing anything.
Holding the ciphertext fixed did not help: decapsulation re-encrypts, which re-samples the matrix
from the ρ carried inside `dk`, and **a decapsulation key determines its own public key**. There
is no pair of ML-KEM keys with the same public data.

So the row varies the secret vector inside one fixed keypair — `dk`'s first 1152 bytes, leaving
`ek`, its hash and z alone — which is the comparison the question actually names, and is uniform
over 1,023,945 events. The resulting key is not one `mlkemKeyGen` would produce and is a valid
*input*, which is all the measurement needs.

Two lessons, and the second is the one that generalises: a differential that varies "the key"
varies whatever the key determines, and for a KEM that includes public data. A row reading
**leaks** for that is worse than no row, because expected noise is where the next real finding
hides.

**And one thing this table cannot see.** `mod` still computes `a % q()` — a remainder by a
constant, on secret data. Whether that costs data-dependent time is a property of how the engine
compiles `i32.rem_s`; `wac build --trace` records branches taken and array indices, not how long
an arithmetic instruction took, so a uniform row here is a claim about control flow and memory
access and not about arithmetic timing. Real ML-KEM implementations use Barrett reduction for
exactly this reason. Named because a clean row should not be read as more than it is.

**AES leaks in exactly five places, and that is now the whole of it.** Four are the key
schedule's `SubWord` lookups (`aes.wac:129`–`132`) and the fifth is `SubBytes` itself
(`aes.wac:165`), each indexing the S-box with a key-derived byte — index 0 for an all-zero key
against 255 for an all-ones one. That is the 2005-era cache-timing attack, it is what a
table-driven AES *is*, and the only answer is a bitsliced S-box.

**Until 2026-08-20 there was a sixth thing and it was hiding the answer.** `xtime`'s conditional
reduction was a *branch*, at `aes.wac:66`, and `--all` stops at a split because past one the two
journals are not aligned and every later difference is an artefact of the misalignment. So the
row said "nothing past that point has been examined" and nobody could say whether the five index
sites were all of it. `xtime` masks now — `s ^ (0x1B * ((a & 0x80) >> 7))` — and the whole trace
is examined: **the same five sites and no others.** A weaker leak was concealing the strength of
the claim about the stronger one.

It is also 2,304 events cheaper, which is the branch points that went.

**`ghash` was the other half of AES-GCM and no longer leaks at all.** `gfMul` was shift-and-add
with the add taken only when the bit was set and the reduction applied only when a one fell off
the bottom — two branches per iteration, one over the accumulator and one over H itself, and
`ghash(h, data)` passes H as the multiplicand. **A leaked GHASH key is forgery**, not disclosure:
an attacker who knows H can authenticate a message they wrote. Both are masks now, and it went
740 events to 484 — exactly the 256 branch points the two `if`s contributed over 128 iterations,
so this one was free.

GCM as a whole is still not constant-time, because the block cipher under it is not. What changed
is that one of its two halves stopped depending on its key.

**`bcryptPbkdf` is measured now, and it was the row that was not a result.** The tracer
wrote into a buffer of 2^22 events fixed in the compiler; a single bcrypt hash is 129 full
Blowfish key expansions, and no parameter brings that under, since being expensive is the
entire point of the function. wac issue 0059 raised it: wacc's journal is sized by the
caller, and it counts the events it had no room for — so the first run reported **8,177,000
events**, `ct.ts` recompiled with a journal that holds them, and the second run produced a
verdict. Nothing was guessed and nothing was doubled-and-retried.

The verdict is the one predicted here before it could be taken: it leaks by construction
rather than by accident, at `blowfish.wac:45` and `:46` — the round function's four S-box
lookups, indexed with state derived from the password, which bcrypt then rewrites from the
password 129 times over. Cache-timing resistance was never among its goals, and a version
that had it would not be bcrypt. **Predicting a result is not measuring it**, which is why
the row stayed empty until it could be filled.

Regenerate this table with

```sh
wac run --allow-read --allow-write --allow-run packages/crypto/tools/ct.wac
```

**Every figure is one higher than the table this replaced**, and uniformly so: a run is now a small
program whose `main` calls the routine, and `main`'s own entry point is an event like any other. The
counts describe the program that was traced, which is what "events per run" says. `p256PublicKey` was
`~2,000,000` here for as long as the row existed, and named `weierstrass.wac:120` — a hand-written
number and a hand-written line in a generated table, because the tool had no case for it. It has one
now, and both are measured. Where a split is named, the wording is careful for the reason `ghash`'s row
shows: `ghash.wac:36` is where *one* run stood when the two stopped agreeing, and the point itself need
not be the one that depends on the secret.

It is generated rather
than hand-written because published figures that cannot be reproduced go stale silently —
which is what `issues/closed/0007` was about.

**What a uniform result does not mean.** The check is dynamic, so it covers the key pairs
tested and no others; it is wasm-level, so identical operations can still take different
time on hardware — `i64.div_s` latency depends on its operands, and the engine and CPU do
as they please; and it says nothing about values written, only about branches and
addresses. It is a necessary condition, not a sufficient one. A *failure* is definite.

**A static check was considered and declined** (2026-08-01). A `secret` qualifier on a
parameter, propagated by the type checker and refused at a branch or an index, would
cover every path rather than the inputs tested. It also needs declassification — a
ciphertext is key-derived and must become public somewhere — and an over-taint story, and
it wants the same machinery as putting `const` in the type. Not worth it for a package
that is not for production: the dynamic check finds the leaks that get written.

**Fixing the index leak** means removing the table, not moving it: either scan every entry
and select with an arithmetic mask (`0 - (i == want)` is all-ones or zero, no branch),
which costs O(n) per lookup, or bitslice the S-box so there is no table to index. wac does
not optimise, so a masked select survives compilation intact — which is the one place the
compiler being simple is a security property.
