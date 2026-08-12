// Generate `src/tables.wac` by asking the host what it knows about every code point.
//
// The host already carries a Unicode database — that is what `toLowerCase` consults — so the
// tables are *derived from the authority* rather than transcribed from it. The same move as
// `packages/codec`, where RFC 4648's own vectors are the oracle: take the data from the thing
// that defines it, then check the result against that same thing from the other direction.
//
// Only simple, single-code-point mappings are emitted. Where the host maps one code point to
// several — `ß` uppercases to `SS`, `ﬁ` to `FI` — the entry is omitted and the code point maps to
// itself. That is the difference between *simple* and *full* case mapping, and the tests assert
// exactly where the boundary falls rather than skipping those code points.
//
//   deno run -A packages/unicode/tools/gentables.ts

const MAX = 0x10ffff;

type Pair = { from: number; to: number };

const lower: Pair[] = [];
const upper: Pair[] = [];
const fold: Pair[] = [];

/**
 * Whether the host considers these two code points the same letter ignoring case.
 *
 * `RegExp`'s `u` mode canonicalizes by Unicode **simple case folding** — a different table from
 * `toLowerCase`, and the only one of the two that is the definition of this function.
 */
function sameLetter(a: number, b: number): boolean {
  return new RegExp("\\u{" + a.toString(16) + "}", "iu").test(String.fromCodePoint(b));
}

/** The single code point `s` maps to, or -1 if it is not exactly one. */
function single(s: string): number {
  const points = [...s];
  return points.length === 1 ? points[0].codePointAt(0)! : -1;
}

for (let cp = 0; cp <= MAX; cp++) {
  // Surrogates are not scalar values and `fromCodePoint` will not make one.
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  const ch = String.fromCodePoint(cp);

  const lo = single(ch.toLowerCase());
  if (lo >= 0 && lo !== cp) lower.push({ from: cp, to: lo });

  const up = single(ch.toUpperCase());
  if (up >= 0 && up !== cp) upper.push({ from: cp, to: up });

  // Simple case folding. The candidate is lower(upper(cp)) rather than lower(cp), because
  // lowercase alone does not unify a *contextual* form with its base — Greek final sigma `ς`
  // lowercases to itself, so `ΣΊΣΥΦΟΣ` and `σίσυφος` would not have compared equal. Going up first
  // collapses both sigmas to `Σ`, and coming back down gives `σ` for each.
  //
  // **A candidate, and then the oracle decides.** Round-tripping through uppercase is not case
  // folding and gets one class wrong in the direction that matters: Turkish dotless `ı`
  // uppercases to `I`, which lowercases to `i`, so `ı` and `i` came out equal — the exact
  // conflation this package's own comment says it does not do. `RegExp` with `iu` canonicalizes
  // by Unicode simple case folding and is not built from `toLowerCase`, so it can say the guess
  // is wrong; `test/unicode.test.ts` asks it about every entry from the other direction.
  //
  // Where neither candidate survives, the fold is the identity, which is also what *simple*
  // folding means for `ß`: it folds to itself, and only full folding turns it into `ss`.
  const viaUpper = up >= 0 ? single(String.fromCodePoint(up).toLowerCase()) : -1;
  const guess = viaUpper >= 0 ? viaUpper : (lo >= 0 ? lo : cp);
  const folded = guess !== cp && sameLetter(cp, guess) ? guess : (lo >= 0 && lo !== cp && sameLetter(cp, lo) ? lo : cp);
  if (folded !== cp) fold.push({ from: cp, to: folded });
}

// **Printability**, as ranges rather than pairs, because it is a predicate and 292,464 code points
// answer yes.
//
// The definition is "assigned, and not a control, a surrogate, or a line/paragraph separator" —
// which is `iswprint` in a UTF-8 locale, and the reason this exists is that `box`'s `wc -w` counts
// a run as a word only when something printable is in it, and had no way to ask.
//
// Checked against glibc's `iswprint` under `C.UTF-8` before it was written: of 1.1 million code
// points the two disagree on **5,185**, every one of them a character this host knows and that
// glibc's older Unicode calls unassigned, and none in the other direction. So this table never
// calls printable something `wc(1)` here would not; it is ahead of it, and by exactly the
// characters added since that glibc.
const printable: Pair[] = [];
{
  const notPrintable = /\p{Cc}|\p{Cn}|\p{Cs}|\p{Zl}|\p{Zp}/u;
  let start = -1;
  for (let cp = 0; cp <= MAX; cp++) {
    const yes = (cp >= 0xd800 && cp <= 0xdfff) ? false : !notPrintable.test(String.fromCodePoint(cp));
    if (yes && start < 0) start = cp;
    if (!yes && start >= 0) { printable.push({ from: start, to: cp - 1 }); start = -1; }
  }
  if (start >= 0) printable.push({ from: start, to: MAX });
}
const printableCount = printable.reduce((n, r) => n + (r.to - r.from + 1), 0);

function emit(name: string, pairs: Pair[]): string {
  const froms = pairs.map(p => p.from).join(", ");
  const tos = pairs.map(p => p.to).join(", ");
  return `/** ${pairs.length} code points. Sorted, so a lookup is a binary search. */\n`
    + `const i32[] ${name}_KEYS = i32[](${froms});\n`
    + `const i32[] ${name}_VALUES = i32[](${tos});\n`;
}

const out = `// Generated by tools/gentables.ts. Do not edit.
//
// Three sorted tables of (code point, mapping) pairs, holding only the code points whose mapping
// differs from themselves — about ${lower.length + upper.length} entries rather than 1.1 million.
// A lookup is a binary search over KEYS and an index into VALUES.
//
// And a fourth of a different shape: printability is a predicate that ${printableCount} code points
// answer yes to, so it is stored as ${printable.length} sorted ranges rather than as entries.
//
// Simple mappings only: where the host maps one code point to several, there is no entry and the
// code point maps to itself. See the package README.

${emit("LOWER", lower)}
${emit("UPPER", upper)}
${emit("FOLD", fold)}
/**
 * ${printable.length} ranges of printable code points, sorted and disjoint: \`PRINT_KEYS[i]\` is the first
 * of a range and \`PRINT_VALUES[i]\` the last. Printable means assigned and not a control, a surrogate
 * or a line/paragraph separator — \`iswprint\` in a UTF-8 locale. See the generator for what it was
 * checked against.
 */
const i32[] PRINT_KEYS = i32[](${printable.map(p => p.from).join(", ")});
const i32[] PRINT_VALUES = i32[](${printable.map(p => p.to).join(", ")});

/** Binary search: the mapping for \`cp\`, or \`cp\` itself. */
i32 lookup(const i32[] keys, const i32[] values, i32 cp) {
  i32 lo = 0;
  i32 hi = keys.len() - 1;
  while (lo <= hi) {
    i32 mid = lo + (hi - lo) / 2;
    if (keys[mid] == cp) { return values[mid]; }
    if (keys[mid] < cp) { lo = mid + 1; } else { hi = mid - 1; }
  }
  return cp;
}

export i32 simpleLower(i32 cp) { return lookup(LOWER_KEYS, LOWER_VALUES, cp); }
export i32 simpleUpper(i32 cp) { return lookup(UPPER_KEYS, UPPER_VALUES, cp); }
export i32 simpleFold(i32 cp) { return lookup(FOLD_KEYS, FOLD_VALUES, cp); }

/**
 * Whether \`cp\` is a printable character.
 *
 * A binary search for the last range that starts at or before \`cp\`, then one comparison against its
 * end — the ranges are disjoint, so at most one can contain it.
 */
export bool isPrintable(i32 cp) {
  i32 lo = 0;
  i32 hi = PRINT_KEYS.len() - 1;
  i32 found = -1;
  while (lo <= hi) {
    i32 mid = lo + (hi - lo) / 2;
    if (PRINT_KEYS[mid] <= cp) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return found >= 0 && cp <= PRINT_VALUES[found];
}
`;

await Deno.writeTextFile("packages/unicode/src/tables.wac", out);
console.log(`lower ${lower.length}, upper ${upper.length}, fold ${fold.length}`);
console.log(`wrote packages/unicode/src/tables.wac (${(out.length / 1024).toFixed(1)} KiB)`);
