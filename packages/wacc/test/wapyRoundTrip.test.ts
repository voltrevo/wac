// Every tracked `.wac` file, rendered to wapy and read back **by wacc**, compared as trees.
//
//   deno test -A --unstable-net packages/wacc/test/wapyRoundTrip.test.ts
//
// ## Why this one is not circular and the one it replaces was
//
// The test this replaces — compiler/wapyRoundTrip.test.ts, deleted 2026-08-27 — rendered with
// `compiler/wapyPrint.ts` and read back with compiler/wapyParse.ts, and that reader's own header
// said what is wrong with it:
// *"a round-trip test cannot notice, because it only ever feeds the reader output from the printer —
// which is valid by construction."* A printer that emitted a spelling no reader outside this pair
// accepts, and a reader that accepted it, agree with each other perfectly.
//
// `packages/wacc/src/wapyparse.wac` is a second implementation, written from `spec/spec/wapy.md`
// rather than from the printer, and it is the one that compiles. So rendering with one and reading
// with the other is a real comparison: it is how `issues/lang/0277a` was found — the printer emits
// `\uXXXX`, which is not a wac escape, and wacc refuses it.
//
// ## What is compared
//
// The **tree**, printed in wacc's canonical form by `dump` and `dumpWapy`, with `@line:col` stripped:
// the two layouts put the same declaration on different lines, which is the point of having two
// layouts. Everything else must match — a dropped `else`, a lost parameter or a conditional whose
// arms are the wrong way round all fail.
//
// ## The known-bad list, and why it is a list rather than a floor
//
// Six of 1,322 files do not survive the printer, for two causes, and each is named below with the
// issue it belongs to. The test fails if a named file *starts* working as loudly as if an unnamed
// one stops: a count with slack in it cannot tell "the printer was fixed" from "four more files
// broke".
//
// **Both entries were found by this test on its first run**, which is the argument for it. One of
// them, `issues/lang/0280a`, is a rule the reference does not implement — so the reference's own
// round trip reads the printer's output the same wrong way the printer wrote it, and agrees.

import { waccApi } from "../../../harness/waccBuild.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;

/**
 * The files whose rendering is a different program, with the issue each belongs to.
 *
 * **Measured, not remembered.** The first version of this list was written from what I thought the
 * failures were and named five files, none of which are these — it passed only because nothing in
 * it fired. A list of known failures that is not the list of actual failures is worse than no list:
 * it reads as knowledge.
 *
 * The five escape ones are `issues/lang/0277a`: the printer renders a string with
 * `JSON.stringify`, so a NUL comes out as `\u0000`, which wac has no spelling for. wacc's *build*
 * refuses it — `error: unknown escape` — but this test compares trees through `dump`, which parses
 * and prints without checking, so it surfaces as a string whose value is the text `u0000`.
 */
const KNOWN_BAD: Record<string, string> = {
  // **JSX text is re-emitted verbatim, and JSX has no escape.** A text run holding `<` or `/`
  // re-lexes as markup when the rendering is read back, so the tree gains an element the source
  // did not have. Not fixable by quoting — the surface has nowhere to put a quote.
  "spec/cases/0124-jsx-text-children.wac": "jsx text containing markup characters",
  "spec/cases/0130-jsx-text-is-not-wac-source.wac": "jsx text containing markup characters",
  "spec/cases/0135-a-jsx-fragment-is-a-node.wac": "jsx text containing markup characters",
  "packages/platform/src/frame.wac": "jsx text containing markup characters",
  "packages/platform/test/wac/scheduled_test.wac": "jsx text containing markup characters",
  "packages/wac/src/grants.wac": "jsx text containing markup characters",
  // A method chain carrying written type arguments *and* an inline lambda in the same expression.
  "spec/cases/0248-a-chain-of-method-type-arguments-with-inline-lambdas.wac":
    "a type-argument chain with an inline lambda",
};

// **The six entries this replaces were the TypeScript printer's bugs, and are fixed.**
// `issues/lang/0280a` was dropped parentheses — `packages/wacc/src/wapyprint.wac` brackets every
// compound subexpression, so the class cannot occur. `issues/lang/0277a` was a NUL rendered as
// `\u0000` by `JSON.stringify`; the wac printer emits a literal's raw source span, so a `\0`
// stays what it was written as. Both issues stay open for what else they name.

/**
 * `@line:col`, and the three operator words — what the two surfaces are entitled to disagree about.
 *
 * **Positions**, because the two layouts put the same declaration on different lines, which is the
 * point of having two layouts.
 *
 * **`and`, `or`, `not`**, because the printer renders a binary operator by reading its token's
 * *text*, and wapy's token says `and` where wac's says `&&`. That is deliberate on both sides:
 * `packages/wacc/src/wapylex.wac` retags the *kind* and leaves the span alone precisely so a
 * diagnostic quotes the word the reader wrote. The kinds are identical, and comparing the bytes
 * under them would be comparing the surfaces rather than the parse.
 *
 * `packages/wacc/test/wac/wapy_test.wac` normalises the same three, for the same reason.
 */
function bare(dumped: string): string {
  return dumped
    .replace(/@\d+:\d+/g, "")
    .replaceAll("(binary and ", "(binary && ")
    .replaceAll("(binary or ", "(binary || ")
    .replaceAll("(unary not ", "(unary ! ");
}

function tracked(): string[] {
  const out = new Deno.Command("git", {
    args: ["ls-files", "*.wac"],
    cwd: ROOT,
    stdout: "piped",
  }).outputSync();
  return new TextDecoder().decode(out.stdout).split("\n").filter(Boolean);
}

// `[§wac-wapy-roundtrip-5vd2qnw]` — *"Converting wac to wapy and parsing the result produces the
// same syntax tree as parsing the original, for every file in `spec/tour.wac` and every package in
// this repository."* This test is what that clause is about; it named the reference's round trip
// until 2026-08-27, and the clause is stronger now than the sentence promises, because the parse it
// is compared against is a *different implementation's*.
Deno.test("[§wac-wapy-roundtrip-5vd2qnw] wapy round trip: the printer's output is what wacc reads back", async () => {
  const api = await waccApi() as unknown as {
    dump: (src: Uint8Array) => string;
    dumpWapy: (src: Uint8Array) => string;
    wapyOf: (src: Uint8Array) => string;
  };
  const enc = new TextEncoder();

  const files = tracked();
  if (files.length < 300) throw new Error(`only ${files.length} tracked .wac files — did git run?`);

  const broke: string[] = [];
  const fixed: string[] = [];
  let compared = 0;

  for (const f of files) {
    let src: string;
    try {
      src = await Deno.readTextFile(`${ROOT}${f}`);
    } catch {
      continue;
    }
    // **No file is skipped for being unrenderable.** The reference's printer kept an `unhandled`
    // list and this walk stepped over anything on it; `packages/wacc/src/wapyprint.wac` is a
    // `match` over every AST enum, so a variant it does not handle is a compile error in that file
    // rather than a silent omission here.
    let wapy: string;
    try {
      wapy = api.wapyOf(enc.encode(src));
    } catch (e) {
      broke.push(`${f} — the printer refused it: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    let same = false;
    let why = "";
    try {
      same = bare(api.dump(enc.encode(src))) === bare(api.dumpWapy(enc.encode(wapy)));
      if (!same) why = "the trees differ";
    } catch (e) {
      why = `wacc refused the rendering: ${e instanceof Error ? e.message : String(e)}`;
    }

    compared++;
    if (f in KNOWN_BAD) {
      if (same) fixed.push(`${f} — listed as ${KNOWN_BAD[f]}, but it round-trips now`);
    } else if (!same) {
      broke.push(`${f} — ${why}`);
    }
  }

  // **Both directions, and the count.** Without the last line a resolver that found nothing would
  // report no failures and be read as everything passing.
  if (compared < 300) throw new Error(`only ${compared} files compared — the walk found too few`);
  if (broke.length > 0) {
    throw new Error(`${broke.length} of ${compared} file(s) do not survive the round trip:\n  ${broke.join("\n  ")}`);
  }
  if (fixed.length > 0) {
    throw new Error(`${fixed.length} file(s) in KNOWN_BAD now work — delete them from the list:\n  ${fixed.join("\n  ")}`);
  }
});
