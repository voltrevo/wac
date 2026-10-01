// wac's vocabulary, as the spec prints it.
//
// **A module of its own so it can be checked.** These live apart from `wac-language.ts` because
// that file imports CodeMirror, and the test holding this list to the grammar appendix runs
// under Deno where those packages do not resolve. A guard that cannot be run is not one.
//
// `site/tools/site.test.ts` is the check; packages/wacc/test/wac/speckeywords_test.wac holds
// wacc's lexer to the same fence, so the highlighter and the compiler agree by both agreeing with
// the document.
/**
 * wac's keywords, as `spec/next/appendices/A-grammar.md` lists them.
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
  "as", "async", "auto", "await", "break", "case", "const", "continue", "coroutine",
  "default", "defer", "do", "else", "enum", "export", "false", "fn", "for", "gen", "if", "import", "is",
  "match", "matches", "namespace", "not", "null", "override", "private", "return", "static", "static_for",
  "static_if", "static_match", "static_trap", "struct", "switch", "symbol", "this", "trap", "true",
  "type", "typeref", "union", "virtual", "void", "while", "yield",
]);
