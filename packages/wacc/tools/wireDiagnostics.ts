// wacc's diagnostics, from the wire form to the shape the shared formatter wants.
//
// `src/api.wac`'s `diagnoseFiles` answers `file\tline\tcol\tphase\tmessage\tannotation\thint\tspan\tseverity`,
// one per line — the boundary carries strings and not structures, because a struct crossing a
// bindgen boundary is a class the other side has to know about and a diagnostic is not worth that.
// This is the only place that knows the field order.
//
// **It lived in `waccx.ts` and outlived it.** That was the second CLI — the same commands as the
// reference toolchain, over the wac-written compiler — and this function was in it because that is
// where it was first needed. Nothing about turning a tab-separated line into a `DiagError` is about
// a command line, and two tests that have nothing to do with either CLI were importing a CLI module
// to get it.

import { type DiagError } from "wac/wacDiag.ts";

/**
 * wacc's diagnostics, as the shared formatter wants them.
 *
 * The annotation is empty for a site that did not record its operands, and omitted rather than
 * blank here so the formatter draws a bare underline instead of a trailing space.
 */
export function parseDiagnostics(wire: string): DiagError[] {
  const out: DiagError[] = [];
  for (const line of wire.split("\n")) {
    if (line === "") continue;
    const [file, ln, col, phase, message, annotation, hint, span, severity] = line.split("\t");
    out.push({
      // **A `warn` phase is a warning**, which `wacDiag.ts` already knows how to render — it prints
      // `${e.severity ?? "error"}` — and this hardcoded the field, so wacc's first warnings came out
      // reading like refusals of a program that compiles. `issues/lang/0126`.
      severity: severity === "warning" ? "warning" : "error",
      message,
      file,
      line: Number(ln),
      col: Number(col),
      phase: phase === "parse" || phase === "lex" ? phase : "typecheck",
      // A recorded width, or one where the checker measured none — see `diagnoseFiles`, which emits
      // `0` for "not measured" precisely so a *measurement* can tell that from a genuine width of 1.
      span: Number(span) > 0 ? Number(span) : 1,
      ...(annotation ? { annotation } : {}),
      ...(hint ? { hint } : {}),
    });
  }
  return out;
}
