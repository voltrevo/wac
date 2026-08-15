// What the build cache must never get wrong.
//
// A cache that serves a stale artifact is worse than no cache: the suite goes green for code that is
// not there, and the person who would notice is the one whose fix "did nothing". So these are all
// tests of the *key* rather than of the speed — the speed is obvious when it works and harmless when
// it does not, and the key is the part that can lie.
//
// None of these builds anything. The key is a pure function of its inputs, which is what makes it
// testable at all, and is also why `appKeyParts` is exported: the interesting assertion is "the host
// is in there", and it can be made by looking rather than by editing a host file and rebuilding.

import {
  cached,
  compilerKeyParts,
  contentKey,
  filesParts,
  harnessKeyParts,
  sweepStage,
} from "./buildCache.ts";
import { appKeyParts } from "../packages/platform/build.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const FILES = new Map([["a.wac", "one"], ["b.wac", "two"]]);

Deno.test("a key is stable, and changes when any input does", async () => {
  const key = await contentKey(["x", "y"]);
  assertEquals(await contentKey(["x", "y"]), key, "the same parts give the same key");
  // Framing matters, and a separator is not framing. Without a length in front of each part,
  // ["ab","c"] and ["a","bc"] are the same bytes; with a space as the separator, ["a b","c"] and
  // ["a","b","c"] are - and these parts are whole source files, which certainly contain spaces.
  // Two different programs sharing one cache entry is the worst thing this file could do.
  assertEquals(await contentKey(["ab", "c"]) === await contentKey(["a", "bc"]), false,
    "parts are framed, not concatenated");
  assertEquals(await contentKey(["a b", "c"]) === await contentKey(["a", "b", "c"]), false,
    "and framed by length, not by a character a source could contain");
});

Deno.test("a file map is flattened in a fixed order", async () => {
  const forward = filesParts(new Map([["a", "1"], ["b", "2"]]));
  const reverse = filesParts(new Map([["b", "2"], ["a", "1"]]));
  assertEquals(forward.join(","), reverse.join(","), "insertion order does not matter");
  assertEquals(forward.join(","), "a,1,b,2", "path then content, sorted by path");
  // Content, never a timestamp: a `git checkout` of an older file is a new input with an older
  // mtime, and a cache that trusted the clock would hand back the newer build.
  const changed = filesParts(new Map([["a", "1x"], ["b", "2"]]));
  assertEquals(changed.join(",") === forward.join(","), false, "a changed file changes the parts");
});

Deno.test("the compiler and the harness are part of every key", async () => {
  const compiler = await compilerKeyParts();
  const harness = await harnessKeyParts();
  // Null is legitimate — it means "do not cache" — but in this checkout the sibling compiler is
  // right there, and a null here would silently turn the cache off for everyone.
  assertEquals(compiler === null, false, "the wac compiler's sources were found");
  assertEquals(harness === null, false, "the harness's own sources were found");
  assertEquals(compiler!.includes(Deno.version.deno), true, "the Deno version is in the key");
  const joined = compiler!.join("\n");
  assertEquals(joined.includes("wacCompile"), true, "the compiler's own source is in the key");
  assertEquals(harness!.join("\n").includes("wacBind"), true, "this harness is in the key");
});

Deno.test("an application's key covers the host, the grants and the target", async () => {
  const parts = await appKeyParts("packages/platform/example/wc.wac", FILES, {}, "deno", false);
  assertEquals(parts === null, false, "the key could be computed");
  const joined = parts!.join("\n");

  // The bundle *is* the host: a fix to `deno.ts` changes every built program, so a cache that
  // missed it would hand back binaries with the old host and call the suite green.
  const host = await Deno.readTextFile("packages/platform/host/deno.ts");
  assertEquals(joined.includes(host), true, "host/deno.ts is in the key");
  const browser = await Deno.readTextFile("packages/platform/host/browser.ts");
  assertEquals(joined.includes(browser), true, "and so is every other host");
  const build = await Deno.readTextFile("packages/platform/build.ts");
  assertEquals(joined.includes(build), true, "and build.ts, which assembles them");
  assertEquals(joined.includes("one") && joined.includes("two"), true, "and the program's sources");

  // The four arguments that change the output. Grants are baked into the shebang and the launcher,
  // so two builds of one program with different grants are two different programs.
  const key = async (g: Record<string, boolean>, target: "deno" | "node" | "browser", w: boolean) =>
    await contentKey((await appKeyParts("e.wac", FILES, g, target, w))!);
  const base = await key({}, "deno", false);
  assertEquals(await key({}, "deno", false), base, "the same arguments give the same key");
  assertEquals(await key({ read: true }, "deno", false) === base, false, "grants matter");
  assertEquals(await key({}, "node", false) === base, false, "the target matters");
  assertEquals(await key({}, "deno", true) === base, false, "--worker matters");
  const other = await contentKey((await appKeyParts("f.wac", FILES, {}, "deno", false))!);
  assertEquals(other === base, false, "the entry matters");
});

Deno.test("a cached artifact is produced once and then reused", async () => {
  const key = `test-${crypto.randomUUID()}`;
  let made = 0;
  const produce = async (path: string) => {
    made++;
    await Deno.writeTextFile(path, "artifact");
  };
  const first = await cached("test", key, ".txt", produce);
  const second = await cached("test", key, ".txt", produce);
  assertEquals(first, second, "the same key is the same path");
  assertEquals(made, 1, "the second ask did not rebuild");
  assertEquals(await Deno.readTextFile(first), "artifact");
  await Deno.remove(first);
});

Deno.test("evicting a staged build takes its transpile entry with it", async () => {
  // **The rate, not the mop.** `stageDir` builds at a path derived from the content key so Deno's
  // transpile entry — keyed on the source's absolute path — is *reused* rather than orphaned. That
  // holds only while the directory exists, and `sweepStage` is what ends it. Without removing the
  // mirror here, the fix moves the leak from one entry per run to one per eviction, which is what
  // 2,615 mirrored staging directories against 120 live ones looked like on 2026-08-15.
  //
  // Driven against temp roots rather than the real `.cache`, so running this neither evicts a build
  // somebody is using nor depends on how many happen to be cached today.
  const root = await Deno.makeTempDir({ prefix: "wac-stage-" });
  const denoDir = await Deno.makeTempDir({ prefix: "wac-gen-" });
  try {
    // One more than `KEEP`, so exactly one is evicted and the assertion is about *which*.
    const made: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const dir = `${root}/key${String(i).padStart(3, "0")}`;
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(`${dir}/app.gen.ts`, "export const x = 1;\n");
      // Distinct mtimes, oldest first, because "oldest is least used" is the eviction rule.
      const at = new Date(Date.now() - (200 - i) * 60_000);
      await Deno.utime(dir, at, at);
      // The transpile Deno would have written for it.
      const mirror = `${denoDir}/gen/file${await Deno.realPath(dir)}`;
      await Deno.mkdir(mirror, { recursive: true });
      await Deno.writeTextFile(`${mirror}/app.gen.ts.js`, "export const x = 1;\n");
      made.push(mirror);
    }

    await sweepStage(root, denoDir);

    const exists = async (p: string) => await Deno.stat(p).then(() => true).catch(() => false);
    assertEquals(await exists(`${root}/key000`), false, "the oldest staged build should be evicted");
    assertEquals(
      await exists(made[0]),
      false,
      "its transpile entry survived the eviction — that is the leak, one per evicted key",
    );
    assertEquals(await exists(`${root}/key001`), true, "the next-oldest is within KEEP");
    assertEquals(await exists(made[1]), true, "and a live build's transpile entry must be kept");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
    await Deno.remove(denoDir, { recursive: true }).catch(() => {});
  }
});
