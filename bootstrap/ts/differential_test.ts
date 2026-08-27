// The two assemblers, on every module in `tests/l0/`, compared byte for byte.
//
// This is the check the format exists for. `spec/l0.md` claims every choice was removed from the
// implementation; a byte that differs is a choice that was left in, and the fix belongs in the spec
// rather than in whichever assembler is behind.
//
// Skipped, loudly, when the Rust binary has not been built — a differential that silently becomes a
// single-sided test is worse than one that is not run.

import { assemble } from "./assemble.ts";

const root = new URL("..", import.meta.url).pathname;
const rustBin = `${root}rust/target/release/wax`;

function haveRust(): boolean {
  try {
    return Deno.statSync(rustBin).isFile;
  } catch {
    return false;
  }
}

function hex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");
}

/** The first index at which two byte strings differ, or -1. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

// Every `.l0` in the repository, so a new module is covered by being written rather than by being
// remembered.
const cases: string[] = [];
for (const dir of ["tests/l0", "boot"]) {
  for (const e of Deno.readDirSync(`${root}${dir}`)) {
    if (e.isFile && e.name.endsWith(".l0")) cases.push(`${dir}/${e.name}`);
  }
}
cases.sort();

for (const file of cases) {
  Deno.test({
    name: `${file}: rust and typescript agree byte for byte`,
    ignore: !haveRust(),
    fn: async () => {
      const src = await Deno.readTextFile(`${root}${file}`);
      const mine = assemble(src);

      const out = await Deno.makeTempFile({ suffix: ".wasm" });
      const cmd = new Deno.Command(rustBin, {
        args: [`${root}${file}`, out],
        stderr: "piped",
      });
      const { code, stderr } = await cmd.output();
      if (code !== 0) throw new Error(`rust refused it: ${new TextDecoder().decode(stderr)}`);
      const theirs = await Deno.readFile(out);
      await Deno.remove(out);

      const at = firstDifference(mine, theirs);
      if (at >= 0) {
        const from = Math.max(0, at - 8);
        throw new Error(
          `${file}: first difference at byte ${at}\n` +
            `  ts  : ${hex(mine.slice(from, at + 8))}\n` +
            `  rust: ${hex(theirs.slice(from, at + 8))}\n` +
            `  (lengths ${mine.length} and ${theirs.length})`,
        );
      }
    },
  });
}

Deno.test("the corpus is not empty, and the rust half was actually run", () => {
  if (cases.length === 0) throw new Error("no wac-L0 files found");
  if (!haveRust()) {
    throw new Error(
      `the rust assembler is not built, so every comparison above was skipped — ` +
        `run \`cargo build --release\` in rust/`,
    );
  }
});
