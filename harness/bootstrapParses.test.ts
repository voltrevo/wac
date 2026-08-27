// The reference can still read every file wacc's graph reaches, which is what a fresh clone needs.
//
//   deno test -A harness/bootstrapParses.test.ts
//
// `bash tools/seed.sh --bootstrap` builds `packages/wacc/src/api.wac` **with the reference**, and it
// is the only command that works in a checkout with no binary: the seed is gitignored, so there is
// nothing to run `wac task` with. Every file wacc's graph reaches therefore has to be inside the
// subset the reference can read — and the reference is frozen by `design/lang/0003`, so the subset
// only ever shrinks relative to the language.
//
// ## Why a parse rather than the bootstrap itself
//
// The bootstrap is minutes and nothing in the suite runs it. This is **320 ms**, and it catches the
// failure that actually happens: the reference has no lambdas, and on 2026-08-27 wiring the wapy
// frontend into `api.wac` pulled `core/vec.wac` into the graph, whose `fold` takes an
// `fn[U(U, T)]`. Nine parse errors in a file nobody touched, from a compiler nobody was thinking
// about, and the import that reached it named nowhere in the message.
//
// **It was caught by luck.** The only test that asks the reference anything about wacc caches the
// answer under a key that includes `packages/wacc/src`, so it went red as a side effect of the same
// edit invalidating that cache — three lanes into a gate run, in an error about generated bindgen
// glue. Nothing was checking the thing itself.
//
// `tools/wac/waccdeps_test.wac` is the other half and the cheaper one: it lists what wacc imports
// from outside itself, so an addition is a deliberate act. This one is the question that list is a
// proxy for, asked directly.
//
// ## What it does not check
//
// That the reference can *emit* what it parses, or that the emitted compiler works. Both are the
// bootstrap's job and both are minutes. Parsing is where the reference's gaps bite, because they are
// gaps in the grammar rather than in the semantics.
//
// The day the reference stops being the bootstrap — `design/lang/0003` — this test goes with it.

import { wacFilesWithRoots } from "./wacFiles.ts";
import { frontendFor } from "../compiler/wacFrontend.ts";

const ROOT = new URL("../", import.meta.url).pathname;

/**
 * Every file the reference would read, parsed, with what it said about each.
 *
 * **The `core/…` files are the point.** `wacFilesWithRoots` treats `core/` as a builtin and hands
 * back only what it read from the graph; `wacCompile` — which is what the bootstrap actually calls —
 * resolves the same specifier to `core/vec.wac` on disk and parses it. So the walk and the bootstrap
 * disagree about what the graph *is*, and the file that broke the bootstrap was on the other side of
 * that disagreement. The first version of this test passed on the regression it was written for
 * because of it.
 *
 * **Followed from the parsed import list, not from a regex over the text.** The obvious scan for
 * `from "core/…"` matches the sentence in `wvec.wac`'s header that explains why that import is not
 * there, so it reported the clean tree as broken. An enumeration is only as good as its parser, and
 * there is a parser right here.
 */
function parseAll(files: Map<string, string>, read: (path: string) => string | null) {
  const refused: string[] = [];
  const seen = new Set<string>();
  const queue = [...files.keys()];
  let parsed = 0;

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);

    const src = files.get(path) ?? read(path);
    if (src === null) {
      refused.push(`${path}: imported by wacc's graph and not a file`);
      continue;
    }
    const frontend = frontendFor(path);
    if (frontend === undefined) {
      refused.push(`${path}: the reference has no frontend for this extension`);
      continue;
    }
    const { program, errors } = frontend(src, path);
    parsed++;
    if (errors.length > 0) {
      const e = errors[0];
      const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : "";
      refused.push(`${path}:${e.line}:${e.col} ${e.message}${more}`);
      continue;
    }
    for (const item of program.items) {
      if (item.tag === "import" && item.path.startsWith("core/")) queue.push(item.path);
    }
  }
  return { refused, parsed };
}

Deno.test("bootstrap: the reference parses every file wacc's graph reaches", async () => {
  const { files } = await wacFilesWithRoots(`${ROOT}packages/wacc/src/api.wac`);
  const { refused, parsed } = parseAll(files, (path) => {
    try {
      return Deno.readTextFileSync(`${ROOT}${path}`);
    } catch {
      return null;
    }
  });

  // **The count first.** A walk that resolved nothing would refuse nothing, and read as the rule
  // holding. wacc is 24 files and has never been fewer than fifteen.
  if (parsed < 15) {
    throw new Error(`only ${parsed} files parsed — the import walk found too few to be the compiler`);
  }
  if (refused.length > 0) {
    throw new Error(
      `the reference cannot read ${refused.length} of ${parsed} file(s) in wacc's graph, so ` +
        `\`bash tools/seed.sh --bootstrap\` will fail in a fresh clone:\n  ${refused.join("\n  ")}\n` +
        `Either keep what you need inside \`packages/wacc/src\` — see \`tools/wac/waccdeps_test.wac\` ` +
        `— or check that the reference can read the whole of what you imported.`,
    );
  }
});
