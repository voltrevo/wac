// The native host binary, for the tests that compare two hosts — built when it is stale, and *asked*
// about cheaply.
//
// **`cargo build --release --quiet` costs 2.6 seconds in `native/` even when there is nothing to do.**
// Measured 2026-08-18, twice in a row on an up-to-date crate. Nine test files shelled out to it, several
// of them once per *test* — `native_hostfs.test.ts` seven times, `native_shell.test.ts` and
// `arrival.test.ts` three each — so a suite run spent tens of seconds asking a question whose answer had
// not changed. In `packages/platform/test/arrival.test.ts` it was 2.5s of every one of the three tests,
// against 340ms for all ten of the sessions those tests exist to run.
//
// Two things fix that, and the second is what makes the first safe to want:
//
//   - **Memoised per crate.** One answer per process, so a file with seven callers pays once.
//   - **Answered by `stat` where it can be.** A walk of the crate's own files — 6ms, `target/` skipped —
//     against the binary's mtime says whether cargo could possibly have work to do. Newer than
//     everything means no build, and the difference is 6ms against 2600.
//
// The freshness rule is the one `tools/seedFresh.test.ts` uses for the seed: mtimes, not content. It
// covers a source edit, a `Cargo.toml` change and a `Cargo.lock` update, which is what changes here; it
// does not cover a toolchain that moved underneath an unchanged tree, and neither does anything else in
// this repository. `WAC_ALWAYS_CARGO=1` forces the build for a caller that has reason to doubt it.

/** What a caller gets: the path to the binary, or `null` with the reason already printed. */
export type NativeHost = string | null;

const answers = new Map<string, Promise<NativeHost>>();

async function newestSource(dir: string): Promise<number> {
  let newest = 0;
  for await (const e of Deno.readDir(dir)) {
    // `target/` is cargo's own output and holds the binary this is being compared against.
    if (e.name === "target") continue;
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) {
      newest = Math.max(newest, await newestSource(path));
      continue;
    }
    const s = await Deno.stat(path).catch(() => null);
    if (s !== null) newest = Math.max(newest, s.mtime?.getTime() ?? 0);
  }
  return newest;
}

async function build(crate: string, binary: string): Promise<NativeHost> {
  const path = `${Deno.cwd()}/${crate}/target/release/${binary}`;
  if (Deno.env.get("WAC_ALWAYS_CARGO") !== "1") {
    const [have, newest] = await Promise.all([
      Deno.stat(path).catch(() => null),
      newestSource(crate).catch(() => Number.MAX_SAFE_INTEGER),
    ]);
    if (have !== null && (have.mtime?.getTime() ?? 0) >= newest) return path;
  }
  try {
    const built = await new Deno.Command("cargo", {
      args: ["build", "--release", "--quiet"],
      cwd: crate,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (built.code !== 0) throw new Error(new TextDecoder().decode(built.stderr));
  } catch (e) {
    // **Said out loud, because a silent skip reads as coverage.** The half that does not need the
    // native host still runs and still asserts; what is lost is the comparison, and that is the thing
    // worth knowing about.
    console.warn(
      `SKIPPING the native half: cargo did not build ${crate}.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}\n` +
        `  The other host's half still runs. See issues/closed/0087.`,
    );
    return null;
  }
  return path;
}

/**
 * The native host binary for `crate`, built if its sources are newer than it.
 *
 * Answers `null` — after saying why on standard error — when cargo is absent or the crate will not
 * build, which is the ordinary state of a machine without the Rust toolchain.
 */
export function nativeBinary(crate = "native", binary = "wacland"): Promise<NativeHost> {
  const key = `${crate}/${binary}`;
  let pending = answers.get(key);
  if (pending === undefined) {
    pending = build(crate, binary);
    answers.set(key, pending);
  }
  return pending;
}
