// The case corpus, run against this compiler.
//
// `spec/cases` holds the smallest program that shows each thing a compiler has got wrong here, with
// its expectation written at the top rather than derived from anything. This asserts the reference
// meets them — which is what makes them worth handing to another compiler, since a case the
// reference fails is a case whose expectation is in doubt.
//
// `packages/wacc/test/cases.test.ts` runs the same files against wacc and prints how many it meets.

import { loadCases } from "../spec/cases/cases.ts";
import { wacCompile } from "./wacCompile.ts";
import { wacInstance } from "./wacInstance.ts";

const cases = await loadCases();

Deno.test("cases: every case says what it is and what it wants", () => {
  if (cases.length < 20) throw new Error(`only ${cases.length} cases loaded`);
  const kinds = new Set(cases.map(c => c.expect.kind));
  // A corpus of nothing but rejections would say nothing about what a compiler must accept, and the
  // negative cases are half of why this exists.
  for (const want of ["emits", "refused", "answers", "traps"]) {
    if (!kinds.has(want as "emits")) throw new Error(`no case expects ${want}`);
  }
});

Deno.test("cases: the reference meets every one of them", async () => {
  const wrong: string[] = [];
  for (const c of cases) {
    const files = new Map(c.files);
    const r = wacCompile(files, c.entry);

    if (c.expect.kind === "refused") {
      if (r.ok) wrong.push(`${c.name}: compiled, and the case says it must not — ${c.why}`);
      continue;
    }
    if (!r.ok) {
      wrong.push(`${c.name}: refused — ${r.diagnostics[0]?.message ?? "no diagnostic"}`);
      continue;
    }
    if (c.expect.kind === "emits") continue;

    const inst = await wacInstance(r.compiled);
    let got: unknown;
    try {
      got = inst.call(c.expect.fn, []);
    } catch (e) {
      // A trap is what a `traps` case wants and the failure of every other kind. Only a
      // `RuntimeError` counts: a host-side `TypeError` from the boundary is the harness being
      // wrong about the program, not the program trapping.
      if (c.expect.kind === "traps" && e instanceof WebAssembly.RuntimeError) continue;
      wrong.push(`${c.name}: ${c.expect.fn}() trapped — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (c.expect.kind === "traps") {
      wrong.push(`${c.name}: ${c.expect.fn}() answered ${String(got)}, and the case says it must trap`);
      continue;
    }
    if (String(got) !== c.expect.value) {
      wrong.push(`${c.name}: ${c.expect.fn}() answered ${String(got)}, the case says ${c.expect.value}`);
    }
  }
  console.log(`    cases: ${cases.length - wrong.length} of ${cases.length} met by the reference`);
  if (wrong.length > 0) throw new Error(`the reference does not meet its own cases:\n  ${wrong.join("\n  ")}`);
});
