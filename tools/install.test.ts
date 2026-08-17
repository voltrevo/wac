// Installing, twice, and taking it away again — `design/lang/0009` D1.
//
// **Nothing here builds a binary.** `install()` shells out to `tools/seed.sh` and a release
// `cargo build`, which is a minute of work and already checked by `tools/seedFresh.test.ts` and by
// `seed.sh` itself. What is worth testing is everything around it, and all of it is file
// arrangement: where things land, whether running it twice is safe, and what uninstall leaves.
//
// So the profile handling is exercised directly through its two exported functions, and the layout
// through a fake install written into a temp directory. That keeps this test at milliseconds,
// which is what makes it something people run.

import { ensureProfileLine, removeProfileLine, uninstall } from "./install.ts";

/** An `env` that answers from a map, so nothing here reads or writes the real HOME. */
function fakeEnv(values: Record<string, string>): Deno.Env {
  return {
    get: (k: string) => values[k],
    set: () => {},
    delete: () => {},
    has: (k: string) => k in values,
    toObject: () => ({ ...values }),
  } as unknown as Deno.Env;
}

async function fakeInstall(home: string): Promise<void> {
  await Deno.mkdir(`${home}/bin`, { recursive: true });
  await Deno.mkdir(`${home}/cache/git`, { recursive: true });
  await Deno.writeTextFile(`${home}/bin/wac`, "#!/bin/sh\n");
  await Deno.writeTextFile(`${home}/env`, "# env\n");
  await Deno.writeTextFile(`${home}/install.json5`, "{}\n");
}

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

Deno.test("uninstall removes what was installed and leaves what was not", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-install-" });
  const home = `${dir}/.wac`;
  await fakeInstall(home);
  // The things D1 says uninstall must never touch, put where it is working.
  await Deno.writeTextFile(`${home}/wac.json5`, "{}\n");
  await Deno.writeTextFile(`${home}/notes.txt`, "mine\n");

  const said = await uninstall(fakeEnv({ WAC_HOME: home, HOME: dir }));

  const gone = async (p: string) => {
    try { await Deno.stat(p); return false; } catch { return true; }
  };
  const wrong: string[] = [];
  for (const p of ["bin/wac", "env", "install.json5", "cache"]) {
    if (!await gone(`${home}/${p}`)) wrong.push(`${p} survived`);
  }
  for (const p of ["wac.json5", "notes.txt"]) {
    if (await gone(`${home}/${p}`)) wrong.push(`${p} was removed and is not ours`);
  }
  if (!said.includes("other entr")) wrong.push(`it did not say what it left behind: ${said}`);
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
  await Deno.remove(dir, { recursive: true });
});

Deno.test("--keep-cache keeps the cache and nothing else", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-install-" });
  const home = `${dir}/.wac`;
  await fakeInstall(home);
  await Deno.writeTextFile(`${home}/cache/git/keepme`, "a fetched pack\n");

  await uninstall(fakeEnv({ WAC_HOME: home, HOME: dir }), true);
  await Deno.stat(`${home}/cache/git/keepme`);          // throws if it went
  try {
    await Deno.stat(`${home}/bin/wac`);
    throw new Error("the binary survived --keep-cache");
  } catch (e) {
    if (e instanceof Error && e.message.includes("survived")) throw e;
  }
  await Deno.remove(dir, { recursive: true });
});

Deno.test("uninstall takes the profile line, not just the files", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-install-" });
  const home = `${dir}/.wac`;
  await fakeInstall(home);
  const profile = `${dir}/.bashrc`;
  await Deno.writeTextFile(profile, "export EDITOR=vi\n");
  await ensureProfileLine(profile, home);

  // The gap this closes: `removeProfileLine` was tested on its own and `uninstall` never called
  // it, so every profile was left sourcing an `env` that had been deleted — an error on every
  // login, from a command the person had just removed. A test of the part is not a test of the
  // whole, and only running it showed the difference.
  const said = await uninstall(fakeEnv({ WAC_HOME: home, HOME: dir }));
  const text = await Deno.readTextFile(profile);
  if (text.includes("# wac")) throw new Error(`uninstall left the profile line:\n${text}`);
  if (!text.includes("export EDITOR=vi")) throw new Error(`it took what was not ours:\n${text}`);
  if (!said.includes("profile line")) throw new Error(`it did not say it had: ${said}`);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("an empty $WAC_HOME is removed, and the profile line with it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-install-" });
  const home = `${dir}/.wac`;
  await fakeInstall(home);
  const profile = `${dir}/.bashrc`;
  await Deno.writeTextFile(profile, "export EDITOR=vi\n");
  await ensureProfileLine(profile, home);

  await uninstall(fakeEnv({ WAC_HOME: home, HOME: dir }));
  let left = true;
  try { await Deno.stat(home); } catch { left = false; }
  if (left) throw new Error(`${home} was left behind with nothing in it`);

  // The line is already gone — `uninstall` takes it — so asking again removes nothing. That is
  // the property worth asserting here now that the test above covers the removal itself:
  // uninstalling twice must not be an error, because people do it.
  const again = await removeProfileLine(profile);
  if (again !== 0) throw new Error(`a second removal took ${again} line(s)`);
  const text = await Deno.readTextFile(profile);
  if (text.includes("# wac")) throw new Error(`the marker survived:\n${text}`);
  if (!text.includes("export EDITOR=vi")) throw new Error(`it took what was not ours:\n${text}`);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("uninstalling something that was never installed says so rather than failing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-install-" });
  const said = await uninstall(fakeEnv({ WAC_HOME: `${dir}/.wac`, HOME: dir }));
  if (said !== "nothing to remove") throw new Error(`it said ${JSON.stringify(said)}`);
  await Deno.remove(dir, { recursive: true });
});
