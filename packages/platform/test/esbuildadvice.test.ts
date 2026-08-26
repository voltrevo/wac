// The two strings a bundle failure and a slow bundle put in front of somebody.
//
//     deno test -A packages/platform/test/esbuildadvice.test.ts
//
// ## Why this is a `.test.ts` and not a `*_test.wac`
//
// The repository's rule is that new tests are written in wac. These two are exported TypeScript
// functions in `packages/platform/build.ts`, and reaching them from wac means spawning Deno to print
// a string and parsing it back — which tests the spawning. The subject is TypeScript, so the test is.
//
// ## What is being guarded
//
// GitHub issue 22 reported this twice, months apart: the hosted-command build sits silent and then
// fails on an npm URL. **~72 seconds in August and ~74 on a later tour**, from a command the guide
// calls offline. The fix is a line while it waits and a sentence when it fails.
//
// The advice is only worth having if the package name is right. `deno cache npm:@esbuild/linux-x64`
// on an arm machine **succeeds** and fixes nothing, so a wrong triple is worse than no advice: it
// costs a download and leaves the reader believing they have done the thing. That is what most of
// this file is about — esbuild's names are node's `process.platform`/`arch`, not Rust's target
// triple, and `Deno.build` speaks Rust's.

import { bundleFailure, esbuildPackage } from "../build.ts";

Deno.test("the esbuild package name is node's spelling, not Rust's", () => {
  const cases: [string, string, string][] = [
    ["linux", "x86_64", "@esbuild/linux-x64"],
    ["linux", "aarch64", "@esbuild/linux-arm64"],
    ["darwin", "x86_64", "@esbuild/darwin-x64"],
    ["darwin", "aarch64", "@esbuild/darwin-arm64"],
    // `win32` rather than `windows`, which is the one nobody guesses right.
    ["windows", "x86_64", "@esbuild/win32-x64"],
  ];
  for (const [os, arch, want] of cases) {
    const got = esbuildPackage(os, arch);
    if (got !== want) throw new Error(`${os}/${arch}: got ${got}, want ${want}`);
  }
});

Deno.test("this machine's answer is a package name and not a Rust triple", () => {
  // The default path — the one every real caller takes — rather than only the table above, because
  // the table would pass with the defaults wired to nothing.
  const got = esbuildPackage();
  if (!got.startsWith("@esbuild/")) throw new Error(`not a package: ${got}`);
  if (/x86_64|aarch64|windows/.test(got)) {
    throw new Error(`this is Rust's spelling and npm will not find it: ${got}`);
  }
});

Deno.test("a bundle failure that mentions npm carries the advice, and names the fetch", () => {
  const said = 'error: Could not resolve "npm:@esbuild/linux-arm64"\n' +
    "  failed to fetch https://registry.npmjs.org/@esbuild%2flinux-arm64\n";
  const msg = bundleFailure(said, "@esbuild/linux-arm64");
  // The bundler's own words survive: the advice is added to them, never instead of them.
  if (!msg.includes(said)) throw new Error("the bundler's stderr was dropped");
  if (!msg.includes("deno cache npm:@esbuild/linux-arm64")) {
    throw new Error(`no prefetch command:\n${msg}`);
  }
  // **The offline answer, which is the half that matters most.** Somebody with no network cannot act
  // on `deno cache`, and the binary needs no bundler — so a message that stops at the prefetch is
  // telling them to wait for something they may not be able to get.
  if (!msg.includes("seed.sh --bootstrap")) throw new Error(`no offline route:\n${msg}`);
});

Deno.test("a failure that is not the fetch is left alone", () => {
  // The guard against advice on every failure, which is how advice stops being read. A syntax error
  // in generated glue is our bug and `deno cache` is not the answer to it.
  const said = "error: Expected ';', got '}' at file:///tmp/x/worker.ts:12:1\n";
  const msg = bundleFailure(said, "@esbuild/linux-arm64");
  if (!msg.includes(said)) throw new Error("the bundler's stderr was dropped");
  if (msg.includes("deno cache")) throw new Error(`advice on an unrelated failure:\n${msg}`);
  if (msg.includes("seed.sh")) throw new Error(`advice on an unrelated failure:\n${msg}`);
});

Deno.test("the two branches really are different, which is what makes the pair mean something", () => {
  // The canary. Both assertions above pass if `bundleFailure` returns the stderr unchanged every
  // time — one because the advice is absent and the other because... it checks for absence too. This
  // is the one that fails if the npm branch quietly stops firing.
  const withNpm = bundleFailure("failed to fetch https://registry.npmjs.org/x", "@esbuild/p");
  const without = bundleFailure("Expected ';'", "@esbuild/p");
  if (withNpm.length <= without.length + 20) {
    throw new Error(`the npm branch added nothing:\n${withNpm}`);
  }
});
