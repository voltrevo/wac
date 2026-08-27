// The words wapy spells differently, which is all that is left of wapy in the reference.
//
// **This was wapy's lexer** — significant indentation, a line tree, comments kept — until
// 2026-08-27, when `packages/wacc/src/wapylex.wac` replaced it and compiler/wapyParse.ts, the
// only caller of `wapyLex()` and `blocks()`, was deleted. What survives is one table, because two
// things outside the reader still need to know how wapy spells a word:
//
//   - `site/src/editor/wac-language.ts` highlights a `.wapy` buffer with it;
//   - `compiler/wapyPrint.ts` renders wac *as* wapy, which is the last thing here that wacc has no
//     replacement for.
//
// The rest — 240 lines of lexing — went with the reader. `spec/spec/wapy.md` is the specification
// and `packages/wacc/src/wapylex.wac` is the implementation.

import { type TokenKind } from "./wacLex.ts";

/**
 * Words wac spells as punctuation or a literal, and wapy spells as words.
 *
 * **`self` was here until 2026-08-27, mapped to `this`.** wapy spells the receiver `this` now, the
 * same as wac, and `self` is an ordinary identifier again.
 *
 * It was the one respelling that cost something. A wac local named `self` had *no wapy rendering* —
 * `issues/lang/0077` — so `packages/wacc/src/check.wac` could not name a local `self`, and a comment
 * beside that local said why. The printer round-trips every file in the repository on each suite
 * run, which made a reserved word in one surface into a rule about identifiers in the other.
 *
 * `and`/`or`/`not`/`None`/`True`/`False` do not have that problem: each is a wapy *keyword* whose
 * wac form is punctuation or a literal, so no wac identifier collides with one. `self` was different
 * because both surfaces were spelling the same *keyword* two ways for the sake of looking Pythonic,
 * and the cost landed on wac.
 */
export const SPELLINGS = new Map<string, TokenKind>([
  ["and", "&&"], ["or", "||"], ["not", "!"],
  ["None", "null"], ["True", "true"], ["False", "false"],
]);
