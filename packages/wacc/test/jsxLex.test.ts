// The lexer's JSX modes, which rung 1 cannot compare.
//
// Every other claim about the lexer is checked against the reference, token for token, over every
// `.wac` file in the repository. That oracle stops at JSX: the reference has no modes and no
// `jsx text` kind, so it reads `<p>it's here</p>` as a character literal that swallows the closing
// tag. `issues/lang/0108`.
//
// So this file asserts the two halves that have no oracle, and asks the reference for the one that
// does:
//
//   - **what text mode reads** — a run of text is text, whatever bytes are in it;
//   - **where a tag begins** — `<` is the less-than operator wherever the token before it can end an
//     expression, and every non-JSX program is on that side of the line, which is why none of them
//     lexes differently than it did. That half *is* checked against the reference, because the
//     reference is right about all of it.

import { wacLex } from "wac/wacLex.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/lex.wac");
const tokensOf = mod.lexTokens as (src: Uint8Array) => Int32Array;
const errorsOf = mod.lexErrors as (src: Uint8Array) => Int32Array;

const STRIDE = 5;
const K_JSX_TEXT = 84;

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/** Every `jsx text` run in a source, as the text it spans. */
function textRuns(source: string): string[] {
  const bytes = new TextEncoder().encode(source);
  const flat = tokensOf(bytes);
  const out: string[] = [];
  for (let i = 0; i * STRIDE < flat.length; i++) {
    const at = i * STRIDE;
    if (flat[at] !== K_JSX_TEXT) continue;
    out.push(new TextDecoder().decode(bytes.slice(flat[at + 1], flat[at + 1] + flat[at + 2])));
  }
  return out;
}

function errorCodes(source: string): number[] {
  const flat = errorsOf(new TextEncoder().encode(source));
  const out: number[] = [];
  for (let i = 0; i * 3 < flat.length; i++) out.push(flat[i * 3]);
  return out;
}

const ELEMENT = (body: string) => `import { Attr, Node } from core;\nNode f() { return <p>${body}</p>; }\n`;

Deno.test("jsx text: a run of text is text, whatever is in it", () => {
  // Each of these is a token that would have run past the closing tag if the text were lexed as wac.
  // The apostrophe and the lone quote are the two the issue named; the rest are the neighbours found
  // by asking what else a lexer starts on.
  const cases: [string, string][] = [
    ["an apostrophe", "it's here"],
    ["a lone double quote", 'a " b'],
    ["balanced quotes, kept verbatim rather than unescaped", 'He said "hi" to me'],
    ["a byte no token starts with", "cost: #4 & 50%"],
    ["a line comment that is not one", "see http://x.example"],
    ["a block comment that is not one", "/* not a comment */"],
    ["a backslash, which no escape follows", "a \\ b"],
    ["a character-literal opener with nothing after it", "don't"],
    ["a semicolon and a brace-less end", "a; b"],
  ];
  for (const [what, body] of cases) {
    assertEquals(textRuns(ELEMENT(body)), [body], what);
    assertEquals(errorCodes(ELEMENT(body)), [], `${what}: no lex error`);
  }
});

Deno.test("jsx text: a run ends at `{`, at a tag, and nowhere else", () => {
  assertEquals(
    textRuns(ELEMENT("hello {who} and <b>you</b> too")),
    ["hello ", " and ", "you", " too"],
    "four runs: the spliced expression and the nested element each end one",
  );
  // **A `<` that begins neither a name nor `/` is text.** JSX in JavaScript refuses this and makes
  // you write `{'<'}`; there is no reason to, since the thing that follows says which it is.
  assertEquals(textRuns(ELEMENT("1 < 2 and 3 &lt; 4")), ["1 < 2 and 3 &lt; 4"]);
  // Whitespace between two elements is a run of its own, which is what makes it a child.
  assertEquals(textRuns(ELEMENT("<b>a</b> <b>b</b>")), ["a", " ", "b"]);
  // Across lines it is still a run — the emitter is what decides a break is layout, not the lexer.
  assertEquals(textRuns("Node f() { return <p>\n  <b>a</b>\n</p>; }\n"), ["\n  ", "a", "\n"]);
});

Deno.test("jsx text: the modes nest, and come back", () => {
  // tag → normal (an attribute's expression) → tag → text, and out again. A mode machine that
  // forgot where it came from would still be in text mode at the `;`, and the run would swallow it.
  const src = 'Node f() { return <div a={g(<b/>)}>x</div>; }\nNode g(Node n) { return n; }\n';
  assertEquals(textRuns(src), ["x"]);
  assertEquals(errorCodes(src), []);

  // A `}` inside a spliced expression closes its own brace, not the splice.
  assertEquals(textRuns("Node f(i32 v) { return <p>{h(P { x: v })}!</p>; }\n"), ["!"]);
});

Deno.test("jsx: a `<` that can be the operator still is — checked against the reference", () => {
  // The discriminator is "the token before it cannot end an expression". These are the shapes where
  // it can, and every one of them lexes exactly as the reference lexes it — which is the claim that
  // matters most here, since it is what says no program without JSX changed.
  const sources = [
    "bool f(i32 a, i32 b) { return a < b; }",
    "bool f(i32 a) { return g(a) < 2; }",
    "bool f(i32[] a) { return a[0] < 2; }",
    "struct S<T> { T v; } i32 f(S<i32> s) { return s.v; }",
    "bool f(i32? a) { return a! < 2; }",
    "bool f() { return true < false; }",
    "i32 f(i32 a) { return a++ < 2 ? 1 : 0; }",
    "bool f(i32 a) { return (a) < 2 && a << 1 > 3; }",
  ];
  for (const source of sources) {
    const flat = tokensOf(new TextEncoder().encode(source));
    const mine: { kind: number; at: string }[] = [];
    for (let i = 0; i * STRIDE < flat.length; i++) {
      mine.push({ kind: flat[i * STRIDE], at: `${flat[i * STRIDE + 3]}:${flat[i * STRIDE + 4]}` });
    }
    // The reference stores each token's text rather than a span, so the comparison is by position:
    // one token at each place the reference put one, and none of them a run.
    const { tokens } = wacLex(source);
    assertEquals(
      mine.map((m) => m.at),
      tokens.map((t: { line: number; col: number }) => `${t.line}:${t.col}`),
      `${source}: a token in each place the reference has one`,
    );
    assertEquals(mine.some((m) => m.kind === K_JSX_TEXT), false, `${source}: no jsx text`);
  }
});

Deno.test("jsx: an element that is never closed ends at the end of the file", () => {
  // Text mode runs to the end of the source rather than past it. The parser is what reports the
  // missing closing tag; the lexer's job is to still terminate.
  const src = "Node f() { return <p>hello;\n";
  assertEquals(textRuns(src), ["hello;\n"]);
  assertEquals(errorCodes(src), []);
});
