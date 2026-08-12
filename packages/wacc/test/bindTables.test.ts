// Every type that crosses the boundary is written down, however many there are.
//
// The metadata wacc hands the generator is what the generator writes classes from, so a type that
// crosses and is *not* in it does not fail in the compiler — it fails much later, in the host, as a
// class that is asked for and is not there. `packages/box/example/boxsh.wac` filled this table at 64
// entries and lost every `Pending<T>` among the ones that did not fit; `Pending<T>` is what every
// capability returns, so the shell built, loaded, and then printed nothing at all, with
// `Cannot read properties of undefined (reading 'of')` as the only clue [issue 0106].
//
// The table is bigger now, which is not the point — the point is that it is checked. A program is
// generated rather than written because the interesting number is "more than the table holds", and
// nothing in this repository is meant to be near it.

import { waccApi } from "../../../harness/waccBuild.ts";

const COUNT = 90; // comfortably past the 64 that boxsh ran into

function program(): Record<string, string> {
  const decls: string[] = [];
  const fns: string[] = [];
  for (let i = 0; i < COUNT; i++) {
    decls.push(`export struct T${i} { i32 v; }`);
    // Returned by an exported function, which is what makes it cross.
    fns.push(`export T${i} make${i}() { return T${i}(${i}); }`);
  }
  return { "/t/main.wac": decls.join("\n") + "\n" + fns.join("\n") + "\n" };
}

Deno.test("every crossing type reaches the metadata, past the size of the table", async () => {
  const api = await waccApi();
  const files = program();
  const paths = Object.keys(files);
  const sources = paths.map((p) => files[p]);
  const wire = api.bindTypesFiles(paths, sources, "/t/main.wac");

  const named = new Set(
    wire.split("\n").filter((l) => l.startsWith("S\t")).map((l) => l.split("\t")[1]),
  );
  const missing: string[] = [];
  for (let i = 0; i < COUNT; i++) if (!named.has(`T${i}`)) missing.push(`T${i}`);
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} of ${COUNT} crossing types are absent from the metadata, ` +
        `starting at ${missing[0]} — the generator writes no class for them`,
    );
  }

  // And the emitter says so when it genuinely cannot fit them, rather than emitting a module whose
  // glue is quietly incomplete.
  const blocked = api.blockedFiles(paths, sources, "/t/main.wac");
  if (blocked !== "") throw new Error(`declined a program it has room for: ${blocked}`);
});
