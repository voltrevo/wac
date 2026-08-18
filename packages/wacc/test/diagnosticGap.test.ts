// Where wacc's diagnostics stop, measured against the reference compiler's.
//
// Every other oracle in this package compares the two by position and count, and a position is a
// shape rather than a sentence: it can be right while the compiler is unusable. Four error codes
// each meaning two different errors were invisible to all of them, because none reads a code. This
// is the test that consumes the output.
//
// **It used to run two command lines.** `wacx` and `waccx` were the same CLI over the two
// compilers, and this compared their stderr. Both are retired, and neither was ever the subject:
// the CLIs shared a graph reader and a formatter precisely so that the only difference between them
// was the compiler in the middle. So the comparison is made where it always was — `wacCompile`
// against `diagnoseFiles`, rendered by the one `wacDiag` they both used — and what goes is a
// process, a capability shim and a filesystem in a Map, none of which was being measured.
//
// TypeScript rather than wac, and not by preference: the reference compiler is TypeScript, so a
// test that holds wac's compiler against it has to be able to call both.

import { wacBind } from "../../../harness/wacBind.ts";
import { parseDiagnostics } from "../tools/wireDiagnostics.ts";
import { wacDiag } from "wac/wacDiag.ts";
import { wacCompile } from "wac/wacCompile.ts";
import { singleFileCases } from "./specCases.ts";

type Api = { diagnoseFiles(paths: string[], sources: string[], entry: string): string };
const api = await wacBind("packages/wacc/src/api.wac") as unknown as Api;

/** What wacc says about one file, rendered the way the retired CLI rendered it. */
function ours(path: string, src: string): { refused: boolean; text: string } {
  const wire = api.diagnoseFiles([path], [src], path);
  const diags = parseDiagnostics(wire);
  return {
    refused: diags.some((d) => d.severity !== "warning"),
    text: wacDiag(diags, new Map([[path, src]])),
  };
}

/** What the reference says about the same file, through the same formatter. */
function theirs(path: string, src: string): { refused: boolean; text: string } {
  const files = new Map([[path, src]]);
  const result = wacCompile(files, path, {});
  return { refused: !result.ok, text: wacDiag(result.diagnostics, files) };
}

Deno.test("the two compilers, on the same programs — where wacc's diagnostics stop", () => {
  // Programs both compilers refuse, so the comparison is about what they *say* rather than whether
  // they agree that something is wrong. Kept small and hand-written: this measures the shape of a
  // diagnostic, and the spec corpus already measures which programs are refused.
  const cases: Record<string, string> = {
    "bool": `export i32 f(i32 w) { if (w) { return 0; } return 1; }`,
    "assign": `export i32 f() { i32 x = 1.5; return x; }`,
    "const": `export i32 f(const i32[] xs) { xs[0] = 1; return 0; }`,
    "undefined": `export i32 f() { return nope; }`,
    "return": `export i32 f() { return true; }`,
  };

  let both = 0, sameLine = 0, sameMessage = 0, theirsAnnotated = 0, oursAnnotated = 0;
  const at = (t: string) => (t.match(/main\.wac:(\d+):(\d+)/) ?? [])[0] ?? "";
  const said = (t: string) => (t.match(/^error: (.*)$/m) ?? [])[1] ?? "";

  for (const [name, src] of Object.entries(cases)) {
    const a = ours("main.wac", src);
    const b = theirs("main.wac", src);
    if (!a.refused || !b.refused) continue;
    both++;
    if (at(a.text) === at(b.text)) sameLine++;
    if (said(a.text) === said(b.text)) sameMessage++;
    // The annotation is the text after the `^^^` underline; the hint is the `= help:` line.
    if (/\^+ \S/.test(b.text) || b.text.includes("= help:")) theirsAnnotated++;
    if (/\^+ \S/.test(a.text) || a.text.includes("= help:")) oursAnnotated++;
    if (name === "bool" && !a.text.includes("condition must be bool")) {
      throw new Error(`the wording the spec quotes is gone:\n${a.text}`);
    }
  }

  console.log(
    `    wacc vs the reference on ${both} refused programs: ${sameLine} at the same position, ` +
      `${sameMessage} with the same message, annotation-or-hint on ${oursAnnotated} of ours ` +
      `against ${theirsAnnotated} of theirs`,
  );

  if (both === 0) throw new Error("neither compiler refused anything — the harness is not working");
  // The one property that must hold today: where wacc speaks, it speaks about the right place.
  if (sameLine !== both) throw new Error(`${both - sameLine} diagnostics at a different position`);
});

Deno.test("how many of wacc's diagnostics carry their operands", () => {
  // The count across the spec's whole refused corpus rather than a handful of hand-written cases,
  // because the hand-written ones are the sites somebody has already been through. `report` takes a
  // code and a position at 135 call sites and the operands at ten of them; this says what that is
  // worth where it is actually used, which is the number to move.
  let diagnostics = 0, annotated = 0, hinted = 0, spanned = 0;
  for (const c of singleFileCases()) {
    if (c.ok) continue;
    const [path, src] = c.files[0];
    const wire = api.diagnoseFiles([path], [src], path);
    for (const line of wire.split("\n")) {
      if (line === "") continue;
      // **Recorded, not wide.** A correct span for `;` is 1, so counting `span > 1` would measure
      // how long the tokens happened to be. The wire carries `0` where nothing measured a width,
      // which is what makes "we did not look" distinguishable from "one character is the truth" —
      // so this reads the raw column rather than the rendered one, where a zero is already a one.
      if (Number(line.split("\t")[7]) > 0) spanned++;
    }
    for (const d of parseDiagnostics(wire)) {
      diagnostics++;
      if (d.annotation !== undefined && d.annotation !== "") annotated++;
      if (d.hint !== undefined && d.hint !== "") hinted++;
    }
  }

  const pct = (n: number) => (diagnostics === 0 ? 0 : Math.round((n / diagnostics) * 100));
  console.log(
    `    of ${diagnostics} diagnostics over the spec's refused programs: ` +
      `operands on ${annotated} (${pct(annotated)}%), ` +
      `help on ${hinted} (${pct(hinted)}%), ` +
      `a real span on ${spanned} (${pct(spanned)}%)`,
  );
  if (diagnostics === 0) throw new Error("no diagnostics at all — the harness is not working");

  // **A ratchet, because a number nobody holds is a number that drifts.** These were 73/24/54, then
  // 79/42/59, and on 2026-08-15 help reached 46 (six more codes got a hint that says something the
  // message does not) and the span 66 (`undefined type`, the largest spanless group at 47 of 264,
  // reports at its token). The floors are a few points under, so ordinary movement does not fail
  // the suite and a *regression* does. Raise them when you raise the numbers.
  const floors: [string, number, number][] = [
    ["operands", pct(annotated), 76],
    ["help", pct(hinted), 43],
    ["a real span", pct(spanned), 63],
  ];
  const fallen = floors.filter(([, now, floor]) => now < floor)
    .map(([what, now, floor]) => `${what}: ${now}%, was at least ${floor}%`);
  if (fallen.length > 0) {
    throw new Error(`the diagnostics ratchet slipped:\n  ${fallen.join("\n  ")}`);
  }
});
