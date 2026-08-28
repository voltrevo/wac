// **The manifest this repo writes, against the one wac writes.**
//
// Reaching the unified binary with no Deno means writing the `wac.manifest` custom section here,
// and that section's format is *wac's*. A copy of somebody else's format is a thing that drifts,
// so it is compared rather than trusted: both paths build the same program and the two manifests
// must be identical bytes.
//
// **It covers a program with no structs and no callbacks**, which is what
// `bootstrap/rust-ladder/src/manifest.rs` can write today — `bindTypesFiles`' `S`/`E`/`M` lines are not
// parsed yet, so a program handing the host a struct or a function reference would need more. The
// test says which case it is checking rather than implying it checks them all.
//
// Skips without the Rust binary or wac beside this repo.

const HERE = new URL(".", import.meta.url).pathname;
const BIN = `${HERE}../rust-ladder/target/release/ladder`;
const WAC = `${HERE}../..`;
const API = `${WAC}/packages/wacc/src/api.wac`;
const NATIVE = `${WAC}/packages/platform/native.ts`;

async function have(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The `wac.manifest` custom section of a module, as text. */
function manifestOf(b: Uint8Array): string {
  let p = 8;
  const uleb = () => {
    let n = 0, shift = 0, x = 0;
    do {
      x = b[p++];
      n |= (x & 0x7f) << shift;
      shift += 7;
    } while (x & 0x80);
    return n;
  };
  while (p < b.length) {
    const id = b[p++];
    const len = uleb();
    const end = p + len;
    if (id === 0) {
      const nameLen = uleb();
      const name = new TextDecoder().decode(b.slice(p, p + nameLen));
      p += nameLen;
      if (name === "wac.manifest") return new TextDecoder().decode(b.slice(p, end));
    }
    p = end;
  }
  throw new Error("the module has no wac.manifest section");
}

Deno.test({
  name: "the manifest matches the one wac's own build writes",
  ignore: !(await have(BIN)) || !(await have(NATIVE)),
  fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
      // The entry path goes *into* the manifest, so both builds must be given the same one.
      const entry = `${dir}/tiny.wac`;
      await Deno.writeTextFile(entry, "export i32 answer() { return 6 * 7; }\n");
      await Deno.mkdir(`${dir}/ref`);
      await Deno.mkdir(`${dir}/ours`);

      const ref = await new Deno.Command("deno", {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-run",
          NATIVE,
          entry,
          "-o",
          `${dir}/ref/tiny`,
        ],
        cwd: WAC,
      }).output();
      if (!ref.success) {
        throw new Error(`native.ts failed: ${new TextDecoder().decode(ref.stderr).slice(0, 300)}`);
      }

      const ours = await new Deno.Command(BIN, {
        args: [API, "--with-wacc", entry, "-o", `${dir}/ours/tiny.wasm`],
      }).output();
      if (!ours.success) {
        throw new Error(`the ladder failed: ${new TextDecoder().decode(ours.stderr).slice(0, 300)}`);
      }

      const a = manifestOf(await Deno.readFile(`${dir}/ref/tiny.wasm`));
      const b = manifestOf(await Deno.readFile(`${dir}/ours/tiny.wasm`));
      if (a !== b) {
        const al = a.split("\n");
        const bl = b.split("\n");
        const at = al.findIndex((l, i) => l !== bl[i]);
        throw new Error(
          `the manifests differ at line ${at + 1}:\n  wac:  ${al[at]}\n  ours: ${bl[at]}`,
        );
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
