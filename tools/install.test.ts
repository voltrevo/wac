// Installing, twice — `design/lang/0009` D1.
//
// **Nothing here builds a binary.** `install()` shells out to `tools/seed.sh` and a release
// `cargo build`, which is a minute of work and already checked by `tools/seedFresh.test.ts` and by
// `seed.sh` itself. What is worth testing is everything around it, and all of it is file
// arrangement: where the profile line lands, and whether running it twice is safe.
//
// **Taking it away is not here and has not been since 2026-08-26.** There were two uninstallers,
// this file tested the TypeScript one, and it went — `wac uninstall` is a subcommand of the binary
// and is the only one somebody with a `$WAC_HOME` and no checkout can reach.
// `packages/wacc/test/wac/uninstall_test.wac` is where uninstalling is tested now, against the
// command rather than against a second implementation of it. See `tools/install.ts`'s header.
//
// So what is left is the profile handling, exercised directly through the one exported function it
// needs. That keeps this test at milliseconds, which is what makes it something people run.

import { ensureProfileLine } from "./install.ts";

Deno.test("the profile line is added once, however many times you install", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-install-" });
  const profile = `${dir}/.bashrc`;
  await Deno.writeTextFile(profile, "export EDITOR=vi\n");

  const first = await ensureProfileLine(profile, `${dir}/.wac`);
  const second = await ensureProfileLine(profile, `${dir}/.wac`);
  const third = await ensureProfileLine(profile, `${dir}/.wac`);
  if (first !== "added") throw new Error(`first install said ${first}`);
  if (second !== "present" || third !== "present") throw new Error(`${second}, then ${third}`);

  const text = await Deno.readTextFile(profile);
  const ours = text.split("\n").filter((l) => l.includes("# wac"));
  if (ours.length !== 1) throw new Error(`${ours.length} lines carry the marker:\n${text}`);
  if (!text.startsWith("export EDITOR=vi\n")) throw new Error(`it disturbed what was there:\n${text}`);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("a profile with no trailing newline does not get two lines joined", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-install-" });
  const profile = `${dir}/.zshrc`;
  // The shape that produces `export EDITOR=vi. "$HOME/.wac/env"` — a profile that errors on the
  // next login, from an installer that appended without looking.
  await Deno.writeTextFile(profile, "export EDITOR=vi");
  await ensureProfileLine(profile, `${dir}/.wac`);
  const lines = (await Deno.readTextFile(profile)).split("\n");
  if (lines[0] !== "export EDITOR=vi") throw new Error(`the first line became ${JSON.stringify(lines[0])}`);
  if (!lines[1].includes("# wac")) throw new Error(`the second line is ${JSON.stringify(lines[1])}`);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("installing to a different home moves the line rather than leaving it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-install-" });
  const profile = `${dir}/.bashrc`;
  await Deno.writeTextFile(profile, "export EDITOR=vi\n");

  await ensureProfileLine(profile, `${dir}/old`);
  const what = await ensureProfileLine(profile, `${dir}/new`);
  if (what !== "updated") throw new Error(`it said ${what}`);

  const text = await Deno.readTextFile(profile);
  const ours = text.split("\n").filter((l) => l.includes("# wac"));
  if (ours.length !== 1) throw new Error(`${ours.length} marked lines:\n${text}`);
  if (!ours[0].includes(`${dir}/new/env`)) throw new Error(`still points at the old home: ${ours[0]}`);
  // The failure this prevents: uninstalling the old home deletes the `env` the profile names, and
  // every new shell prints an error about a file nobody can find.
  if (ours[0].includes(`${dir}/old/env`)) throw new Error("the old path survived");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("a profile that does not exist is not created", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-install-" });
  // An installer that creates `.zshrc` on a machine with no zsh has decided something about that
  // machine that it does not know.
  const what = await ensureProfileLine(`${dir}/.zshrc`, `${dir}/.wac`);
  if (what !== "absent") throw new Error(`it said ${what}`);
  let made = true;
  try { await Deno.stat(`${dir}/.zshrc`); } catch { made = false; }
  if (made) throw new Error("it created a profile that was not there");
  await Deno.remove(dir, { recursive: true });
});
