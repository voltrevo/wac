// **The seed, built both ways, compared.**
//
//   deno run packages/platform/native.ts packages/wac/src/wac.wac ...    the way wac does it
//   ladder <wacc> --with-wacc packages/wac/src/wac.wac ...               the way this repo does
//
// The second has no Deno in it: wac-L5 builds wacc, that wacc compiles the CLI, and the manifest
// is assembled from what wacc answers about the program. If the two artefacts are identical then
// `native/v8/build.rs` can embed either, and the bootstrap no longer needs a JavaScript runtime.
//
// An instrument rather than a test: it builds the whole CLI twice and takes about half a minute,
// which is more than a suite should carry. `bootstrap/ts/manifest_test.ts` covers the same ground for a
// small program and runs in a second.

const HERE = new URL(".", import.meta.url).pathname;
const BIN = `${HERE}../rust-ladder/target/release/ladder`;
const WAC = `${HERE}../..`;
const ENTRY = "packages/wac/src/wac.wac";
const GRANTS = ["--allow-read", "--allow-write", "--allow-env", "--allow-net"];

const dir = await Deno.makeTempDir();
await Deno.mkdir(`${dir}/ref`);
await Deno.mkdir(`${dir}/ours`);

async function run(cmd: string, args: string[], label: string): Promise<number> {
  const t = performance.now();
  const out = await new Deno.Command(cmd, { args, cwd: WAC }).output();
  const ms = Math.round(performance.now() - t);
  if (!out.success) {
    console.error(`${label} failed:\n${new TextDecoder().decode(out.stderr).slice(0, 400)}`);
    Deno.exit(1);
  }
  console.log(`${label.padEnd(28)} ${String(ms).padStart(6)} ms`);
  return ms;
}

await run("deno", [
  "run",
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
  `${WAC}/packages/platform/native.ts`,
  ENTRY,
  ...GRANTS,
  "-o",
  `${dir}/ref/wac`,
], "wac's own path, with Deno");

await run(BIN, [
  `${WAC}/packages/wacc/src/api.wac`,
  "--with-wacc",
  ENTRY,
  ...GRANTS,
  "-o",
  `${dir}/ours/wac.wasm`,
], "the ladder, no Deno");

const a = await Deno.readFile(`${dir}/ref/wac.wasm`);
const b = await Deno.readFile(`${dir}/ours/wac.wasm`);
console.log();
console.log(`wac's own path   ${a.length} bytes`);
console.log(`the ladder       ${b.length} bytes`);
const same = a.length === b.length && a.every((v, i) => v === b[i]);
console.log(same ? "\nidentical — the seed is reachable with no Deno" : "\nthey differ");
await Deno.remove(dir, { recursive: true });
if (!same) Deno.exit(1);
