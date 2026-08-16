// What `wac test --coverage` writes about a file it could only partly run.
//
// The native runner skips a test that declares parameters: those want an **oracle** — an independent
// implementation to compare against — and the host is what supplies one. 31 of this repository's 83
// wac test files are entirely of that kind and 17 more are *mixed*, running some of their tests here
// and needing a host for the rest. `packages/crypto/test/wac/rsa_test.wac` runs 3 of its 12.
//
// A profile that lists only what ran is indistinguishable from a complete one, and a reader taking it
// at face value treats every line reached solely by the other 9 as unhit. For `tools/mutate.ts` that
// means narrowing a mutation sweep to tests which cannot notice the mutation — and the wrong verdict
// arrives as a **better score**, because a mutant nothing ran is recorded as surviving. Nothing
// downstream can see that; only the profile can say it. So `skipped` is written, and an empty list is
// a positive statement that the profile is complete. `issues/system/0161`.
//
// Skipped when there is no binary, exactly as `tools/seedFresh.test.ts` skips when there is no seed:
// a checkout without one is a perfectly good checkout.

import { ROOT } from "./programs.ts";

const BIN = `${ROOT}/native/v8/target/release/wac`;

type Profile = { entry: string; all: string[]; tests: Record<string, string[]>; skipped: string[] };

async function profileOf(source: string): Promise<Profile | null> {
  const dir = await Deno.makeTempDir({ prefix: "wac-nativeprof-" });
  try {
    const entry = `${dir}/subject_test.wac`;
    await Deno.writeTextFile(entry, source);
    const out = `${dir}/profile`;
    const r = await new Deno.Command(BIN, {
      args: ["test", "--coverage", entry],
      env: { WAC_PROFILE: out },
      stdout: "piped",
      stderr: "piped",
    }).output();
    let found: Profile | null = null;
    try {
      for await (const e of Deno.readDir(out)) {
        if (e.name.endsWith(".json")) {
          found = JSON.parse(await Deno.readTextFile(`${out}/${e.name}`)) as Profile;
        }
      }
    } catch {
      throw new Error(
        `no profile directory after \`wac test --coverage\` (exit ${r.code})\n` +
          new TextDecoder().decode(r.stderr).slice(0, 400),
      );
    }
    return found;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

async function haveBinary(): Promise<boolean> {
  try {
    return (await Deno.stat(BIN)).isFile;
  } catch {
    return false;
  }
}

Deno.test("a partly-run file's profile names the tests it could not run", async () => {
  if (!await haveBinary()) return; // No binary, no claim to check.

  const p = await profileOf(`
export string test_runs_here() { return ""; }
export string test_wants_an_oracle(fn[i32(i32)] ref) { return ref(1) == 1 ? "" : "no"; }
`);
  if (p === null) throw new Error("no profile was written for a file with a runnable test");

  if (!Array.isArray(p.skipped)) {
    throw new Error(
      `the profile has no \`skipped\` list, so nothing can tell this partial profile from a ` +
        `complete one. Keys present: ${Object.keys(p).join(", ")}`,
    );
  }
  const ran = Object.keys(p.tests).sort();
  if (ran.join() !== "test_runs_here") throw new Error(`ran ${JSON.stringify(ran)}`);
  if (p.skipped.join() !== "test_wants_an_oracle") {
    throw new Error(`skipped ${JSON.stringify(p.skipped)}, expected the oracle-taking test alone`);
  }
});

Deno.test("a file whose tests all want an oracle still writes a profile, and says so", async () => {
  if (!await haveBinary()) return;

  // The case that used to write nothing at all. A reader seeing no file has to guess whether this
  // was asked and answered nothing or never asked, and guessing the second way is the
  // under-selection the profile exists to prevent.
  const p = await profileOf(`
export string test_one(fn[i32(i32)] ref) { return ref(1) == 1 ? "" : "no"; }
export string test_two(fn[i32(i32)] ref) { return ref(2) == 2 ? "" : "no"; }
`);
  if (p === null) throw new Error("a file whose tests all want an oracle wrote no profile at all");
  if (Object.keys(p.tests).length !== 0) throw new Error(`tests: ${JSON.stringify(p.tests)}`);
  if (p.skipped.slice().sort().join() !== "test_one,test_two") {
    throw new Error(`skipped ${JSON.stringify(p.skipped)}, expected both tests`);
  }
});

Deno.test("a file that runs whole says so with an empty skipped list", async () => {
  if (!await haveBinary()) return;

  // The positive half: `skipped: []` is what lets a reader use this profile as the truth about the
  // file. Without it, "complete" would have to be inferred from the absence of a key, which is the
  // same guess in a different place.
  const p = await profileOf(`
export string test_a() { return ""; }
export string test_b() { return ""; }
`);
  if (p === null) throw new Error("no profile for a file that runs whole");
  if (p.skipped.length !== 0) throw new Error(`skipped ${JSON.stringify(p.skipped)}, expected none`);
  if (Object.keys(p.tests).sort().join() !== "test_a,test_b") {
    throw new Error(`tests ${JSON.stringify(Object.keys(p.tests))}`);
  }
});
