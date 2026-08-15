// One front end must answer what two answered.
//
// `describeFiles` returns the export signatures and the bind types from a single link, parse and
// `settleEmittable` — where a build used to ask `exportSigsFiles` and `bindTypesFiles` separately
// and pay for the whole front end twice (`issues/lang/0129`). The saving is real and so is the
// hazard: both walks now share one `Env`.
//
// **That sharing rests on a claim about who writes to it.** `bindTypesOf` sets `cbSigCount`,
// `outSigCount` and the bind-struct table; `exportSigsOf` reads only what `settleEmittable` left.
// Signatures run first as defence — the read-only walk before the writing one — but that is a
// choice, not a requirement: swapping the two was tried and changed no output, so do not read the
// order as load-bearing. What holds is the non-overlap, and "only reads it" is exactly the sort of
// claim that stops being true without anyone noticing. A new call to something that interns a type
// would do it, and the failure would not look like a crash. It would look like a host class that
// is subtly absent, which is `issues/lang/0106`'s whole story.
//
// So the two spellings are compared directly. The programs below are chosen for what they make the
// metadata carry rather than for size: callbacks and out-refs are the parts of `bindTypesOf` that
// write the most to the `Env`.
//
// This ran clean over all 79 programs `harness/programs.ts` finds when the fold landed. That sweep
// is too slow for the suite — it is three full front ends per program — so a representative few
// stay here.

import { waccApi } from "../../../harness/waccBuild.ts";
import { wacFiles } from "../../../harness/wacFiles.ts";

const ENTRIES = [
  "packages/zstd/src/frame.wac", // small, no boundary machinery
  "packages/json/src/json.wac", // structs and enums crossing
  "packages/box/example/boxsh.wac", // callbacks, out-refs, many `Pending<T>` — issue 0106's program
];

for (const entry of ENTRIES) {
  Deno.test(`describeFiles agrees with the two calls it replaced — ${entry}`, async () => {
    // deno-lint-ignore no-explicit-any
    const api = await waccApi() as any;
    const files = await wacFiles(entry);
    const paths = [...files.keys()];
    const sources = paths.map((p) => files.get(p)!);

    const sigs = api.exportSigsFiles(paths, sources, entry) as string;
    const types = api.bindTypesFiles(paths, sources, entry) as string;
    const sep = api.describeSeparator() as string;

    const want = sigs + sep + types;
    const got = api.describeFiles(paths, sources, entry) as string;
    if (got !== want) {
      const at = [...want].findIndex((c, i) => got[i] !== c);
      throw new Error(
        `one front end answered differently from two, at character ${at}:\n` +
          `  two: ${JSON.stringify(want.slice(Math.max(0, at - 40), at + 40))}\n` +
          `  one: ${JSON.stringify(got.slice(Math.max(0, at - 40), at + 40))}`,
      );
    }

    // The separator has to be a line neither half can produce, or the split silently truncates one
    // of them. Cheap to check and the whole scheme rests on it.
    if (sigs.includes(sep)) throw new Error("a signature line contains the separator");
    if (types.includes(sep)) throw new Error("a bind-type line contains the separator");
  });
}
