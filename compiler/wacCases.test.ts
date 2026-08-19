// The case corpus, run against this compiler.
//
// `spec/cases` holds the smallest program that shows each thing a compiler has got wrong here, with
// its expectation written at the top rather than derived from anything. This asserts the reference
// meets them — which is what makes them worth handing to another compiler, since a case the
// reference fails is a case whose expectation is in doubt.
//
// `packages/wacc/test/wac/cases_test.wac` runs the same files against wacc and prints how many it meets.

import { loadCases, parseCase } from "../spec/cases/cases.ts";
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

// **The reference is not asked to run the cases, and that is the point.** It used to be, with cases
// that used syntax it lacks marked `// only: wacc` and counted. That made the reference a second
// implementation of the language and so a constraint on it: every lambda case needed a marker, and so
// did ordinary code elsewhere in the repository. The reference's only job is bootstrapping wacc — see
// `packages/wacc/test/wac/lexcodes_test.wac` for what is left of the differential that enforced it.
//
// The cases are run by wacc, which is the compiler the spec targets (design/lang/0003).
