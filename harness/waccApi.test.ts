// `WaccApi` names both halves of every entry point that has two — `issues/system/0231a`.
//
//     deno test -A --unstable-net --no-check harness/waccApi.test.ts
//
// `packages/wacc/src/api.wac` exports most of its entry points twice: `emitFiles(paths, sources, entry)`
// resolves `@/` against nothing, and `emitFilesIn(paths, sources, res, entry)` takes a resolution
// context. A caller that can only see one of a pair cannot know it had a choice — and that is not
// hypothetical. `issues/system/0229a` threaded the roots through the Deno host and found the `In`
// entry points were *already* exported and already in the generated glue; nobody had called them because
// neither of the two `WaccApi` declarations then in the harness mentioned them. The fix had to be found
// twice, on two days.
//
// **This asks the narrow question rather than the broad one, on purpose.** The broad question — does
// `WaccApi` name everything `api.wac` exports — is 49 against 25, and most of the difference is
// single-file entry points (`dump`, `emit`, `names`, `blocked`) that a graph-shaped caller has no use
// for. Answering it means 24 exemption lines, each a judgement about whether a build should want that
// call. `0231a` records that as the remaining risk and prices it. This one needs no exemptions and
// catches the failure that actually happened: **a pair, split.**
//
// The extractor bounds the invariant, which is worth saying out loud: this reads the *text* of a type
// declaration and of `export` lines, so a member written across lines in a shape the regex does not
// expect is a member this cannot see. `tools/benchCompile.test.ts` is the same shape and the same
// caveat, and the alternative — generating the declaration from the wire, `0231a`'s option 2 — is the
// thing that would make the caveat go away.

import { ROOT } from "./programs.ts";

/** `throw` on a false claim — the convention `tools/benchCompile.test.ts` uses, and no import for it. */
function must(ok: boolean, why: string): void {
  if (!ok) throw new Error(why);
}

/** The top-level member names of a `type X = { … }` declaration, by text. */
function members(source: string, decl: string): string[] {
  const at = source.indexOf(decl);
  must(at >= 0, `${decl} is not in the source any more`);
  const open = source.indexOf("{", at);
  let depth = 0, end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const out: string[] = [];
  // **Parens count as nesting too.** A member whose signature spans lines puts `paths:` and `entry:` at
  // brace depth zero, and counting only braces read those parameter names as members of the type.
  let d = 0;
  for (const line of source.slice(open + 1, end).split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
    if (d === 0 && m) out.push(m[1]);
    for (const ch of line) {
      if (ch === "{" || ch === "(") d++;
      else if (ch === "}" || ch === ")") d--;
    }
  }
  return out;
}

Deno.test("WaccApi names both halves of every entry point api.wac exports twice", async () => {
  const build = await Deno.readTextFile(`${ROOT}/harness/waccBuild.ts`);
  const api = await Deno.readTextFile(`${ROOT}/packages/wacc/src/api.wac`);

  const declared = new Set(members(build, "export type WaccApi"));
  must(declared.size > 10, `only ${declared.size} members found — the extractor has stopped working`);

  const exported = new Set(
    [...api.matchAll(/^export\s+[A-Za-z_][A-Za-z0-9_[\]<>,? ]*\s+([A-Za-z_][A-Za-z0-9_]*)\(/gm)]
      .map((m) => m[1]),
  );
  must(exported.size > 20, `only ${exported.size} exports found — the extractor has stopped working`);

  // A pair is an entry point `api.wac` exports both ways. Only those are asked about.
  const split: string[] = [];
  for (const name of exported) {
    if (name.endsWith("In")) continue;
    if (!exported.has(`${name}In`)) continue;
    const hasPlain = declared.has(name);
    const hasIn = declared.has(`${name}In`);
    if (hasPlain !== hasIn) {
      split.push(`${name}: ${hasPlain ? "declared" : "missing"}, ${name}In: ${hasIn ? "declared" : "missing"}`);
    }
  }
  must(
    split.length === 0,
    `harness/waccBuild.ts's WaccApi names one half of ${split.length} entry point(s) that ` +
      `packages/wacc/src/api.wac exports both ways. A caller reading the type cannot see the other:\n` +
      split.map((s) => `    ${s}`).join("\n") +
      `\n  Declare both, or take both out. issues/system/0231a is why.`,
  );

  // The other direction, weakly: a member `api.wac` does not export is dead, and reads as available.
  const dead = [...declared].filter((n) => n !== "Res" && !exported.has(n)).sort();
  must(
    dead.length === 0,
    `harness/waccBuild.ts's WaccApi declares ${dead.join(", ")}, which packages/wacc/src/api.wac ` +
      `does not export — a caller that reaches for one gets a runtime undefined, not a type error.`,
  );
});
