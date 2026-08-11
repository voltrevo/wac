// The wac trust store against the TypeScript one that already worked.
//
//     deno test -A packages/tls/test/roots.test.ts
//
// `host/connect.ts`'s `pemBundle` has been building this store for every TLS test in the package, so
// it is an oracle rather than a second opinion: same input, byte-identical `der`, pair-identical
// `offsets`. What is new is only that a *wac* program can now build one, which is what
// `design/system/0005` step 6 needs — see `src/roots.wac`.
//
// The input is the real system bundle. That matters more than a fixture would: it is ~140
// certificates with wrapping the writer chose, human-readable names between blocks, and whatever else
// a distribution puts in there. A hand-written two-block fixture would agree with anything.

import { wacBind } from "../../../harness/wacBind.ts";
import { pemBundle as reference } from "../host/connect.ts";

const BUNDLE = "/etc/ssl/certs/ca-certificates.crt";

const have = await (async () => {
  try {
    await Deno.stat(BUNDLE);
    return true;
  } catch {
    return false;
  }
})();
if (!have) console.error(`tls roots tests: skipped — no ${BUNDLE}`);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const mod = await wacBind("packages/tls/src/roots.wac");
const pemBundle = mod.pemBundle as (pem: number[] | Uint8Array) => {
  der: number[];
  offsets: number[];
  refused: number;
};

Deno.test({
  name: "the system trust store, built in wac, is the one host/connect.ts builds",
  ignore: !have,
  fn: async () => {
    const text = await Deno.readTextFile(BUNDLE);
    const want = reference(text);

    // **The shape, asserted.** A bundle of one certificate would exercise none of what this is for:
    // not the second block, not the text between blocks, not the wrapping. Nor would an unwrapped
    // one — the whole reason the decoder cannot be handed the block verbatim is the line breaks.
    const blocks = want.offsets.length / 2;
    assert(blocks > 1, `${BUNDLE} holds ${blocks} certificate(s); this test needs more than one`);
    assert(
      /-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=]+\n[A-Za-z0-9+/=]/.test(text),
      "no certificate in the bundle is wrapped across lines, so the unwrapping is untested",
    );
    // **Not asserted here: text between blocks.** This bundle has none — 121 certificates back to
    // back, and not one line that is neither armour nor base64 — so requiring it made the test fail on
    // its own input. The tolerance is still worth having, because other bundles put a name above each
    // block, so it is tested below where it can be rather than asserted here where it cannot.

    const got = pemBundle(new TextEncoder().encode(text));

    assert(got.refused === 0, `${got.refused} block(s) did not decode`);
    assert(
      got.offsets.length === want.offsets.length,
      `we found ${got.offsets.length / 2} certificates, the reference found ${blocks}`,
    );
    for (let i = 0; i < want.offsets.length; i++) {
      assert(
        got.offsets[i] === want.offsets[i],
        `offset ${i} is ${got.offsets[i]}, the reference says ${want.offsets[i]}`,
      );
    }
    assert(
      got.der.length === want.der.length,
      `our DER is ${got.der.length} bytes, the reference's is ${want.der.length}`,
    );
    for (let i = 0; i < want.der.length; i++) {
      if (got.der[i] !== want.der[i]) {
        throw new Error(`DER differs at byte ${i}: ${got.der[i]} against ${want.der[i]}`);
      }
    }
  },
});

Deno.test("a block that does not decode is counted, not silently dropped", () => {
  const good = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
  // `!` is not a base64 digit, and the strict decoder refuses it rather than skipping it.
  const bad = "-----BEGIN CERTIFICATE-----\nQU!D\n-----END CERTIFICATE-----\n";
  const got = pemBundle(new TextEncoder().encode(good + bad + good));
  assert(got.refused === 1, `expected one refusal, got ${got.refused}`);
  // Two certificates, and the offsets must describe those two rather than carrying a third
  // zero-length pair the verifier would try.
  assert(got.offsets.length === 4, `expected two certificates, got ${got.offsets.length / 2}`);
  assert(got.der.length === 6, `expected 6 bytes of DER, got ${got.der.length}`);
  assert(got.offsets.join(",") === "0,3,3,6", `offsets are ${got.offsets.join(",")}`);
});

Deno.test("text between blocks is skipped rather than refused", () => {
  const good = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
  // openssl's own bundles, and what some distributions ship, put the subject above each block. The
  // system bundle this is measured against has nothing between blocks, so this is the only place the
  // skipping is exercised at all.
  const named = "Some CA Root\n=============\n" + good;
  const got = pemBundle(new TextEncoder().encode(named + named));
  assert(got.offsets.length === 4, `expected two certificates, got ${got.offsets.length / 2}`);
  assert(got.refused === 0, `expected no refusals, got ${got.refused}`);
  assert(got.offsets.join(",") === "0,3,3,6", `offsets are ${got.offsets.join(",")}`);
});

Deno.test("armour that never closes ends the scan rather than decoding a truncation", () => {
  const good = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
  const truncated = "-----BEGIN CERTIFICATE-----\nQUJD\n";
  const got = pemBundle(new TextEncoder().encode(good + truncated));
  assert(got.offsets.length === 2, `expected one certificate, got ${got.offsets.length / 2}`);
  assert(got.refused === 0, "a truncation is not a refusal; it ends the file");
});
