// A test that builds a binary and runs it has to import the ETXTBSY retry.
//
//     deno test -A tools/spawnretry.test.ts
//
// `harness/spawnRetry.ts` wraps `Deno.Command` so a spawn that fails with "Text file busy" is retried
// instead of failing the suite. Its own header says it is "imported for its side effect by every test file
// that builds something and runs it" — and that sentence was **false for eight files** when this check was
// written. All eight were in `packages/git`, and one of them turned a full gate red.
//
// ## Why a check rather than fixing the eight
//
// Fixing them is one commit; the ninth is written next week. The claim in that header is the kind that
// rots silently, because nothing goes wrong until a machine is loaded enough for the window to open — and
// then it fails in a file nobody has touched, which reads as a flake in the code under test rather than a
// missing import in the test.
//
// **There is a second, quieter cost.** The same module installs the `WAC_PROFILE` coverage wrapper, and it
// has to be installed before `Deno.test` registers a case — which is why a static import is the mechanism
// and why a builder could not arrange it. A file that skipped the import was therefore also writing no
// coverage at all, and nothing said so: the profile was simply smaller than it should have been. That is
// the failure mode `tools/siblingpath.test.ts` describes — the same mistake found where it is loud and
// surviving where it is quiet.
//
// ## What counts as building and spawning
//
// Naming `buildApp` and then constructing a `Deno.Command`. That pairing is what produces a
// freshly-written executable and immediately execs it, which is the whole precondition for ETXTBSY. A test
// that only spawns `git` is not at risk — the binary is weeks old and nobody is writing it — so requiring
// the import there would be noise, and a check that cries wolf gets suppressed rather than fixed.

import { codeLines } from "./deadexports.ts";

/** Every `.test.ts` under the repository, minus the trees the Deno walks already exclude. */
async function testFiles(): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", ".cache", "site", "target"]);
  const walk = async (rel: string) => {
    for await (const e of Deno.readDir(rel)) {
      if (skip.has(e.name)) continue;
      const p = `${rel}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (e.name.endsWith(".test.ts")) out.push(p);
    }
  };
  await walk(".");
  return out.sort();
}

Deno.test("a test that builds an app and spawns it imports the ETXTBSY retry", async () => {
  const missing: string[] = [];
  let atRisk = 0;
  for (const f of await testFiles()) {
    const text = await Deno.readTextFile(f);
    // Comments and string literals removed, so a file *describing* `buildApp` is not counted as using it.
    const code = codeLines(text).join("\n");
    const builds = /\bbuildApp\b/.test(code);
    const spawns = /new Deno\.Command\b/.test(code);
    if (!builds || !spawns) continue;
    atRisk++;
    // **Against the raw text, not `code`, and on the basename.** Two ways to get this wrong, both of
    // which this check made first:
    //
    //   - An import specifier *is* a string literal, so the same stripping that stops a comment counting
    //     as a use also erases the thing being looked for. That version reported 57 files, 49 of which
    //     import it on the line the report pointed past.
    //   - Requiring `harness/` in the path misses `harness/appRun.test.ts`, which is *in* that directory
    //     and writes `./spawnRetry.ts`.
    //
    // Both failed by over-reporting, which is the safe direction and is why they were caught at all. A
    // check of this genre that failed the other way would have said "all clear" and been believed.
    if (!/^\s*import\s+["'][^"']*\bspawnRetry\.ts["']/m.test(text)) missing.push(f);
  }

  // **The check's own reach, asserted.** A regex that matched nothing would report success for ever, which
  // is the failure this genre of tool is most prone to: it cannot tell "everything is fine" from "I looked
  // at nothing". The number is deliberately a floor rather than an exact count, so adding a test file does
  // not fail this one.
  if (atRisk < 10) {
    throw new Error(
      `only ${atRisk} files were found to build and spawn, which is fewer than there have ever been — ` +
        `the pattern this scans for has probably changed, so an empty result means nothing`,
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `${missing.length} test file(s) build a binary and spawn it without importing the retry:\n` +
        missing.map((m) => `  ${m}`).join("\n") +
        `\n\nAdd:  import "../../../harness/spawnRetry.ts";  (adjust the depth)\n` +
        `Without it a loaded machine fails the spawn with "Text file busy", and the file writes no ` +
        `WAC_PROFILE coverage.`,
    );
  }
});
