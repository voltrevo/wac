// The compiler explains itself the same way whichever half of the toolchain you are holding.
//
// `waccx` renders diagnostics with the reference's `wacDiag` and prints a caret under the offending
// token; `example/wacc.wac` — the compiler as a program, and what the `wac` binary dispatches —
// printed the *wire*: eight tab-separated fields, to a person. The binary could compile this
// repository and could not tell anyone what was wrong with a file.
//
// `src/render.wac` is that layout in wac, and this is the check that it is the same layout. Compared
// character for character over programs the checker refuses, because "it explains itself too" is a
// claim about the text: a renderer that dropped the annotation, or put the caret one column off,
// would still look like a diagnostic and would still be wrong.

import { waccApi } from "../../../harness/waccBuild.ts";
import { parseDiagnostics } from "../tools/wireDiagnostics.ts";
import { wacDiag } from "wac/wacDiag.ts";

type Api = {
  diagnoseFiles(paths: string[], sources: string[], entry: string): string;
  diagnoseFilesRendered(paths: string[], sources: string[], entry: string): string;
};

const api = await waccApi() as unknown as Api;

/** Programs chosen for the *shape* of the diagnostic rather than the mistake behind it. */
const CASES: [string, string][] = [
  // A note and a hint, on a one-character span.
  ["a return of the wrong type", `export i32 f() { return "no"; }\n`],
  // A diagnostic on line 12, so the gutter is two digits wide — the one thing in the layout that
  // moves with the input, and the reason a single-case test would not have found a wrong width.
  [
    "a gutter that has grown",
    `${"// filler\n".repeat(11)}export i32 g() { return "no"; }\n`,
  ],
  // Several diagnostics, which are separated by a blank line rather than run together.
  [
    "more than one",
    `export i32 a() { return "no"; }\nexport i32 b() { return "no"; }\n`,
  ],
  // A parse error, which comes from the other phase and through the same renderer.
  ["something unparseable", `export i32 f( {\n`],
  // A name that is not there: no operands recorded, so no annotation — the branch where the caret
  // line ends after the caret.
  ["an unresolved name", `export i32 f() { return nope; }\n`],
];

for (const [what, src] of CASES) {
  Deno.test(`the program renders a diagnostic as waccx does — ${what}`, () => {
    const paths = ["/t/m.wac"], sources = [src];

    const mine = api.diagnoseFilesRendered(paths, sources, "/t/m.wac");
    const theirs = wacDiag(
      parseDiagnostics(api.diagnoseFiles(paths, sources, "/t/m.wac")),
      new Map([["/t/m.wac", src]]),
    );

    // **Asserted, not merely compared.** Two empty strings are equal, and a program that refused
    // nothing would agree with a renderer that rendered nothing.
    if (theirs === "") throw new Error(`${what}: nothing was refused, so nothing was compared`);
    if (!theirs.includes("^")) throw new Error(`${what}: no caret in the reference rendering`);

    if (mine !== theirs) {
      const a = mine.split("\n"), b = theirs.split("\n");
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          throw new Error(
            `${what} — line ${i + 1} differs\n  render.wac: ${JSON.stringify(a[i])}\n` +
              `  wacDiag:    ${JSON.stringify(b[i])}`,
          );
        }
      }
      throw new Error(`${what}: same lines, different length`);
    }
  });
}
