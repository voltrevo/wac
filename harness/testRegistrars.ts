// Every spelling that registers a Deno test, in one place.
//
// Two tools ask about this and they ask different questions, which is why the list carries a field
// rather than being an array of strings:
//
//   - `tools/discovery.test.ts` asks **does this file declare a test at all**, because a file the
//     runner imports that declares none is a script being executed by accident.
//   - `tools/wac/map.wac` asks **how many tests does this file declare here**, to put a number in a
//     column that the website then reads.
//
// `wacTestRun` separates them. It registers a `Deno.test` per exported `test_*` function in a wac
// file, so a `.test.ts` calling it does declare tests — but its cases are counted on the wac side,
// from `export string test*` in the `.wac` itself. A tool that counted the call as a test would
// count those cases twice, and a tool that ignored the call would call the file testless.
//
// ## Why this is not two lists
//
// It was, and they went out of step. `testBounded` — `Deno.test` with a deadline on the whole case
// — was added to `discovery.test.ts` when the exclusive lane was converted to it, and not to
// `map.ts`, which counts by matching `Deno.test(`. Five files in `ssh` and `tor` stopped having a
// literal `Deno.test(` in them, so 28 tests became invisible: MAP said the suite was smaller, the
// website reads MAP, and the number was on its way to the front page before a sanity check caught
// it falling rather than rising.
//
// Nothing was wrong with either tool. The list was in two places and only one of them was updated,
// which is a thing a comment asking people to keep two files in step cannot prevent — the previous
// fix was exactly that comment. So the list is here, and adding a spelling means answering the one
// question that was implicit and got missed: does it declare its cases in this file, or somewhere
// else?

/** A call that registers at least one `Deno.test`. */
export type Registrar = {
  /** The call as it appears in source, including the opening parenthesis. */
  readonly call: string;
  /**
   * Whether the cases it registers are declared *in this file*.
   *
   * False for a delegating registrar, whose cases are counted wherever they are actually written.
   */
  readonly countsHere: boolean;
};

export const REGISTRARS: readonly Registrar[] = [
  { call: "Deno.test(", countsHere: true },
  // `Deno.test` with a deadline around the case, so a wedged test costs a line rather than an hour.
  { call: "testBounded(", countsHere: true },
  // `Deno.test` whose subject is a document: it warns instead of failing, so the suite stays green
  // for a stale figure or a moved link. Still a test, and still counted here — `tools/docCheck.ts`
  // has the argument, and `deno task docs` is the same checks with teeth.
  { call: "docTest(", countsHere: true },
  // Delegates: one `Deno.test` per `export string test*` in a wac file, counted from the wac.
  { call: "wacTestRun(", countsHere: false },
];

/** Whether `source` declares a test by any spelling — the question `discovery.test.ts` asks. */
export function declaresTest(source: string): boolean {
  return REGISTRARS.some((r) => source.includes(r.call));
}

/** How many tests `source` declares *here* — the question `map.ts` asks. */
export function countTestsDeclaredHere(source: string): number {
  let n = 0;
  for (const r of REGISTRARS) {
    if (!r.countsHere) continue;
    // Split rather than a built regex: the calls contain `.` and `(`, and an escape helper written
    // for three literals is more to get wrong than to do without.
    n += source.split(r.call).length - 1;
  }
  return n;
}

/** One `wacTestRun` call whose arguments are written as literals. */
export type WacRegistration = {
  /** The `.wac` file, as written — repo-relative. */
  readonly entry: string;
  /** The label argument, or undefined when the call leaves it to default to the file's stem. */
  readonly prefix?: string;
};

/**
 * The `wacTestRun` calls in a `.test.ts`, and how many could not be read.
 *
 * **`unresolved` is the point of the return shape.** A call written with a variable —
 * `await wacTestRun(path)` — cannot be resolved from the text, and a reader that silently skipped it
 * would be saying "this file registers nothing" about a file that registers something. For a tool
 * deciding which tests to run, that is the difference between a narrowed selection and an empty one,
 * and an empty selection is scored as a passing suite. Count it and let the caller refuse.
 *
 * No file in the tree spells it that way as of 2026-08-18 — the one that did was a test of the
 * runner itself, retired by `issues/system/0161` — so `harness/wacTestNames.test.ts` asserts the
 * repository's count is zero and covers the reading with a synthetic source. The shape stays because
 * what it prevents is silent: a spelling this cannot read arrives as a file whose tests a
 * native-profile reader thinks do not exist, not as an error.
 */
export function wacTestRegistrations(
  source: string,
): { found: WacRegistration[]; unresolved: number } {
  const total = source.split("wacTestRun(").length - 1;
  const found: WacRegistration[] = [];
  const re = /wacTestRun\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)")?/g;
  for (const m of source.matchAll(re)) {
    found.push(m[2] === undefined ? { entry: m[1] } : { entry: m[1], prefix: m[2] });
  }
  return { found, unresolved: total - found.length };
}
