// wac's vocabulary, as the spec prints it.
//
// **A module of its own so it can be checked.** These live apart from `wac-language.ts` because
// that file imports CodeMirror, and the test holding this list to `spec/spec/grammar.md` runs
// under Deno where those packages do not resolve. A guard that cannot be run is not one.
//
// `site/tools/site.test.ts` is the check; `packages/wacc/test/wac/speckeywords_test.wac` holds
// wacc's lexer to the same fence, so the highlighter and the compiler agree by both agreeing with
// the document.
/**
 * wac's keywords, as `spec/spec/grammar.md` lists them.
 *
 * **`as!`, `as~` and `as@` are deliberately absent**, though the fence has them: this tokeniser
 * matches whole identifier-shaped words, and none of those three is one — they are `as` followed
 * by a character the operator scanner takes. The test that checks this list against the fence
 * excludes exactly them, and would fail if a fourth appeared rather than quietly widening.
 *
 * **`from` is absent too, and for the language's own reason**: it means something only directly
 * after an import clause, so reserving it everywhere cost a parameter named `from` in
 * `slice(a, from, to)`. The tokeniser below still highlights it, by matching it in that position.
 */
export const KEYWORDS = new Set<string>([
  "import", "export", "struct", "const", "this", "override",
  "if", "else", "while", "for", "do", "switch", "case", "default",
  "break", "continue", "return", "trap", "true", "false", "null",
  "is", "not", "as", "void", "fn", "enum", "match",
]);

/**
 * wapy's word spellings of wac's operators and literals, from `spec/spec/wapy.md`'s table.
 *
 * The value is what the word means in wac, which is what makes `and` highlight as an operator
 * rather than as a keyword — it is a `&&`.
 */
export const SPELLINGS = new Map<string, string>([
  ["and", "&&"], ["or", "||"], ["not", "!"],
  ["None", "null"], ["True", "true"], ["False", "false"],
]);
