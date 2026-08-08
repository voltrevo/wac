// The ABI codec, against **`cast`** — a second implementation, and not the one the corpus came from.
//
// `abi_wac.test.ts` compares against a corpus produced by `ethers`. This compares against Foundry's
// `cast abi-encode`, which is Rust and shares no code with it, and it asks a different question: not
// "does this render what ethers renders" but "given bytes another tool produced, does decoding and
// re-encoding them give the same bytes back".
//
// **Why a second oracle rather than more cases for the first.** The vendored corpus is thirty cases and
// was written by hand around the shapes somebody thought of; where it is thin is not visible from
// inside it. `cast` costs a spawn and covers whatever is asked of it, so the cases here are the ones
// the corpus does not have: empty dynamic values, lengths either side of a word boundary, dynamic
// members inside fixed-size arrays, and arrays of tuples that are themselves dynamic.
//
// `roundTrip` is the whole comparison. It decodes the other tool's bytes with our schema and encodes
// the result again, so a disagreement in either direction shows up as different bytes — and unlike a
// round trip through *our own* encoder, the input is not ours to begin with, which is the difference
// between checking a symmetry and checking an answer.

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
const roundTrip = probe.roundTrip as (data: Uint8Array, schema: Int32Array) => Uint8Array;

const T = { UINT: 1, BOOL: 2, ADDRESS: 3, BYTES32: 4, BYTES: 5, STRING: 6, ARRAY: 7, FIXED: 8, TUPLE: 9 };

/** An ABI type string as the descriptor `packages/abi` walks. The same rules as `abi_wac.test.ts`. */
function descriptor(type: string): number[] {
  if (type.endsWith("]")) {
    const open = type.lastIndexOf("[");
    const inner = type.slice(0, open);
    const size = type.slice(open + 1, -1);
    return size === "" ? [T.ARRAY, ...descriptor(inner)] : [T.FIXED, Number(size), ...descriptor(inner)];
  }
  if (type.startsWith("(")) {
    const members = splitTuple(type);
    return [T.TUPLE, members.length, ...members.flatMap(descriptor)];
  }
  if (type === "bool") return [T.BOOL];
  if (type === "address") return [T.ADDRESS];
  if (type === "bytes") return [T.BYTES];
  if (type === "string") return [T.STRING];
  if (type === "bytes32") return [T.BYTES32];
  if (type.startsWith("uint") || type.startsWith("int")) return [T.UINT];
  throw new Error(`no descriptor for ${type}`);
}

function splitTuple(t: string): string[] {
  const body = t.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    if (i === body.length || (body[i] === "," && depth === 0)) {
      out.push(body.slice(start, i));
      start = i + 1;
      continue;
    }
    if (body[i] === "(" || body[i] === "[") depth++;
    if (body[i] === ")" || body[i] === "]") depth--;
  }
  return out;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.replace(/^0x/, "").match(/../g)?.map((h) => parseInt(h, 16)) ?? []);

/** Foundry's `cast`, wherever the operator put it. Absent is a skip that says so. */
const CAST = await (async () => {
  for (const path of ["cast", `${Deno.env.get("HOME")}/tools/foundry/cast`]) {
    try {
      const r = await new Deno.Command(path, { args: ["--version"], stdout: "null", stderr: "null" }).output();
      if (r.success) return path;
    } catch {
      // Not there; try the next.
    }
  }
  console.error(
    "packages/abi/test/cast.test.ts: no `cast` on PATH or in ~/tools/foundry — the second oracle is\n" +
      "  not running. Foundry's installer puts it in ~/.foundry/bin; this repo keeps it in ~/tools/foundry\n" +
      "  so it survives a container restart.",
  );
  return null;
})();

async function castEncode(types: string[], args: string[]): Promise<Uint8Array> {
  const r = await new Deno.Command(CAST!, {
    args: ["abi-encode", `f(${types.join(",")})`, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!r.success) {
    throw new Error(`cast abi-encode f(${types.join(",")}) ${args.join(" ")}: ${new TextDecoder().decode(r.stderr)}`);
  }
  return unhex(new TextDecoder().decode(r.stdout).trim());
}

/**
 * The shapes the vendored corpus does not have.
 *
 * Every one is a place a head/tail codec goes wrong: an empty dynamic value has a length word and no
 * tail, a 32-byte string is the boundary between one padding word and two, and a dynamic member inside a
 * *fixed* array is the case where the array itself is dynamic although its length is known.
 */
const CASES: { types: string[]; args: string[]; why: string }[] = [
  { types: ["bytes"], args: ["0x"], why: "an empty bytes is a length and nothing after it" },
  { types: ["string"], args: [""], why: "and so is an empty string" },
  { types: ["uint256[]"], args: ["[]"], why: "an empty array" },
  { types: ["string[]"], args: ["[]"], why: "an empty array of a dynamic type" },
  { types: ["bytes[]"], args: ["[0x]"], why: "one empty element" },
  { types: ["bytes"], args: [`0x${"11".repeat(31)}`], why: "31 bytes: one padding word, one byte spare" },
  { types: ["bytes"], args: [`0x${"22".repeat(32)}`], why: "32 bytes: exactly one word, no padding" },
  { types: ["bytes"], args: [`0x${"33".repeat(33)}`], why: "33 bytes: two words, and the boundary" },
  { types: ["string"], args: ["x".repeat(32)], why: "the same boundary for a string" },
  { types: ["string"], args: ["é".repeat(20)], why: "bytes rather than characters decide the length" },
  { types: ["uint256", "bytes", "uint256"], args: ["1", "0xdead", "2"], why: "a dynamic value between two static ones" },
  { types: ["bytes", "bytes"], args: ["0xaa", "0xbb"], why: "two tails, and the second offset is the test" },
  { types: ["(uint256,(string,bytes))"], args: ["(1,(hi,0x02))"], why: "a dynamic tuple inside a tuple" },
  { types: ["string[2]"], args: ["[a,bb]"], why: "a fixed array whose elements are dynamic" },
  { types: ["(uint256,string)[2]"], args: ["[(1,a),(2,bb)]"], why: "and of dynamic tuples" },
  { types: ["(string,bytes)[]"], args: ["[(a,0x01),(bb,0x)]"], why: "an array of dynamic tuples" },
  { types: ["uint256[][]"], args: ["[[1,2],[],[3]]"], why: "an empty row between two full ones" },
  { types: ["uint256[2][]"], args: ["[[1,2],[3,4]]"], why: "a dynamic array of static arrays" },
  { types: ["uint256[][2]"], args: ["[[1],[2,3]]"], why: "and the other way round" },
  {
    types: ["uint256"],
    args: ["115792089237316195423570985008687907853269984665640564039457584007913129639935"],
    why: "the largest word there is",
  },
  { types: ["address"], args: ["0xffffffffffffffffffffffffffffffffffffffff"], why: "every bit of an address set" },
  { types: ["bool", "bool"], args: ["true", "false"], why: "both bools, packed one to a word" },
  { types: ["bytes32"], args: [`0x${"ab".repeat(32)}`], why: "a full word that is not a number" },
  {
    types: ["(bool,uint256[],string)"],
    args: ["(true,[1,2,3],mixed)"],
    why: "static and dynamic members in one tuple",
  },
];

Deno.test({
  name: "bytes another implementation produced decode and re-encode to themselves",
  ignore: CAST === null,
  fn: async () => {
    // **The canary.** Every assertion here is "these agree", which a harness that encoded nothing would
    // also satisfy. Two encodings that must differ prove `cast` is really running.
    const one = await castEncode(["uint256"], ["1"]);
    const two = await castEncode(["uint256"], ["2"]);
    assertEquals(hex(one) === hex(two), false, "the oracle is not running");

    const differed: string[] = [];
    for (const { types, args, why } of CASES) {
      const theirs = await castEncode(types, args);
      const schema = Int32Array.from(types.flatMap(descriptor));
      const ours = roundTrip(theirs, schema);
      if (hex(ours) !== hex(theirs)) {
        differed.push(
          `(${types.join(",")}) ${args.join(" ")} — ${why}\n` +
            `    cast: ${hex(theirs)}\n    ours: ${ours.length === 0 ? "(refused)" : hex(ours)}`,
        );
      }
    }
    assertEquals(differed.length, 0, `${differed.length} of ${CASES.length} differ:\n  ${differed.join("\n  ")}`);
  },
});
