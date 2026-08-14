// The case corpus, run against this compiler.
//
// `spec/cases` holds the smallest program that shows each thing a compiler has got wrong here, with
// its expectation written at the top rather than derived from anything. This asserts the reference
// meets them — which is what makes them worth handing to another compiler, since a case the
// reference fails is a case whose expectation is in doubt.
//
// `packages/wacc/test/cases.test.ts` runs the same files against wacc and prints how many it meets.

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

Deno.test("cases: the reference meets every one of them", async () => {
  const wrong: string[] = [];
  let waccOnly = 0;
  for (const c of cases) {
    // **A case the reference is not asked.** The spec targets wacc (design/lang/0003), so a feature
    // the reference does not have is deliberate; without this the first one reads as a failure here
    // and collects an exception list. Counted rather than skipped in silence — the number going up
    // is the shared subset shrinking, which is worth seeing.
    if (c.only === "wacc") { waccOnly++; continue; }
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
  const asked = cases.length - waccOnly;
  console.log(
    `    cases: ${asked - wrong.length} of ${asked} met by the reference` +
      (waccOnly > 0 ? `, ${waccOnly} wacc-only and not asked of it` : ""),
  );
  if (wrong.length > 0) throw new Error(`the reference does not meet its own cases:\n  ${wrong.join("\n  ")}`);
});

// ── The `only: wacc` header, which nothing uses yet ──────────────────────────

Deno.test("cases: a case can be scoped to wacc, and this runner does not ask for it", () => {
  // **A mechanism with no users has never run.** `spec/cases/cases.ts` grew `only: "both" | "wacc"`
  // when `design/lang/0003` made the spec target wacc, and no case carries the header — so grepping
  // the corpus for it finds nothing, which reads as the mechanism being absent. It cost
  // `design/lang/0008` a wrong conclusion on 2026-08-13: that a wacc-only rule could not be
  // expressed and the reference would have to implement it too.
  //
  // Two notes now depend on this path — `0008`'s const rule and `0002`'s bound references — so it is
  // worth knowing it works before one of them is the first to find out.
  const waccOnly = parseCase("0000-x.wac", [
    "// expect: refused",
    "// why: a rule the reference does not have",
    "// only: wacc",
    "export i32 f() { return 0; }",
  ].join("\n"));
  if (waccOnly.only !== "wacc") throw new Error(`"// only: wacc" parsed as ${waccOnly.only}`);

  const both = parseCase("0000-y.wac", [
    "// expect: refused",
    "// why: an ordinary rule",
    "export i32 f() { return 0; }",
  ].join("\n"));
  if (both.only !== "both") throw new Error(`a case with no header parsed as ${both.only}`);

  // **A header is recognised anywhere before the first `// file:` marker, including below the source.**
  // Asserted because it is not what I assumed and it is worth someone knowing: `started` tracks file
  // *sections*, and a single-file case has no marker at all, so it is false for the whole text. The
  // consequence is a trap rather than a bug — a case whose own source contained a line beginning
  // `// only:`, `// expect:` or `// why:` would have it read as a header — and the same is true of
  // every header this loader takes.
  const late = parseCase("0000-z.wac", [
    "// expect: refused",
    "// why: a rule",
    "export i32 f() { return 0; }",
    "// only: wacc",
  ].join("\n"));
  if (late.only !== "wacc") {
    throw new Error("a header below the source is no longer read — which is a better rule, and this " +
      "test asserted the old one; update it rather than reverting the loader");
  }

  // And an unknown scope is refused rather than silently meaning something.
  let refused = "";
  try {
    parseCase("0000-w.wac", ["// expect: refused", "// why: x", "// only: reference", "export i32 f() { return 0; }"].join("\n"));
  } catch (e) {
    refused = e instanceof Error ? e.message : String(e);
  }
  if (!refused.includes("only")) throw new Error(`an unknown scope was accepted: ${refused || "(no error)"}`);
});
