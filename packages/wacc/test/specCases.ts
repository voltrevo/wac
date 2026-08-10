// The spec's own programs, as the spec suite ran them.
//
// `specCorpus.ts` reads `wacSpec.test.ts` as text and finds 101 illegal programs. The suite executes
// **319**. The difference is not a bug in that extractor so much as the ceiling of reading a file
// whose test data is wac source inside TypeScript template literals: what it can find are the calls
// written in a shape a regular expression can recognise, and the spec does not confine itself to one
// shape. `tools/specCases.ts` records what the compiler was actually handed instead, so the corpus is
// the suite's own behaviour and grows whenever the spec does.
//
// Keys are `${test}#${nth}` over the whole corpus, because one test states several programs — and an
// ordinal only means something against the sequence that produced it, so everything that names a case
// gets its key from `keyed` here rather than by counting.

export type Case = {
  test: string;
  entry: string;
  files: [string, string][];
  ok: boolean;
  /** The reference's first diagnostic, for reading a report — never something wacc must reproduce. */
  message: string;
};

type Corpus = { source: string; sha256: string; cases: Case[] };

const corpus: Corpus = JSON.parse(
  Deno.readTextFileSync(new URL("./specCases.json", import.meta.url)),
);

/** Every recorded case, in the order the suite ran them. */
export function specCases(): Case[] {
  return corpus.cases;
}

/** The ones a single file states — what `err(...)` and `run(...)` compile. */
export function singleFileCases(): Case[] {
  return corpus.cases.filter(c => c.files.length === 1);
}

/** The ones that take more than one file — imports, export visibility, cross-file identity. */
export function multiFileCases(): Case[] {
  return corpus.cases.filter(c => c.files.length > 1);
}

/** `${test}#${nth}` for every case, numbered over the whole corpus. */
export function keyed(): Map<Case, string> {
  const seen = new Map<string, number>();
  const out = new Map<Case, string>();
  for (const c of corpus.cases) {
    const nth = seen.get(c.test) ?? 0;
    seen.set(c.test, nth + 1);
    out.set(c, `${c.test}#${nth}`);
  }
  return out;
}

/**
 * Fails when a ledger names a case the corpus no longer contains.
 *
 * A named case that has gone is worse than an unnamed one: it reads as coverage and asserts nothing.
 */
export function assertKeysExist(ledger: Set<string>, keys: Map<Case, string>, what: string): void {
  const live = new Set(keys.values());
  const stale = [...ledger].filter(k => !live.has(k));
  if (stale.length) {
    throw new Error(`${what} names cases the corpus does not contain:\n  ${stale.join("\n  ")}`);
  }
}

/** The digest of the suite this corpus was taken from, for the staleness check. */
export function recordedHash(): string {
  return corpus.sha256;
}
