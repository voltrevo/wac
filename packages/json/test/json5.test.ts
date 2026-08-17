// JSON5, measured against the implementation the format is defined by.
//
// The corpus in `vendor/json5.json` records what `npm:json5@2.2.3` does with 459 inputs — see
// `../tools/vendorJson5.ts` for how it is built and, more usefully, for the two shapes it
// deliberately cannot contain. Nothing here decides what JSON5 means; it only checks that this
// package agrees with something that already does.
//
// The second test is the other half, and needs no vendoring: **JSON5 is a superset of JSON**, so
// for every document the JSON parser accepts, the JSON5 parser has to accept it and produce the
// same tree. The JSONTestSuite corpus already in this directory is ~300 documents of adversarial
// JSON, and running it through the new path costs nothing. That invariant is also the oracle for
// duplicate and index-like member names, which the vendored comparison cannot see.

import { canonicalJson5, ERR, json, jsonText } from "./util.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

type Vendored = {
  source: string;
  cases: { input: string; json: string | null }[];
};

const CORPUS: Vendored = JSON.parse(
  await Deno.readTextFile(new URL("./vendor/json5.json", import.meta.url)),
);

/**
 * Inputs where this parser knowingly answers differently, each with the reason.
 *
 * **Every entry is asserted to actually diverge.** A list of exceptions that have quietly been
 * fixed is worse than no list: it goes on excusing a case that now passes, and the next real
 * divergence gets added to it by someone who reads the list as normal. So a case here that agrees
 * with the reference fails the test and asks to be deleted.
 */
const KNOWN: { input: string; why: string }[] = [
  {
    input: "{é:1}",
    why:
      "an unquoted member name outside ASCII. ECMAScript's IdentifierName is a Unicode category " +
      "question and this parser has no Unicode tables, so it refuses with ERR_UNSUPPORTED " +
      "rather than guessing — see parseKey in parse.wac. Quoting the name works.",
  },
  { input: "{é:1,b:2}", why: "the same, with the refused name first in a longer object" },
  {
    input: "{\\u0041:1}",
    why:
      "a \\uXXXX escape inside an unquoted member name. Allowed by ECMAScript, refused here for " +
      "the same reason as the above: deciding whether the escaped character may appear in a name " +
      "is the Unicode question again, and the answer would be right only for ASCII.",
  },
  { input: "{\\u0041:1,b:2}", why: "the same, in a longer object" },
  // The continuation branches. Listed separately because they are reached by different code from
  // the leading-character ones, and until the corpus contained them neither branch ran at all.
  { input: "{aé:1}", why: "a non-ASCII character after the first, refused for the same reason" },
  { input: "{aé:1,b:2}", why: "the same, in a longer object" },
  { input: "{a1é:1}", why: "the same, after a digit" },
  { input: "{a1é:1,b:2}", why: "the same, in a longer object" },
  { input: "{a\\u0041:1}", why: "a \\uXXXX escape after the first character" },
  { input: "{a\\u0041:1,b:2}", why: "the same, in a longer object" },
  { input: "{$a\\u0042:1}", why: "the same, after a `$`" },
  { input: "{$a\\u0042:1,b:2}", why: "the same, in a longer object" },
];

/**
 * The tree our text describes, spelled the way the reference side is spelled.
 *
 * The vendored answer is `JSON.stringify` of the reference's value, so comparing raw text would
 * be comparing *number formatting*: `Number` keeps the bytes it was parsed from, so `0.0` comes
 * back as `0.0` where `JSON.stringify` writes `0`. Re-reading our output with `JSON.parse` and
 * writing it again puts both sides in one spelling without touching the value — a number we got
 * wrong is still wrong afterwards. Round-tripping the *text* is `roundtrip.test.ts`'s claim, not
 * this one.
 *
 * It also checks something worth checking: our output is valid JSON. It is a JSON5 document going
 * in, and if the answer were not JSON the next reader would be the one to find out.
 */
function sameSpelling(text: string): string {
  return JSON.stringify(JSON.parse(text));
}

Deno.test("JSON5: every vendored case agrees with the reference", async () => {
  const wrong: string[] = [];
  const known = new Map(KNOWN.map((k) => [k.input, k.why]));
  const divergedAsExpected = new Set<string>();

  for (const c of CORPUS.cases) {
    const got = await canonicalJson5(c.input);
    const want = c.json;
    let ours: string;
    try {
      ours = got.ok ? sameSpelling(got.text) : `rejected (code ${got.code} at ${got.pos})`;
    } catch {
      ours = `accepted, but the text it produced is not JSON: ${JSON.stringify(got.text)}`;
    }
    const agrees = want === null ? !got.ok : ours === want;
    if (agrees) continue;
    if (known.has(c.input)) {
      divergedAsExpected.add(c.input);
      continue;
    }
    wrong.push(`${JSON.stringify(c.input)}: json5 says ${want ?? "reject"}, we say ${ours}`);
  }

  const stale = KNOWN.filter((k) => !divergedAsExpected.has(k.input));
  for (const k of stale) {
    wrong.push(`${JSON.stringify(k.input)} is listed as a known divergence but now agrees — delete the entry`);
  }
  if (wrong.length > 0) {
    throw new Error(`${wrong.length} of ${CORPUS.cases.length} disagree with ${CORPUS.source}:\n  ` + wrong.join("\n  "));
  }
});

Deno.test("JSON5: the comparison can fail", async () => {
  // Two runs of a parser against a corpus it was tuned on agree perfectly, and so does a
  // comparison that never ran. These are the two answers the loop above can give, forced.
  const accepted = await canonicalJson5("{a:1}");
  if (!accepted.ok || accepted.text !== '{"a":1}') {
    throw new Error(`canary: expected {"a":1}, got ${accepted.ok ? accepted.text : "a rejection"}`);
  }
  const rejected = await canonicalJson5("{a:1");
  if (rejected.ok) throw new Error("canary: an unterminated object was accepted");
});

Deno.test("JSON5: an unquoted non-ASCII name is refused by name, not by accident", async () => {
  // The refusal in parseKey is the documented gap, so it has its own code. Reporting
  // ERR_UNEXPECTED instead would read as "that is not a name", which is untrue.
  const got = await canonicalJson5("{é:1}");
  if (got.ok) throw new Error("expected a refusal");
  if (got.code !== ERR.UNSUPPORTED) {
    throw new Error(`expected ERR_UNSUPPORTED (${ERR.UNSUPPORTED}), got ${got.code}`);
  }
  const quoted = await canonicalJson5("{'é':1}");
  if (!quoted.ok || quoted.text !== '{"é":1}') {
    throw new Error(`the quoted form must still work, got ${quoted.ok ? quoted.text : "a rejection"}`);
  }
});

Deno.test("JSON5: an unterminated block comment reports where it opened", async () => {
  const got = await canonicalJson5("[1, /* unterminated");
  if (got.ok) throw new Error("expected a rejection");
  if (got.code !== ERR.COMMENT) throw new Error(`expected ERR_COMMENT (${ERR.COMMENT}), got ${got.code}`);
  if (got.pos !== 4) throw new Error(`expected the position of the opening delimiter (4), got ${got.pos}`);
});

Deno.test("JSON5: accepts every JSON document, with the same tree", async () => {
  const mod = await json();
  // Concatenated rather than joined with `new URL`: the corpus is named after what each document
  // does to a parser, and several of those names contain characters a URL would re-encode.
  const dir = new URL(".", import.meta.url).pathname + "jsontestsuite/";
  const wrong: string[] = [];
  let compared = 0;
  for (const entry of Deno.readDirSync(dir)) {
    if (!entry.name.endsWith(".json")) continue;
    const bytes = Deno.readFileSync(dir + entry.name);
    const asJson = mod.canonicalize(bytes);
    if (!asJson.ok) continue;                  // not JSON, so this invariant says nothing
    compared++;
    const asJson5 = mod.canonicalizeJson5(bytes);
    if (!asJson5.ok) {
      wrong.push(`${entry.name}: JSON accepts it, JSON5 rejects it with code ${asJson5.code}`);
      continue;
    }
    const a = dec.decode(asJson.text);
    const b = dec.decode(asJson5.text);
    if (a !== b) wrong.push(`${entry.name}: JSON gives ${a}, JSON5 gives ${b}`);
  }
  if (compared < 90) {
    throw new Error(`only ${compared} documents were compared — the corpus is not being read`);
  }
  if (wrong.length > 0) {
    throw new Error(`${wrong.length} of ${compared} differ between the two modes:\n  ` + wrong.join("\n  "));
  }
});

Deno.test("JSON5: a comment is not accepted by the JSON parser", async () => {
  // The reason this is a second entry point rather than a widening of the first. A file written
  // with comments and read back with `parse` has to fail, or the two ends disagree silently.
  const withComment = enc.encode("{/*c*/}");
  const mod = await json();
  if (mod.canonicalize(withComment).ok) throw new Error("the JSON parser accepted a comment");
  if (!mod.canonicalizeJson5(withComment).ok) throw new Error("the JSON5 parser rejected a comment");
  if (jsonText(mod.canonicalizeJson5(withComment)) !== "{}") {
    throw new Error("a document that is only a comment inside an object is an empty object");
  }
});
