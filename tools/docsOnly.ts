// Whether a range of commits changes documentation and nothing a test could execute.
//
//     deno run --allow-read --allow-run tools/docsOnly.ts [base]      # default origin/master
//
// Exit 0 means documentation only, exit 1 means not, and either way it says why in one line. It is
// meant to be asked by `tools/push.sh` before it spends four minutes on the coverage ratchets.
//
// ## What "documentation only" has to mean here, which is narrower than "only markdown changed"
//
// **A `.md` file can hold a program.** `spec/spec/*.md` is prose with code in it, and three separate
// consumers execute those fences: `packages/wacc/test/wac/specfences_test.wac` compiles every one that checks
// clean, `tools/docSignatures.test.ts` matches their `export` lines against real declarations, and
// `compiler/wacSpec.test.ts` runs them against the reference. Editing a fence is editing a program,
// so the file's extension is not the question — its ```wac blocks are.
//
// So the predicate is: every changed path ends in `.md`, **and** no ```wac fence differs from the
// base *in a file whose fences something executes*. A fence appearing, vanishing, or changing by one
// byte is enough to say no.
//
// **Which files those are is derived from the consumers, not guessed:** `spec/**` (walked whole by
// `compiler/wacSpec.test.ts`, and `spec/spec` by `specfences_test.wac`) and `packages/*/README.md`
// (`docSignatures.test.ts`). A ```wac fence in an issue or a design note is quoted, not compiled —
// this very file's predicate first called my own prose commit non-documentary because it quoted a
// four-line reproduction into `issues/lang/open/0235a`, which nothing runs.
//
// `tools/docsOnly.test.ts` pins that list by finding every consumer of the fence pattern, so a fourth
// one cannot appear without failing and pointing here.
//
// Non-wac fences are ignored on purpose. Issues and design notes are full of ```text and bare fences
// holding measurements and terminal output; treating those as code would make almost every prose edit
// non-documentary and the predicate worthless. Nothing compiles them.
//
// ## What a caller may do with a yes, and what it may not
//
// **It may not skip the suite.** A pure prose edit routinely breaks it, by design: `compiler/wacSpec.test.ts`
// asserts `N issues, M closed.` against the files in `issues/*/`, and the website's `Checked.tsx`
// carries a count of tagged claims that `spec/` has to agree with. Both are markdown reading markdown,
// both live in the suite rather than in `deno task docs`, and both go red on an edit this predicate
// calls documentation. That is correct of them and a hard limit on this.
//
// What it may skip is work that reads *code* — the coverage ratchets measure branch coverage of each
// package's own sources, and a markdown edit with no fence in it cannot move them.

const dec = new TextDecoder();

async function git(...args: string[]): Promise<{ ok: boolean; out: string }> {
  const r = await new Deno.Command("git", { args, stdout: "piped", stderr: "null" }).output();
  return { ok: r.code === 0, out: dec.decode(r.stdout) };
}

/** Every ```wac fence in `text`, joined — the thing a change to a program shows up in. */
export function wacFences(text: string): string {
  const out: string[] = [];
  for (const m of text.matchAll(/^```wac\n([\s\S]*?)^```/gm)) out.push(m[1]);
  // **Joined on a fence terminator, which cannot occur inside a fence.** The separator only has
  // to be a string no fence body can contain, so two fences regrouped as one compare unequal —
  // a line of three backticks ends a fence by definition, so nothing between two of them holds
  // one. It was a space between newlines until 2026-08-27, and the byte written was a NUL: the
  // file read as binary to git and to every diff tool, which is how it was noticed.
  return out.join("\n```\n");
}

/** Whether anything executes the ```wac fences in this file — see the header. */
export function fencesAreRun(path: string): boolean {
  return path.startsWith("spec/") || /^packages\/[^/]+\/README\.md$/.test(path);
}

/** A file's content at a revision, or "" when it did not exist there. */
async function at(rev: string, path: string): Promise<string> {
  const r = await git("show", `${rev}:${path}`);
  return r.ok ? r.out : "";
}

export type Verdict = { docsOnly: boolean; why: string };

export async function verdict(base: string): Promise<Verdict> {
  const names = await git("diff", "--name-only", `${base}..HEAD`);
  if (!names.ok) return { docsOnly: false, why: `cannot diff against ${base}` };
  const changed = names.out.split("\n").map((s) => s.trim()).filter(Boolean);
  // **Nothing changed is not documentation.** It is a caller asking the wrong question, and answering
  // "yes, skip the expensive part" to it would be the one wrong answer with no upside.
  if (changed.length === 0) return { docsOnly: false, why: `nothing changed against ${base}` };

  const notMd = changed.filter((p) => !p.endsWith(".md"));
  if (notMd.length > 0) {
    const shown = notMd.slice(0, 3).join(", ");
    const more = notMd.length > 3 ? ` and ${notMd.length - 3} more` : "";
    return { docsOnly: false, why: `${notMd.length} non-markdown file(s) changed: ${shown}${more}` };
  }

  for (const p of changed) {
    if (!fencesAreRun(p)) continue;
    const before = wacFences(await at(base, p));
    const after = wacFences(await at("HEAD", p));
    if (before !== after) return { docsOnly: false, why: `a \`\`\`wac fence changed in ${p}` };
  }
  return { docsOnly: true, why: `${changed.length} markdown file(s), no \`\`\`wac fence changed` };
}

if (import.meta.main) {
  const base = Deno.args[0] ?? "origin/master";
  const v = await verdict(base);
  console.log(v.why);
  Deno.exit(v.docsOnly ? 0 : 1);
}
