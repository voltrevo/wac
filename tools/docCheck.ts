// Doc checks warn; they do not fail the shared suite.
//
//     import { docTest } from "./docCheck.ts";
//     docTest("every relative link points at a file that exists", () => { … });
//
// A check over prose — a stale figure, a link to a moved file, a README signature that has drifted
// from its source — is worth having and is not worth a red suite. The suite takes four to eleven
// minutes and three agents share five cores, so a broken link stopping everyone's push costs far
// more than the link does. Docs are changed optimistically; the checks report afterwards.
//
// ## The failure this deliberately accepts
//
// **A warning nobody reads is the same as no check.** `tools/siblingpath.test.ts` describes that
// shape from the other side: the same bug "is found where it is loud and survives where it is
// quiet". So warning is the default and not the only mode —
//
//     wac task test          doc problems are printed, the suite stays green
//     wac task docs          the same checks, failing, for when you want them to
//
// — and `tools/runTests.wac` prints how many warnings a run produced, so they land in the footer
// instead of eight hundred lines up.
//
// ## Why the whole test is wrapped rather than each assertion
//
// These six files hold about thirty assertion sites between them, each with a message written for a
// reader. Rewriting them to return problem lists would churn all of that and risk losing the
// wording, which is most of what makes a doc check useful. Catching at the test boundary keeps every
// message exactly as it was.

/** Set by `wac task docs`; anything else warns. */
export function strict(): boolean {
  return Deno.env.get("WAC_DOCS_STRICT") === "1";
}

/**
 * Where a run's warnings are counted.
 *
 * A file rather than a variable because every test file is its own process, so a total has to
 * survive them — and the runner reads it once at the end.
 */
const TALLY = "/tmp/wac-doc-warnings";

/**
 * A test whose subject is a document.
 *
 * Identical to `Deno.test` except that a failure is printed and the test passes — unless
 * `WAC_DOCS_STRICT=1`, which is what makes `wac task docs` a real gate.
 */
export function docTest(name: string, fn: () => void | Promise<void>): void {
  Deno.test(name, async () => {
    try {
      await fn();
    } catch (e) {
      if (strict()) throw e;
      const why = e instanceof Error ? e.message : String(e);
      console.warn(
        `\n  DOC WARNING — ${name}\n` +
          why.split("\n").map((l) => `    ${l}`).join("\n") +
          `\n    (docs do not fail the suite; \`wac task docs\` makes them)\n`,
      );
      try {
        // Best-effort: a tally that cannot be written is not worth failing a run over, which would
        // be this file defeating its own argument.
        Deno.writeTextFileSync(TALLY, "x", { append: true, create: true });
      } catch { /* the count is a convenience */ }
    }
  });
}

/** How many doc warnings this run produced, and reset for the next one. */
export function warningsSoFar(): number {
  try {
    const n = Deno.readTextFileSync(TALLY).length;
    Deno.removeSync(TALLY);
    return n;
  } catch {
    return 0;
  }
}

/** Called before a run, so a previous one's tally is not counted twice. */
export function clearWarnings(): void {
  try {
    Deno.removeSync(TALLY);
  } catch { /* nothing to clear */ }
}
