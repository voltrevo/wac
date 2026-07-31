// wacFloatLit — the value of a float literal, interpreted in one place.
//
// The sibling of `wacIntLit`, and for the same reason: the emitter, the type checker and the
// constant evaluator all need a literal's value, and when each computed it separately they
// disagreed. `wacIntLit` was written after that happened for integers; this exists because it then
// happened for floats, where all three called `parseFloat` on the raw text.
//
// `parseFloat` is the trap. It stops at the first character it cannot read and returns what it has,
// so `parseFloat("1_000.5")` is `1` — not an error, just quietly wrong [see issue 0044].

/**
 * The value a float literal denotes.
 *
 * Underscores are digit separators and carry no meaning, exactly as in an integer literal. Anything
 * else is the lexer's business: a string reaching here is a well-formed FLOAT_LITERAL, so this does
 * not validate and returns NaN only for input the lexer would not have produced.
 */
export function wacFloatLit(raw: string): number {
  return parseFloat(raw.replace(/_/g, ""));
}
