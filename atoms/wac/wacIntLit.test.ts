import { type IntLit, wacIntLit } from "./wacIntLit.ts";

function ok(raw: string, value: bigint, width: 32 | 64): void {
  const r: IntLit = wacIntLit(raw);
  if (!r.ok) throw new Error(`${raw}: expected ok, got ${r.reason}`);
  if (r.value !== value) throw new Error(`${raw}: value ${r.value}, expected ${value}`);
  if (r.width !== width) throw new Error(`${raw}: width ${r.width}, expected ${width}`);
}

function bad(raw: string, reason: "invalid" | "range"): void {
  const r: IntLit = wacIntLit(raw);
  if (r.ok) throw new Error(`${raw}: expected ${reason}, got ok (${r.value})`);
  if (r.reason !== reason) throw new Error(`${raw}: reason ${r.reason}, expected ${reason}`);
}

// ── decimal: magnitude picks the width ────────────────────────────────────────

Deno.test("wacIntLit: decimal takes the narrowest type that holds it", () => {
  ok("0", 0n, 32);
  ok("42", 42n, 32);
  ok("2147483647", 2147483647n, 32);            // i32 max
  ok("2147483648", 2147483648n, 64);            // one past i32 max
  ok("1000000000000", 1000000000000n, 64);
  ok("9223372036854775807", 9223372036854775807n, 64); // i64 max
});

Deno.test("wacIntLit: decimal past i64 max is out of range", () => {
  bad("9223372036854775808", "range");          // one past i64 max
  bad("99999999999999999999", "range");
});

// ── hex: digit count picks the width, digits are two's complement ────────────
//
// Values verified in Python:
//   0xEDB88320 - (1 << 32) == -306674912   (the CRC-32 polynomial)
//   0x80000000 - (1 << 32) == -2147483648
//   0xFFFFFFFF - (1 << 32) == -1

Deno.test("wacIntLit: hex under 8 digits is a plain positive i32", () => {
  ok("0x0", 0n, 32);
  ok("0xFF", 255n, 32);
  ok("0x1A2B", 6699n, 32);
  ok("0x7FFFFFFF", 2147483647n, 32);            // 8 digits, high bit clear
});

Deno.test("wacIntLit: 8-digit hex with the high bit set is a negative i32", () => {
  ok("0x80000000", -2147483648n, 32);
  ok("0xEDB88320", -306674912n, 32);            // CRC-32 polynomial
  ok("0xFFFFFFFF", -1n, 32);
  ok("0xDEADBEEF", -559038737n, 32);
});

Deno.test("wacIntLit: 9 to 16 hex digits is i64", () => {
  ok("0x0EDB88320", 3988292384n, 64);           // padding selects the wider type
  ok("0x100000000", 4294967296n, 64);
  ok("0x7FFFFFFFFFFFFFFF", 9223372036854775807n, 64);
  ok("0x8000000000000000", -9223372036854775808n, 64);
  ok("0xFFFFFFFFFFFFFFFF", -1n, 64);            // 16 digits, all set
});

Deno.test("wacIntLit: more than 16 hex digits is out of range", () => {
  bad("0x10000000000000000", "range");          // 17 digits
  bad("0xFFFFFFFFFFFFFFFFF", "range");
});

Deno.test("wacIntLit: uppercase 0X prefix and mixed-case digits", () => {
  ok("0XFF", 255n, 32);
  ok("0xeDb88320", -306674912n, 32);
  ok("0XEDB88320", -306674912n, 32);
});

// ── underscores are separators ────────────────────────────────────────────────

Deno.test("wacIntLit: underscores do not change the value or the width", () => {
  ok("1_000_000", 1000000n, 32);
  ok("0xEDB8_8320", -306674912n, 32);           // still 8 digits -> still i32
  ok("0xFF_FF", 65535n, 32);
  ok("1_000_000_000_000", 1000000000000n, 64);
  // Underscores are stripped before the digits are counted, so they cannot
  // push a literal across the i32/i64 boundary.
  ok("0x7FFF_FFFF", 2147483647n, 32);
  ok("0x0_EDB88320", 3988292384n, 64);          // 9 digits after stripping
});

// ── malformed ─────────────────────────────────────────────────────────────────

Deno.test("wacIntLit: unparseable text is invalid", () => {
  bad("0x", "invalid");                          // prefix with no digits
  bad("0xGG", "invalid");
  bad("", "invalid");
  bad("_", "invalid");
  bad("12abc", "invalid");
});
