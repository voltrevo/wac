// The coverage profile is cached, and the key is what makes that safe.
//
// Building the profile is the dominant cost of a mutation sweep: `--package gzip` profiles 380 test
// files in 26m45s before a baseline or a mutant runs. `buildProfile`'s own comment claimed a cache
// "against a hash of the sources" for a long time before anything implemented one, which is why
// nobody could iterate on selection — seeing what a change to `selectTests` did meant paying the 26
// minutes again.
//
// A profile is a pure function of the tree: which tests reach which lines. So unlike the *baseline*
// beside it — a timing measurement of one machine at one moment, which `issues/system/0139` is right
// to be careful about caching — it can be reused, provided the key is honest. **A stale profile
// under-selects**, and under-selection is the failure that reports as a better score, so the two
// things checked here are that the key moves when anything the run could read moves, and that the
// stored shape comes back as the shape that went in.
//
// `buildProfile` itself is not called: it guards with `refuseIfNested`, deliberately, so that the
// pure parts can be imported by a test and the subprocess loop cannot be started from inside one.

import { readCached, treeKey, writeCached } from "./profile.ts";
import type { Profile } from "./profile.ts";

async function tree(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "wac-key-" });
  for (const [name, body] of Object.entries(files)) {
    const path = `${dir}/${name}`;
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
  return dir;
}

Deno.test("the key is stable when nothing changes", async () => {
  const dir = await tree({ "src/a.wac": "export i32 f() { return 1; }", "t/a.test.ts": "// x" });
  try {
    const one = await treeKey(dir, ["t/a.test.ts"]);
    const two = await treeKey(dir, ["t/a.test.ts"]);
    if (one !== two) throw new Error(`two reads of an unchanged tree gave ${one} and ${two}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the key moves when a source byte moves", async () => {
  const dir = await tree({ "src/a.wac": "export i32 f() { return 1; }", "t/a.test.ts": "// x" });
  try {
    const before = await treeKey(dir, ["t/a.test.ts"]);
    // A changed *return value* is exactly the kind of edit a mutation sweep makes, and it can change
    // which branches a test reaches. A key that missed it would serve a profile describing the old
    // tree and narrow to tests chosen for code that is no longer there.
    await Deno.writeTextFile(`${dir}/src/a.wac`, "export i32 f() { return 2; }");
    const after = await treeKey(dir, ["t/a.test.ts"]);
    if (before === after) throw new Error("editing a .wac source did not change the key");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the key moves when a file appears, and when the test list changes", async () => {
  const dir = await tree({ "src/a.wac": "export i32 f() { return 1; }", "t/a.test.ts": "// x" });
  try {
    const base = await treeKey(dir, ["t/a.test.ts"]);

    // A new test file is a new source of coverage; the profile that did not run it is not a profile
    // of this tree.
    await Deno.writeTextFile(`${dir}/t/b.test.ts`, "// y");
    const added = await treeKey(dir, ["t/a.test.ts"]);
    if (added === base) throw new Error("adding a test file did not change the key");

    // And the *scope* is part of the key: the same tree profiled over a different set of test files
    // yields a different profile, and serving one for the other silently narrows coverage to
    // whatever the other scope happened to run.
    const wider = await treeKey(dir, ["t/a.test.ts", "t/b.test.ts"]);
    if (wider === added) throw new Error("widening the test file list did not change the key");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a stored profile comes back as the shape that went in", async () => {
  // `lines`, `home` and `cost` are `Map`s and `known` is a `Set`; none survives `JSON.stringify`, so
  // a round trip that returned plain objects would give a profile whose every lookup answers
  // undefined — which reads as "no test reaches this line", the under-selecting answer.
  const p: Profile = {
    lines: new Map([["a.wac:1", ["t one", "t two"]], ["a.wac:2", ["t one"]]]),
    known: new Set(["a.wac:1", "a.wac:2", "a.wac:3"]),
    home: new Map([["t one", "t/a.test.ts"], ["t two", "t/b.test.ts"]]),
    testFiles: ["t/a.test.ts", "t/b.test.ts"],
    cost: new Map([["t/a.test.ts", 12], ["t/b.test.ts", 34]]),
  };
  const key = `roundtrip-${crypto.randomUUID()}`;
  try {
    await writeCached(key, p);
    const back = await readCached(key);
    if (back === null) throw new Error("a profile written a moment ago did not read back");
    if (back.lines.get("a.wac:1")?.join() !== "t one,t two") throw new Error("lines lost");
    if (!back.known.has("a.wac:3")) throw new Error("known lost");
    if (back.home.get("t two") !== "t/b.test.ts") throw new Error("home lost");
    if (back.cost.get("t/b.test.ts") !== 34) throw new Error("cost lost");
    if (back.testFiles.join() !== "t/a.test.ts,t/b.test.ts") throw new Error("testFiles lost");
  } finally {
    await Deno.remove(`.cache/mutate-profile/${key}.json`).catch(() => {});
  }
});

Deno.test("test names are stored once, not once per line they reach", async () => {
  // The round trip above would pass just as well without interning, and without it a real profile is
  // **133 MB**: 2,276,536 name references drawn from 1,643 distinct names of about 51 characters.
  // One file per state of the tree fills a disk in a day. So this checks the size, not only the
  // contents — a correctness test alone cannot see the difference.
  const names = Array.from({ length: 40 }, (_, i) => `some package: a fairly long test name ${i}`);
  const lines = new Map<string, string[]>();
  for (let i = 0; i < 500; i++) lines.set(`src/f.wac:${i}`, names);
  const p: Profile = {
    lines,
    known: new Set([...lines.keys()]),
    home: new Map(names.map((n) => [n, "t/x.test.ts"])),
    testFiles: ["t/x.test.ts"],
    cost: new Map([["t/x.test.ts", 1]]),
  };
  const key = `intern-${crypto.randomUUID()}`;
  try {
    await writeCached(key, p);
    const size = (await Deno.stat(`.cache/mutate-profile/${key}.json`)).size;
    // Longhand this is 500 x 40 x ~44 bytes, over 800 KB. Interned it is indices plus one name
    // table. The bound is deliberately loose — it is checking an order of magnitude, not a format.
    const longhand = 500 * names.reduce((n, s) => n + s.length + 3, 0);
    if (size > longhand / 4) {
      throw new Error(
        `the stored profile is ${size} bytes against ${longhand} written longhand — the names are ` +
          `not being interned, and a real profile at this ratio is over a hundred megabytes per ` +
          `state of the tree.`,
      );
    }
    // And it still comes back whole: a smaller file that lost a name is the failure this trades
    // against, and it would show up as a line no test reaches.
    const back = await readCached(key);
    if (back === null) throw new Error("did not read back");
    if (back.lines.get("src/f.wac:499")?.join() !== names.join()) {
      throw new Error("a line's test list did not survive interning");
    }
    if (back.home.size !== names.length) throw new Error(`home has ${back.home.size} of ${names.length}`);
  } finally {
    await Deno.remove(`.cache/mutate-profile/${key}.json`).catch(() => {});
  }
});

Deno.test("a key nothing has stored is a miss, not an error", async () => {
  // A miss has to be survivable: the cache is an optimisation, and a run that failed because a
  // profile was absent would be worse than the 26 minutes it saves.
  if (await readCached(`absent-${crypto.randomUUID()}`) !== null) {
    throw new Error("reading an unknown key returned something");
  }
});
