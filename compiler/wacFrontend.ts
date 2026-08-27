// The frontend: source text in, `Program` out.
//
// **One entry, since 2026-08-27.** wac has two surfaces — `.wac` and `.wapy` — and this table had
// both, because the reference was the only thing that could read the second. `packages/wacc` reads
// it now (`issues/lang/0279a`), the playground and `site/tools/site.test.ts` ask wacc about every
// example, and `design/lang/0003`'s standing exception — *"the bootstrap and wapy"* — is discharged.
// So compiler/wapyParse.ts went, and the reference is the bootstrap compiler and nothing else.
//
// The table stays a table rather than collapsing into a call. It is the shape of the rule below,
// and a second surface arriving is a row rather than a rewrite.
//
// ## The extension is not decoration
//
// It selects the frontend, so a file whose extension is not in the table is an error rather
// than an assumption. wac used to accept any extension and treat it as wac; that was harmless
// while there was one frontend and is not harmless now.
//
// **A `.wapy` file reaches that error**, and that is the intended answer rather than an oversight:
// the reference cannot read wapy, and the thing to do about it is to use `wac`. Falling back to the
// wac frontend would report a cascade of parse errors starting at the `@` of `@export`, which is
// how a reader learns the wrong thing.

import { wacLex } from "./wacLex.ts";
import { type Import, type ParseError, type Program, wacParse } from "./wacParse.ts";

/** A parse error, tagged with the phase that raised it. */
export type FrontendError = ParseError & { phase: "lex" | "parse" };

export type Frontend = (src: string, file: string) => {
  program: Program;
  errors: FrontendError[];
};

const wac: Frontend = (src, file) => {
  const { tokens, errors: lexErrs } = wacLex(src);
  // Parsed even after a lex error, for the extra diagnostics recovery finds.
  const { program, errors } = wacParse(tokens, file);
  return {
    program,
    errors: [
      ...lexErrs.map((e) => ({ ...e, file, phase: "lex" as const })),
      ...errors.map((e) => ({ ...e, phase: "parse" as const })),
    ],
  };
};

export const FRONTENDS = new Map<string, Frontend>([
  [".wac", wac],
]);

/** The extensions a wac program may be written in, for diagnostics that have to list them. */
export const EXTENSIONS = [...FRONTENDS.keys()];

export function frontendFor(path: string): Frontend | undefined {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? undefined : FRONTENDS.get(path.slice(dot));
}

/**
 * Which **files** a program imports — the list a loader has to go and read.
 *
 * Read off the parsed program, so neither frontend needs a second way to find them and no
 * amount of `import` inside a comment or a string can send the walk off to a file that is not
 * there. That was a real bug in the text-matching version.
 *
 * A prefixed import (`from core`) is not here, because there is no file to fetch: the provider
 * supplies it and `wacCompile` puts it in the program map. A loader that included it would go
 * looking for `core` on disk and fail.
 */
export function importsOf(p: Program): string[] {
  return p.items
    .filter((i) => i.tag === "import" && (i as Import).prefix === undefined)
    .map((i) => (i as Import).path);
}
