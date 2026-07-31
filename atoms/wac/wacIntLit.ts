// wacIntLit — interpret an integer literal's source text as a width and value.
//
// Shared by the type checker (which needs the width) and the emitter (which
// needs the value), so the two cannot disagree about what a literal means.
//
// Two notations, two rules [see types.md]:
//
//   Decimal is a magnitude. It takes the narrowest type that holds it, so
//   `42` is i32 and `1000000000000` is i64.
//
//   Hex is a bit pattern. Its width comes from the digit count — up to 8
//   digits is i32, up to 16 is i64 — and the digits are read as two's
//   complement at that width. So `0xEDB88320` is the i32 -306674912 rather
//   than an i64 3988292384, which is what makes masks and polynomials
//   writable as the constants they are. Padding past the boundary selects the
//   wider type: `0x0EDB88320` is nine digits, so it is the positive i64.
//
// Underscores are separators and carry no meaning: `0xEDB8_8320` is `0xEDB88320`.
//
// The lexer never produces a sign — `-16` is unary minus applied to `16` — so
// input is always non-negative and only upper bounds need checking.

export type IntLit =
  /** `value` is already narrowed to `width`, ready to encode. */
  | { ok: true; value: bigint; width: 32 | 64 }
  /** `invalid` — not a parseable integer. `range` — too wide for i64. */
  | { ok: false; reason: "invalid" | "range" };

const I32_MAX = 2147483647n;
const I64_MAX = 9223372036854775807n;

export function wacIntLit(raw: string): IntLit {
  const text = raw.replace(/_/g, "");
  // BigInt("") is 0 rather than an error, so text with no digits at all has to
  // be rejected up front. The lexer never emits such a token, but the rule
  // shouldn't rest on that.
  if (!/[0-9]/.test(text)) return { ok: false, reason: "invalid" };

  let value: bigint;
  try {
    value = BigInt(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (/^0[xX]/.test(text)) {
    const digits = text.length - 2;
    if (digits <= 8)  return { ok: true, value: BigInt.asIntN(32, value), width: 32 };
    if (digits <= 16) return { ok: true, value: BigInt.asIntN(64, value), width: 64 };
    return { ok: false, reason: "range" };
  }

  if (value <= I32_MAX) return { ok: true, value, width: 32 };
  if (value <= I64_MAX) return { ok: true, value, width: 64 };
  return { ok: false, reason: "range" };
}
