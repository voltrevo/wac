// The manifest, derived twice: by `packages/platform/native.ts` and by the compiler itself.
//
// A native host cannot run a module without one — it says which `$bind$` export builds `Core`, what
// order that struct's funcrefs go in, and which dispatcher serves which callback signature. It has
// always been written by TypeScript, which is why `native/v8` can compile wac in a single file and
// still cannot rebuild the file it carries: the module it emits is right, and the section that makes
// a module self-describing is on the other side of the language boundary. `src/manifest.wac` is that
// half in wac, and this is the check that the two agree.
//
// **Byte for byte, not merely equivalent.** Comparing parsed objects would accept a manifest that
// laid out differently, and then a seed rebuilt by the binary would be a *different file* from the
// one built by the toolchain — leaving "is this the same artefact?" with no cheap answer. It is one
// `===` on the text instead.
//
// The programs are chosen for what their boundaries contain rather than for size: `hello` declares
// one capability, `wc` two, and `wacc` itself has the enums, the aliased `Pending<u8[]?>`, and the
// generic instantiations whose bind names no host could spell for itself.

import { buildNative } from "../../platform/native.ts";
import { waccApi } from "../../../harness/waccBuild.ts";
import { waccArtifacts } from "../../../harness/waccBuild.ts";
import { wacFiles } from "../../../harness/wacFiles.ts";

type Api = {
  manifestFiles(
    wasm: Uint8Array,
    paths: string[],
    sources: string[],
    entry: string,
    wasmName: string,
    grants: number,
  ): string;
  emitFilesSelfDescribing(
    paths: string[],
    sources: string[],
    entry: string,
    wasmName: string,
    grants: number,
  ): Uint8Array;
};

const api = await waccApi() as unknown as Api;

/** The same four grants the `app:native` command line sets, so both sides carry all four keys. */
const GRANTS = { read: true, write: true, env: false, net: false };
const BITS = 1 | 2;

async function bothWays(entry: string): Promise<{ ts: string; wac: string }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-manifest-" });
  try {
    await buildNative(entry, `${dir}/prog`, GRANTS);
    const ts = await Deno.readTextFile(`${dir}/prog.json`);

    const files = await wacFiles(entry);
    const paths = [...files.keys()];
    const sources = paths.map((p) => files.get(p)!);
    const art = await waccArtifacts(files, entry);
    const wac = api.manifestFiles(art.wasm, paths, sources, entry, "prog.wasm", BITS);
    return { ts, wac };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Where two long JSON texts first differ, as a line rather than an offset. */
function firstDifference(a: string, b: string): string {
  const x = a.split("\n"), y = b.split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `line ${i + 1}:\n  native.ts: ${x[i]}\n  manifest.wac: ${y[i]}`;
  }
  return "no line differs, only the length";
}

for (const entry of [
  "native/v8/example/hello.wac",
  "packages/platform/example/wc.wac",
  "packages/wacc/example/wacc.wac",
]) {
  Deno.test(`the compiler writes the same manifest as the bundler, for ${entry}`, async () => {
    const { ts, wac } = await bothWays(entry);
    if (ts !== wac) throw new Error(`the two derivations differ — ${firstDifference(ts, wac)}`);

    // **Asserted, not merely compared.** Two empty strings are equal, and a manifest that described
    // nothing would pass the line above while describing nothing on both sides.
    const m = JSON.parse(wac) as { structs: { name: string }[]; exports: { name: string }[] };
    if (!m.structs.some((s) => s.name === "Core")) {
      throw new Error(`${entry}: no Core in a manifest for a program whose main takes one`);
    }
    if (!m.exports.some((e) => e.name === "main")) throw new Error(`${entry}: no main`);
  });
}

Deno.test("and the module it writes, section and all, is the artefact the bundler writes", async () => {
  // The manifest agreeing is one thing; the *file* is what a host is handed and what a rebuilt seed
  // would have to be. `emitFilesSelfDescribing` is the whole of `app:native` in wac — emit, derive,
  // append — so this is the comparison that says the binary could produce its own payload.
  const entry = "packages/platform/example/wc.wac";
  const dir = await Deno.makeTempDir({ prefix: "wac-manifest-" });
  try {
    await buildNative(entry, `${dir}/prog`, GRANTS);
    const want = await Deno.readFile(`${dir}/prog.wasm`);

    const files = await wacFiles(entry);
    const paths = [...files.keys()];
    const sources = paths.map((p) => files.get(p)!);
    const got = Uint8Array.from(
      api.emitFilesSelfDescribing(paths, sources, entry, "prog.wasm", BITS) as unknown as number[],
    );
    if (got.length !== want.length) {
      throw new Error(`the compiler wrote ${got.length} bytes, the bundler ${want.length}`);
    }
    for (let i = 0; i < got.length; i++) {
      if (got[i] !== want[i]) throw new Error(`byte ${i} differs: ${got[i]} vs ${want[i]}`);
    }
    console.log(`    self-describing: ${got.length} bytes for ${entry}, identical to the bundler's`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
