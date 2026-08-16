// A line that is one thing written twice, end to end.
//
// `## The decision in step 4## The decision in step 4## The decision in step 4` sat in
// `issues/system/0161` and a doc comment sat duplicated in `packages/wacc/src/emit.wac`. Both are
// the residue of an edit that pasted over itself, and neither is visible while reading: the eye
// takes the second copy for the start of the next line.
//
// **This exists because I swept for it and reported the repository clean.** The sweep was
// `grep -rnE '^(#{1,4} .+)\1' … 2>/dev/null | head`, and the `grep` here is **ugrep**, which rejects
// a backreference in both ERE and BRE — *"invalid escape"*, only `-P` accepts one. So the command
// did not fail to match; it **errored**, `2>/dev/null` swallowed the message, and empty output read
// as no findings. Two duplications were sitting in the tree at the time.
//
// Both halves of that are on the list already: a flag from the wrong tool fails by narrowing, and a
// pipeline's silence is not a result. Which is why the second test below asserts the pattern *can*
// match, against a string that is a known duplication.
//
// The rule here is a *non-greedy* prefix repeated to the end of the line, with a floor on the
// prefix's length so that `====`, `----`, `////` and a row of box-drawing characters are not
// findings. Those are how this file's own section rules are written.

import { ROOT } from "../harness/programs.ts";

/** The shortest repeated unit worth reporting. Below this it is punctuation, not prose. */
const FLOOR = 12;

const DUPLICATED = new RegExp(`^(.{${FLOOR},}?)\\1+$`);

async function textFiles(): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set([".git", "node_modules", "target", ".cache", "site"]);
  const walk = async (dir: string): Promise<void> => {
    for await (const e of Deno.readDir(dir)) {
      if (skip.has(e.name)) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (/\.(md|ts|wac|rs)$/.test(e.name)) out.push(p);
    }
  };
  await walk(ROOT);
  return out;
}

Deno.test("no line is one thing written twice", async () => {
  const files = await textFiles();
  // A floor, so a walk that resolved nothing cannot pass as a clean result — which is the failure
  // this whole file is about.
  if (files.length < 500) throw new Error(`only ${files.length} file(s) walked — did it resolve?`);

  const found: string[] = [];
  for (const path of files) {
    const text = await Deno.readTextFile(path).catch(() => "");
    text.split("\n").forEach((line, i) => {
      const m = DUPLICATED.exec(line);
      if (m) found.push(`${path.slice(ROOT.length + 1)}:${i + 1}  ${m[1].slice(0, 60)}`);
    });
  }

  if (found.length > 0) {
    throw new Error(
      `${found.length} line(s) that are one thing repeated end to end:\n  ${found.join("\n  ")}\n` +
        `Each is an edit that pasted over itself. Keep one copy.`,
    );
  }
});

Deno.test("and the check can actually match, which the sweep it replaces could not", () => {
  // The canary, and it is the point of this file rather than a formality. The predecessor reported
  // the repository clean while two duplications sat in it — not by matching nothing, but by being a
  // backreference handed to a grep that refuses them, with stderr discarded.
  const cases = [
    "## The decision in step 4## The decision in step 4",
    "/** one constructor, and a getter *//** one constructor, and a getter */",
  ];
  for (const c of cases) {
    if (!DUPLICATED.test(c)) throw new Error(`the pattern does not match a real duplication: ${c}`);
  }
  // And it must not fire on the things that are legitimately repetitive.
  for (const ok of ["// ─────────────────────────", "====================", "----------", "////////"]) {
    if (DUPLICATED.test(ok)) throw new Error(`a rule line was reported as duplication: ${ok}`);
  }
});
