// `--optimize`: the same program, smaller, and still the same program.
//
// wac-mono 0094, decided 2026-08-11 as **a flag rather than the default** — what a built artifact
// contains stays exactly what the compiler produced unless somebody asks otherwise, because this
// repository debugs by comparing modules and an optimiser in between means every such comparison has
// to say which side of it it is on.
//
// So what this file has to establish is that the flag is worth having and safe to use: the artifact
// gets materially smaller, and the program it contains still answers the same. Size alone would pass
// for a build that dropped the module on the floor.
import { buildApp } from "../build.ts";
import { bounded, DEFAULT_SECONDS } from "../../../harness/bounded.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const tmp = await Deno.makeTempDir({ prefix: "wac-optimize-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch { /* already gone */ }
});

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`);
}

Deno.test("--optimize makes a smaller artifact that answers the same", async () => {
  const plain = `${tmp}/wc-plain`;
  const opt = `${tmp}/wc-opt`;
  await buildApp("packages/platform/example/wc.wac", plain, { read: true }, "deno", false, { coverage: false });
  await buildApp("packages/platform/example/wc.wac", opt, { read: true }, "deno", false, {
    coverage: false,
    optimize: true,
  });

  const before = (await Deno.stat(plain)).size;
  const after = (await Deno.stat(opt)).size;
  // Measured at 274 KB → 222 KB on 2026-08-11, which is the wasm going 93,766 → 55,143 inside a file
  // that is about half host JavaScript (wac-mono 0129). A tenth is a floor with room under it rather
  // than the figure: what this asserts is that something happened, not how much.
  assertEquals(after < before * 0.9, true, `${before} -> ${after} bytes is not a saving worth a flag`);

  // **And it is still the program.** A build that emitted an empty module would pass the line above.
  const both = [plain, opt].map((bin) => bounded(DEFAULT_SECONDS, bin, ["README.md"], { cwd: Deno.cwd() }));
  assertEquals(both[0].code, 0, both[0].err);
  assertEquals(both[1].code, 0, both[1].err);
  assertEquals(both[1].out, both[0].out, "the optimised program answers differently");
  assertEquals(both[0].out.trim().split(/\s+/).length, 4, `wc printed ${JSON.stringify(both[0].out)}`);
});

Deno.test("an optimised build is a different artifact, not a cache hit on the plain one", async () => {
  // The cache key carries the flag and the binaryen version — without that, asking for one after the
  // other hands back whichever was built first, which is the stale-artifact failure `buildCache` exists
  // to prevent and would read here as "--optimize does nothing".
  const a = `${tmp}/key-plain`;
  const b = `${tmp}/key-opt`;
  await buildApp("packages/platform/example/wc.wac", a, { read: true }, "deno", false, { coverage: false });
  await buildApp("packages/platform/example/wc.wac", b, { read: true }, "deno", false, {
    coverage: false,
    optimize: true,
  });
  assertEquals((await Deno.stat(b)).size < (await Deno.stat(a)).size, true, "the two builds are the same file");
});

Deno.test("a coverage build refuses to be optimised", async () => {
  // Counters are branch-indexed globals and an optimiser may merge or drop the branches they count, so
  // a dump would be renumbered underneath the table that names them — a wrong answer rather than a
  // missing one. Refused at the call rather than discovered in a report nobody could explain.
  let said = "";
  try {
    await buildApp("packages/platform/example/wc.wac", `${tmp}/never`, { read: true }, "deno", false, {
      coverage: true,
      optimize: true,
    });
  } catch (e) {
    said = String((e as Error).message);
  }
  assertEquals(said.includes("cannot be optimised"), true, `expected a refusal, got ${JSON.stringify(said)}`);
});
