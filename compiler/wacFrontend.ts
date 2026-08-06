// The frontends: source text in, `Program` out.
//
// wac has two surfaces — `.wac` and `.wapy` — and the language has no opinion about which one a
// file is written in. They share a parser for expressions and types, an AST, a resolver, a
// checker and an emitter; they differ only in how a file is laid out, which is over by the time
// anything here returns.
//
// This is the whole of that difference, in one table. Everything downstream takes a `Program`
// and cannot tell which frontend produced it, which is the property that makes a `.wac` file
// importing a `.wapy` file unremarkable rather than a feature.
//
// ## The extension is not decoration
//
// It selects the frontend, so a file whose extension is not in the table is an error rather
// than an assumption. wac used to accept any extension and treat it as wac; that was harmless
// while there was one frontend and is not harmless now.

import { wacLex } from "./wacLex.ts";
import { type Import, type ParseError, type Program, wacParse } from "./wacParse.ts";
import { wapyParse } from "./wapyParse.ts";

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

const wapy: Frontend = (src, file) => {
  const { program, errors } = wapyParse(src, file);
  return { program, errors: errors.map((e) => ({ ...e, phase: "parse" as const })) };
};

export const FRONTENDS = new Map<string, Frontend>([
  [".wac", wac],
  [".wapy", wapy],
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
