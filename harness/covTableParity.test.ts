// The two compilers' coverage tables, compared point kind by point kind.
//
// A coverage point table turns a counter index into a `file:line`. Two compilers that instrument
// differently produce coverage figures on different scales, and every consumer — the mutation
// profile, `packages/fs`'s ratchet, `wac test --coverage` — reports a plausible number either way.
//
// **This exists because an instrument swapped under the whole repository and nothing failed.**
// `harness/wacBind.ts`'s profiling branch used to build with the reference while every other
// coverage consumer used wacc (`issues/system/0163`). Fixing that changed which instrument produced
// every profile, and the only visible evidence was a total moving 0.8% — in the direction that looks
// like *less* coverage, which is the direction nobody investigates. 3444 tests passed across the
// change because none of them asserts a point count.
//
// So this does not assert that the two agree. **They do not, and that is a fact worth pinning
// rather than hiding:** wacc emits an `else` point for every `if`, the reference only where an
// `else` is written, so `inflate.wac` is `else=7` against `else=75`. Neither is wrong — an `if` with
// no `else` still has a path not taken. What must not happen silently is the set of *kinds* changing,
// or the difference spreading to a kind where the two are supposed to agree.

import { wacCompile } from "wac/wacCompile.ts";
import { wacFiles } from "./wacFiles.ts";
import { parseCovTable, waccApi } from "./waccBuild.ts";
import { ROOT } from "./programs.ts";

const SUBJECT = "packages/gzip/src/inflate.wac";

/** Every kind either compiler emits, and how many. */
function kinds(points: { kind: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of points) m.set(p.kind, (m.get(p.kind) ?? 0) + 1);
  return m;
}

Deno.test("both compilers instrument the same kinds of point, and differ only on `else`", async () => {
  const files = await wacFiles(`${ROOT}/${SUBJECT}`);
  const r = wacCompile(files, `${ROOT}/${SUBJECT}`, { coverage: true });
  if (!r.ok) throw new Error(`the reference did not compile ${SUBJECT}`);
  const paths = [...files.keys()], sources = paths.map((p) => files.get(p)!);
  // deno-lint-ignore no-explicit-any
  const api = await waccApi() as any;
  const wacc = parseCovTable(
    api.covTableFiles(paths, sources, `${ROOT}/${SUBJECT}`) as string,
    `${ROOT}/${SUBJECT}`,
  );

  const a = kinds(r.compiled.coverage ?? []), b = kinds(wacc);
  if (a.size === 0 || b.size === 0) throw new Error("one side produced no points at all");

  // The kinds themselves must match. A kind one compiler emits and the other does not is a whole
  // class of branch that one of them cannot see, and it would show up as a coverage number rather
  // than as an error.
  const onlyRef = [...a.keys()].filter((k) => !b.has(k)).sort();
  const onlyWacc = [...b.keys()].filter((k) => !a.has(k)).sort();
  if (onlyRef.length > 0 || onlyWacc.length > 0) {
    throw new Error(
      `the two coverage instruments no longer emit the same kinds of point.\n` +
        `  reference only: ${onlyRef.join(", ") || "(none)"}\n` +
        `  wacc only:      ${onlyWacc.join(", ") || "(none)"}\n` +
        `A kind only one of them emits is a class of branch the other cannot see, and every ` +
        `coverage figure stays plausible while it is missing.`,
    );
  }

  // Counts must agree on everything except `else`, whose difference is understood: wacc emits one
  // per `if`, the reference one per written `else`. If a second kind starts differing, the two have
  // drifted somewhere nobody decided about.
  const differing = [...a.keys()].filter((k) => a.get(k) !== b.get(k)).sort();
  if (differing.join() !== "else") {
    throw new Error(
      `expected the two instruments to differ only on \`else\`; they differ on ` +
        `${differing.join(", ") || "nothing"}.\n` +
        differing.map((k) => `  ${k}: reference ${a.get(k)}, wacc ${b.get(k)}`).join("\n") +
        `\nIf this is a deliberate change, say which instrument the repository's coverage figures ` +
        `are on and update this test; a silent drift here rescales every one of them.`,
    );
  }

  // And the difference is the specific one, not merely non-zero: wacc's `else` count is its `then`
  // count, because it emits the not-taken path of every `if`.
  if (b.get("else") !== b.get("then")) {
    throw new Error(
      `wacc emitted ${b.get("else")} \`else\` points against ${b.get("then")} \`then\`. They pair ` +
        `because every \`if\` has a path not taken; if they no longer do, wacc has stopped ` +
        `instrumenting some \`if\` and its coverage will read *higher* for it.`,
    );
  }
});
