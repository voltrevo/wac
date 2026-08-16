// A probe file is reached by something.
//
// A `*probe*.wac` under `test/wac/` exists to be called from the host — that is its whole purpose,
// and it is why `tools/deadexports.ts` exempts these files by name: every export is meant to be
// unused *from wac*, so the dead-export check would report all of them.
//
// **That exemption is also a blind spot.** A probe whose caller is deleted keeps compiling, keeps
// being swept by `corpusEmit`, and is reported by nothing. Three sat that way for two weeks — two in
// `packages/tor` that outlived the TypeScript driving them (`d8ea860e`, *"tor: delete the TypeScript
// — the client is wac, and it works"*) and one in `packages/crypto` that outlived its test. They were
// found by hand while converting a *different* package, which is not a way to find the next one.
//
// **No probe is named here on purpose.** This file is part of the corpus it searches, so writing a
// probe's filename into it would make that file count as the thing reaching it — the guard would
// answer its own question. The deleted three are described rather than named for the same reason.
//
// So: every probe must be named by at least one other file. The check is deliberately a text search
// for the basename rather than an import graph, because the ways a probe gets reached are various —
// `wacBind("…/probe.wac")`, an `instrument(…)` call in a `cov.ts`, a bench, a design note that
// points at it — and every one of them writes the name.
//
// This is the sibling of the rule that keeps catching citations during conversions: `deno task docs`
// checks backticked paths, and a path passed as an argument is invisible to it. Same gap, other
// direction.

import { ROOT } from "../harness/programs.ts";

async function probeFiles(): Promise<string[]> {
  const out: string[] = [];
  for await (const pkg of Deno.readDir(`${ROOT}/packages`)) {
    if (!pkg.isDirectory) continue;
    const dir = `${ROOT}/packages/${pkg.name}/test/wac`;
    try {
      for await (const e of Deno.readDir(dir)) {
        if (e.isFile && e.name.includes("probe") && e.name.endsWith(".wac")) {
          out.push(`packages/${pkg.name}/test/wac/${e.name}`);
        }
      }
    } catch {
      // A package with no wac tests is not a finding.
    }
  }
  return out.sort();
}

/** Every text file that could name a probe, read once. */
async function corpus(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const skip = new Set([".git", "node_modules", "target", ".cache", "site"]);
  const walk = async (dir: string): Promise<void> => {
    for await (const e of Deno.readDir(dir)) {
      if (skip.has(e.name)) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) {
        await walk(p);
      } else if (/\.(ts|wac|md|json)$/.test(e.name)) {
        out.set(p.slice(ROOT.length + 1), await Deno.readTextFile(p).catch(() => ""));
      }
    }
  };
  await walk(ROOT);
  return out;
}

Deno.test("every probe file is named by something that could reach it", async () => {
  const probes = await probeFiles();
  // A floor, so a walk that silently resolved nothing cannot pass. There were 41 when this was
  // written; the number only matters as evidence the search ran.
  if (probes.length < 20) {
    throw new Error(`only ${probes.length} probe file(s) found — did the walk resolve?`);
  }

  const files = await corpus();
  const orphans: string[] = [];
  for (const probe of probes) {
    const name = probe.slice(probe.lastIndexOf("/") + 1);
    let reached = false;
    for (const [path, text] of files) {
      if (path === probe) continue; // a file naming itself proves nothing
      if (text.includes(name)) {
        reached = true;
        break;
      }
    }
    if (!reached) orphans.push(probe);
  }

  if (orphans.length > 0) {
    throw new Error(
      `${orphans.length} probe file(s) nothing names:\n  ${orphans.join("\n  ")}\n` +
        `A probe exists to be reached from the host. One that nothing reaches is a file that still ` +
        `compiles and tests nothing — delete it, or say what reaches it. \`deadexports\` cannot ` +
        `report these: it exempts probe files by name, which is right for a live one.`,
    );
  }
});
