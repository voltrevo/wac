// `@/` — which directories a manifest search looks in, and where it stops. `design/lang/0009` D7.
//
// The order and the stopping point are the whole of what `candidateRoots` decides, so those are
// what is asserted: the full list, in order, rather than "it found something". A function that
// returned the boundary alone would satisfy any test that only checked the last element, and a
// function that walked past the boundary would satisfy any test that only checked the first.

import { wacBind } from "../../../harness/wacBind.ts";

type Mod = {
  candidateRoots(fromPath: string, boundary: string): string[];
  dirOf(path: string): string;
  MANIFEST_NAME(): string;
};

let cached: Mod | null = null;
async function mod(): Promise<Mod> {
  if (cached === null) cached = await wacBind("packages/wacpkg/src/root.wac") as unknown as Mod;
  return cached;
}

Deno.test("the search runs from the file's own directory up to the boundary, and stops", async () => {
  const m = await mod();
  const cases: [string, string, string[]][] = [
    ["pkg/src/a/b.wac", "pkg", ["pkg/src/a", "pkg/src", "pkg"]],
    ["pkg/a.wac", "pkg", ["pkg"]],
    ["a.wac", ".", ["."]],
    ["a/b/c.wac", ".", ["a/b", "a", "."]],
    ["/x/y/z.wac", "/x", ["/x/y", "/x"]],
    ["/x/y/z.wac", "/", ["/x/y", "/x", "/"]],
    // The boundary is where it ends, not where it begins: nothing above `pkg/src` is listed even
    // though `pkg` exists and would be found by a search that kept going.
    ["pkg/src/a/b.wac", "pkg/src", ["pkg/src/a", "pkg/src"]],
    // Written unnormalised, both sides. The manifest search and the import resolution have to
    // agree about which directory a file is in, so both go through the same collapser.
    ["pkg/./src/../src/a/b.wac", "pkg/", ["pkg/src/a", "pkg/src", "pkg"]],
  ];
  const wrong: string[] = [];
  for (const [file, boundary, want] of cases) {
    const got = m.candidateRoots(file, boundary);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      wrong.push(`${file} in ${boundary}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("a file outside the boundary gets no candidates at all", async () => {
  const m = await mod();
  // Not "the boundary alone". The caller has paired a file with a provider it did not come from,
  // and answering with the boundary would name a project the file is not in — which is D7's
  // confinement rule failing open rather than a lookup missing.
  const cases: [string, string][] = [
    ["pkg/a.wac", "other"],
    ["/a.wac", "."],           // an absolute file is not inside a relative boundary
    ["a.wac", "/"],            // nor the other way round
    ["pkgx/a.wac", "pkg"],     // a shared prefix is not containment
    ["../a.wac", "."],         // climbing out of the boundary
  ];
  const wrong: string[] = [];
  for (const [file, boundary] of cases) {
    const got = m.candidateRoots(file, boundary);
    if (got.length !== 0) wrong.push(`${file} in ${boundary}: got ${JSON.stringify(got)}, want none`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("`.` and the empty string are one directory", async () => {
  const m = await mod();
  // `normalisePath(".")` is `""` — `.` is a component it drops. `dirOf("a.wac")` is `"."`. If those
  // two spellings were not reconciled, a project whose boundary is written `.` would report every
  // file in its own top directory as outside it, which is the confinement rule failing closed on
  // the most ordinary case there is.
  const wrong: string[] = [];
  for (const boundary of [".", "", "./"]) {
    const got = m.candidateRoots("a/b.wac", boundary);
    if (JSON.stringify(got) !== JSON.stringify(["a", "."])) {
      wrong.push(`boundary ${JSON.stringify(boundary)}: got ${JSON.stringify(got)}`);
    }
  }
  if (m.dirOf("a.wac") !== ".") wrong.push(`dirOf("a.wac") is ${m.dirOf("a.wac")}, want "."`);
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("dirOf agrees with the resolver about where a file lives", async () => {
  const m = await mod();
  const cases: [string, string][] = [
    ["a/b/c.wac", "a/b"],
    ["a/b.wac", "a"],
    ["b.wac", "."],
    ["/b.wac", "/"],
    ["/a/b.wac", "/a"],
  ];
  const wrong: string[] = [];
  for (const [path, want] of cases) {
    if (m.dirOf(path) !== want) wrong.push(`dirOf(${path}) is ${m.dirOf(path)}, want ${want}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("the manifest name has one spelling", async () => {
  const m = await mod();
  if (m.MANIFEST_NAME() !== "wac.json5") throw new Error(`got ${m.MANIFEST_NAME()}`);
});
