// Branch coverage for json.
//
// The exercises are deliberately the same ones the test suite runs — the vendored
// JSONTestSuite corpus, the mutation seeds, the number corpora — because coverage
// measured against a *different* workload tells you about that workload, not about
// what the tests actually check.
//
//   deno task coverage:json
//   deno task coverage:json --verbose

import { instrument, report } from "../../harness/wacCoverage.ts";

const verbose = Deno.args.includes("--verbose");
const enc = new TextEncoder();

const run = await instrument("packages/json/src/json.wac");
const canonicalize = run.mod.canonicalize as (b: Uint8Array) => { ok: boolean; code: number };
// `errorCode` and `errorPos` were separate exports that re-parsed to answer; `canonicalize`
// returns a struct carrying both now, so exercising it exercises them.
const errorCode = canonicalize;
const errorPos = canonicalize;
const parseNumberValue = run.mod.parseNumberValue as (b: Uint8Array) => number;

/** Every document in the conformance corpus, which is the broadest input set. */
const DIR = "packages/json/test/jsontestsuite/";
for (const entry of Deno.readDirSync(DIR)) {
  if (!entry.name.endsWith(".json")) continue;
  const bytes = Deno.readFileSync(DIR + entry.name);
  canonicalize(bytes);
  errorCode(bytes);
  errorPos(bytes);
}

/**
 * The JSON5 corpus, which is the only thing that reaches the JSON5 half of `parse.wac` at all.
 *
 * Without it the report says the comments, the single-quoted strings and the ECMAScript numbers
 * are dead code — the opposite of the truth, since `test/json5.test.ts` drives every one of them
 * against the reference implementation. A tool that reports well-tested code as untested is worse
 * than one that reports nothing, because the number it prints is the one people act on.
 */
const canonicalizeJson5 = run.mod.canonicalizeJson5 as (b: Uint8Array) => { ok: boolean };
const json5Corpus: { cases: { input: string }[] } = JSON.parse(
  Deno.readTextFileSync("packages/json/test/vendor/json5.json"),
);
for (const c of json5Corpus.cases) canonicalizeJson5(enc.encode(c.input));
// And every JSON document again through the JSON5 parser: the superset invariant the test asserts.
for (const entry of Deno.readDirSync(DIR)) {
  if (!entry.name.endsWith(".json")) continue;
  canonicalizeJson5(Deno.readFileSync(DIR + entry.name));
}

/** The number paths, which the corpus barely touches. */
for (
  const s of [
    "0", "-0", "1", "1.5", "-2.25", "1e5", "1E-5", "1e+5", "0.1",
    "9007199254740993", "1e308", "1e309", "1e-400", "5e-324",
    "123456789012345678901234567890", "0.1234567890123456789012345",
    "1.7976931348623157e308", "2.2250738585072011e-308", "1e23",
  ]
) {
  parseNumberValue(enc.encode(s));
  canonicalize(enc.encode(s));
}

/**
 * The failure paths of parseNumberValue.
 *
 * Added because coverage found them unexercised *here* while number.test.ts covers
 * them — the standing hazard of this file: it is a second workload written by hand,
 * so it drifts from the suite it is meant to measure.
 */
for (const s of ["", "[", "1 2", "01", "-", "1e", '"1"', "true", "null", "[1]", '{"a":1}']) {
  parseNumberValue(enc.encode(s));
}

/** Escapes and UTF-8, including the paths that reject. */
for (
  const s of [
    '"\\u0041\\n\\t\\r\\b\\f\\/\\\\\\""', '"\\ud83d\\ude00"', '"\\ud83d"', '"\\udc00"',
    '"\\ud83dx"', '"\\u00e9"', '"café 日本 😀"',
    '"\\uZZZZ"', '"\\u12"', '"\\q"', '"unterminated', '"a\tb"',
  ]
) canonicalize(enc.encode(s));

/** Raw byte sequences: control bytes and malformed UTF-8, which no text source gives. */
for (
  const body of [
    [0x81], [0xC3], [0xC3, 0x28], [0xC0, 0x80], [0xED, 0xA0, 0x80],
    [0xF5, 0x80, 0x80, 0x80], [0xF4, 0x90, 0x80, 0x80], [0xE0, 0x80, 0x80],
    [0xC2, 0x80], [0xEF, 0xBF, 0xBF], [0xF4, 0x8F, 0xBF, 0xBF], [0x01],
    // A valid lead with a bad *later* continuation byte, which reaches the loop
    // rather than the first range check.
    [0xE6, 0x97, 0x41], [0xF0, 0x9F, 0x41, 0x80], [0xF0, 0x9F, 0x98, 0x41],
  ]
) errorCode(new Uint8Array([0x22, ...body, 0x22]));

/** Sequences cut off by the end of input, with no closing quote to reject them. */
for (const body of [[0xC3], [0xE6], [0xE6, 0x97], [0xF0], [0xF0, 0x9F, 0x98]]) {
  errorCode(new Uint8Array([0x22, ...body]));
}

/** Depth, both inside and past the limit. */
for (const d of [1, 399, 400, 500]) {
  errorCode(enc.encode("[".repeat(d) + "]".repeat(d)));
}

/**
 * The lookup index: both sides of the threshold, and a push after it is built.
 *
 * `get` scans until an object has served `INDEX_MIN_SCANS` lookups and has at least
 * `INDEX_MIN_MEMBERS` members, then indexes. The indexed path, the build, and index
 * maintenance in `push` are all unreachable from a workload that looks something up once —
 * which every other exercise in this file does.
 */
const indexRun = await instrument("packages/json/test/wac/json_test.wac");
for (const [name, fn] of Object.entries(indexRun.mod)) {
  if (!name.startsWith("test") || typeof fn !== "function") continue;
  const failure = (fn as () => string)();
  if (failure !== "") throw new Error(`${name} failed during coverage: ${failure}`);
}

/** Containers big enough to grow several times, and lookup hits and misses. */
canonicalize(enc.encode(`[${Array.from({ length: 200 }, (_, i) => i).join(",")}]`));
canonicalize(enc.encode(`{${Array.from({ length: 200 }, (_, i) => `"k${i}":${i}`).join(",")}}`));
canonicalize(enc.encode('{"a":1,"a":2}'));

/**
 * The wac-written tests are a second entry point.
 *
 * Much of `value.wac` — the container accessors, the string-typed edge, lookup by key
 * — is reachable only from wac, not from the four exports json.wac offers the host. A
 * report over the public API alone shows those as dead, which is the opposite of the
 * truth: they are tested, just not from here.
 */
/**
 * The bounds traps, which need one call each from the host to observe.
 *
 * The file moved to `test/wac/bounds_test.wac` and its functions were renamed to `test_traps_*`
 * when `wac test` learned to assert a trap (1371e824). This path was not updated with it, so
 * `deno task coverage:json` failed on a missing file — and nothing said so, because the command
 * is a reporting tool that the suite does not run. The names are read from the file rather than
 * listed, so the next rename shows up as a smaller number instead of a crash.
 */
const bounds = await instrument("packages/json/test/wac/bounds_test.wac");
const traps = Object.keys(bounds.mod).filter((n) => n.startsWith("test_"));
if (traps.length === 0) {
  throw new Error("no test_ exports in bounds_test.wac — the coverage run would report nothing");
}
for (const name of traps) {
  try { (bounds.mod[name] as () => unknown)(); } catch { /* the trap is the point */ }
}

const { total, covered } = report([run, indexRun, bounds], "packages/json/", { verbose });
if (covered < total) Deno.exit(0); // reporting tool, not a gate
