// The graph walk is memoised, and the memo is *checked* rather than trusted.
//
// `wacFiles` reads an entry and everything it imports. Every build calls it first — `buildApp`,
// `buildNative`, `appRunner`, `waccArtifacts` — and it read the whole graph from disk every time:
// 171 files one at a time for `packages/box`, 157ms, against 9ms to hash them and about nothing to
// fetch the cached artefact. Measured over `packages/platform`, `packages/box` and `packages/wacc`:
// **258 calls in 64 test processes**, which was about 39 seconds of re-reading the same graphs.
//
// So it is cached per entry, and the cache carries a `mtime:size` stamp per file. Validating one is a
// `stat`; 171 of them concurrently is 4ms against 157ms to read.
//
// **The stamp is the whole safety argument, and this file is what holds it.** Several tests write a
// `.wac` and then build it — `packages/wac/test/wac/testcli_test.wac`, `packages/wac/test/wac/runcli_test.wac`,
// `packages/platform/test/wac/trapmessage_test.wac` — and one of them writing *twice* to one path is a
// program the compiler must see the second version of. A memo keyed on the path alone would hand back
// the first.

import { wacFiles } from "./wacFiles.ts";

function assertEquals<T>(got: T, want: T, msg: string): void {
  if (got !== want) throw new Error(`${msg}\n  got:  ${got}\n  want: ${want}`);
}

Deno.test("wacFiles: a file rewritten between two walks is read again", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wacfiles-" });
  const entry = `${dir}/m.wac`;
  try {
    // **A loop, and the two versions are the same length on purpose.** One pass of this was flaky and
    // that was the test being right: a stamp is `mtime:size`, an mtime is milliseconds, and a
    // same-length rewrite inside the same millisecond has an identical stamp. Whether a single pass
    // caught it depended on where the millisecond boundary fell — it failed about two runs in five,
    // and it failed *for a reason*, which is how the memo's clock rule came to exist. Two hundred
    // passes cross every boundary there is.
    let stale = 0;
    for (let i = 0; i < 200; i++) {
      await Deno.writeTextFile(entry, "export i32 one() { return 1; }\n");
      if (!(await wacFiles(entry)).get(entry)?.includes("return 1")) stale++;
      await Deno.writeTextFile(entry, "export i32 one() { return 2; }\n");
      if (!(await wacFiles(entry)).get(entry)?.includes("return 2")) stale++;
    }
    assertEquals(stale, 0, "walks served a stale memo — the stamp did not notice a same-length rewrite");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("wacFiles: an imported file rewritten between two walks is read again", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wacfiles-dep-" });
  const entry = `${dir}/m.wac`;
  const dep = `${dir}/d.wac`;
  try {
    await Deno.writeTextFile(dep, "export i32 two() { return 2; }\n");
    await Deno.writeTextFile(entry, `import { two } from "./d.wac";\nexport i32 f() { return two(); }\n`);
    const first = await wacFiles(entry);
    assertEquals(first.size, 2, "the walk followed the import");
    assertEquals(first.get(dep)?.includes("return 2"), true, "the dependency's first version");

    // The entry is untouched, so a memo that stamped only the entry would answer from before this.
    await Deno.writeTextFile(dep, "export i32 two() { return 22; }\n");
    const second = await wacFiles(entry);
    assertEquals(
      second.get(dep)?.includes("return 22"),
      true,
      "a rewritten *dependency* was served stale — the stamps must cover every file, not the entry",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("wacFiles: what it hands back is the caller's own copy", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wacfiles-copy-" });
  const entry = `${dir}/m.wac`;
  try {
    await Deno.writeTextFile(entry, "export i32 one() { return 1; }\n");
    const first = await wacFiles(entry);
    // `packages/wacc`'s drivers add a generated file to the map they were given. Writing into the memo
    // would then leak that file into every later build in the process.
    first.set(`${dir}/generated.wac`, "export i32 gen() { return 0; }\n");
    const second = await wacFiles(entry);
    assertEquals(second.has(`${dir}/generated.wac`), false, "the memo was written through");
    assertEquals(second.size, 1, "the second walk saw only the real file");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
