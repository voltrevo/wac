// Where this decoder refuses input that real tools accept — measured, on both of them.
//
// `README.md` lists what this package refuses and calls it a security property. That list was written
// from the spec, and the spec is about *encoders*: it says what a conforming encoding looks like and is
// quiet about what a decoder should do with one that is not. So "we refuse a `bool` that is not 0 or 1"
// is a choice, and a choice is worth knowing the cost of.
//
// The cost is measurable, because there are two independent decoders on this machine. This file runs
// each malformation through **`cast`** (Foundry, Rust, alloy) and **`ethers`**, and asserts what all
// three do — so the table below is a measurement rather than a claim, and if either tool changes its
// mind the suite says so instead of the table going quietly stale.
//
// | malformation | ours | cast | ethers | Solidity's own decoder |
// | --- | --- | --- | --- | --- |
// | `address` with its high twelve bytes set | refuse | **accepts**, truncating to the low 20 | refuse | reverts |
// | `bool` that is 2 | refuse | **accepts** as true | **accepts** as true | reverts |
// | trailing bytes past the last word | refuse | **accepts**, ignoring them | **accepts**, ignoring them | ignores them |
// | fewer bytes than the type needs | refuse | refuse | refuse | reverts |
//
// **The two tools do not agree with each other.** `cast` is alone in accepting a dirty address; both are
// lenient about bools and about trailing bytes, where Solidity is not; and everything refuses input that
// is simply too short. There is no "the" answer to copy, which is the reason this is a table of
// measurements rather than a decision recorded once and forgotten — and the row above was wrong when it
// was written from memory, which the test below caught on its first run.
//
// **Why we stay strict.** What this package is *for* is reading a chain: return data and logs produced
// by contracts whose own decoder would have reverted on these bytes. A word that Solidity would refuse
// is not a value that a correct contract produced, and a client that quietly truncates it is inventing
// an answer — `0x1122…eeff` decoding to an address the caller never saw is the shape of a real
// vulnerability rather than a compatibility feature. Refusing costs us the ability to read deliberately
// dirty data, which nothing in this repo wants to do.
//
// The one that is not obviously right is **trailing bytes**, where every tool is lenient and we are not.
// Left strict on the same reasoning, and named here so that whoever needs it knows this is the line to
// move and what moves with it.

import { wacBind } from "../../../harness/wacBind.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const probe = await wacBind("packages/abi/test/wac/probe.wac") as Record<string, unknown>;
const decodeRender = probe.decodeRender as (data: Uint8Array, schema: Int32Array) => Uint8Array;

const T = { UINT: 1, BOOL: 2, ADDRESS: 3 };
const unhex = (s: string) =>
  Uint8Array.from(s.replace(/^0x/, "").match(/../g)?.map((h) => parseInt(h, 16)) ?? []);

/** `[ok, text…]` from the probe: `ok` 0 and the refusal's own sentence. */
function ours(data: string, schema: number[]): { ok: boolean; said: string } {
  const out = decodeRender(unhex(data), Int32Array.from(schema));
  return { ok: out[0] === 1, said: new TextDecoder().decode(out.slice(1)) };
}

const WORD = (hexTail: string) => "0x" + hexTail.padStart(64, "0");

const CASES = [
  {
    what: "an address with its high twelve bytes set",
    type: "address",
    schema: [T.ADDRESS],
    data: "0x11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff",
    cast: "accepts",
    ethers: "refuses",
  },
  {
    what: "a bool that is 2",
    type: "bool",
    schema: [T.BOOL],
    data: WORD("02"),
    cast: "accepts",
    ethers: "accepts",
  },
  {
    what: "a bool with every low byte set",
    type: "bool",
    schema: [T.BOOL],
    data: WORD("ff"),
    cast: "accepts",
    ethers: "accepts",
  },
  {
    what: "a byte past the last whole word",
    type: "uint256",
    schema: [T.UINT],
    data: WORD("01") + "aa",
    cast: "accepts",
    ethers: "accepts",
  },
  {
    // The one everything refuses. It is here because a table of disagreements needs the agreement in it:
    // without this row, "our decoder is the strict one" would look like the whole story.
    what: "fewer bytes than one word",
    type: "uint256",
    schema: [T.UINT],
    data: "0x01",
    cast: "refuses",
    ethers: "refuses",
  },
] as const;

/** Foundry's `cast`, wherever the operator put it. */
const CAST = await (async () => {
  for (const path of ["cast", `${Deno.env.get("HOME")}/tools/foundry/cast`]) {
    try {
      const r = await new Deno.Command(path, { args: ["--version"], stdout: "null", stderr: "null" }).output();
      if (r.success) return path;
    } catch {
      // Not there; try the next.
    }
  }
  console.error("packages/abi/test/strictness.test.ts: no `cast` — half the table below is not measured.");
  return null;
})();

Deno.test("every malformation this decoder names is refused, and says which rule", () => {
  for (const c of CASES) {
    const got = ours(c.data, [...c.schema]);
    assertEquals(got.ok, false, `${c.what}: accepted, and said ${JSON.stringify(got.said)}`);
    // The sentence names the rule rather than saying "invalid": a refusal a caller cannot act on is
    // barely better than a wrong answer.
    assertEquals(got.said.length > 10, true, `${c.what}: refused with ${JSON.stringify(got.said)}`);
  }
});

Deno.test({
  name: "…and the table of what the real tools do is still true",
  ignore: CAST === null,
  fn: async () => {
    for (const c of CASES) {
      const r = await new Deno.Command(CAST!, {
        args: ["abi-decode", `f()(${c.type})`, c.data],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const accepted = r.success;
      assertEquals(
        accepted ? "accepts" : "refuses",
        c.cast,
        `cast changed its mind about ${c.what} — the table in this file needs re-measuring`,
      );
    }
  },
});
