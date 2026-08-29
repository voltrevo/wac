// The bootstrap ladder, in full — the page this site did not have.
//
// The ladder became *the* way wac is built on 2026-08-28, when the TypeScript reference compiler
// was deleted. Until then the site could mention it in a paragraph, because the interesting claim
// was "there are two compilers and they agree". Now it is the only path from source to a working
// `wac`, and a reader who wants to know whether that is trustworthy has to be able to read the
// whole chain — which is what this page is for.
//
// **Ordered by what a skeptic asks.** Not L0 upward, which is the order it was built in and the
// order that buries the interesting part: what a reader wants first is "how much of this did
// somebody have to write by hand and trust", and the answer is three files. The rungs come after
// that, because they only matter once you believe the root.
//
// The numbers are typed here from `bootstrap/README.md` and are a snapshot; the page says so where
// it states one, because a figure on a website with no date is a claim about the present that was
// true in the past.

import { A, BLOB, Caveat, Code, Facts, Lead, m, n, P, Page, Section, Sub, Table } from "./ui";
import { c, font } from "./tokens";

const EX_L0 = `;; the ladder's root: one instruction per line, every index named
func $add (param $a i32) (param $b i32) (result i32)
  local.get $a
  local.get $b
  i32.add
end`;

const EX_L1 = `; an interpreter, not a compiler — s-expressions, closures, a heap
(define (compile-expr e env)
  (cond ((number? e) (emit-const e))
        ((symbol? e) (emit-load (lookup e env)))
        (else        (compile-call e env))))`;

const EX_L2 = `// A wx string literal is a length then its bytes, so writing one out is a loop over both.
(fn emits ((s i32)) i32
  (do (let n (load s))
      (let i 0)
      (while (< i n)
        (emit1 (load8 (+ s (+ 4 i))))
        (set i (+ i 1)))
      0))`;

const EX_L3 = `i32 emits(i32 s) {
  i32 n = load(s);
  i32 i = 0;
  while (i < n) { emit1(load8(s + 4 + i)); i = i + 1; }
  return 0;
}`;

const EX_L4 = `struct Tok { i32 kind; i32 start; i32 len; i32 val; }

Tok[] toks;`;

const EX_L5 = `enum Option {
  Some(i32 v), None
  bool isSome(const this) {
    return match (this) { case Some(_): true, case None: false };
  }
}`;

const EX_BUILD = `$ ./bootstrap.sh
bootstrap: building the ladder
bootstrap: building the wac command with it
bootstrap: building the binary that carries it
bootstrap: fixed point, round 1 of at most 4
bootstrap: it is a fixed point after 1 round(s), 1817584 bytes`;

export default function Bootstrap() {
  return (
    <Page current="bootstrap">
      <Section
        id="nothing"
        kicker="the whole point"
        title="Nothing here starts from a binary somebody compiled once"
      >
        <P>
          <Lead>A compiler has to be built by a compiler.</Lead> Almost every language answers that
          by shipping one: a binary in the repository, or a download, compiled years ago by
          something nobody has looked at since. It works, and it is unauditable — you are trusting
          a file, not a chain of reasoning.
        </P>
        <P>
          wac answers it differently. {m({ children: "./bootstrap.sh" })} builds the compiler from
          source every time, through five languages, the lowest of which is hand-written wasm
          assembly text. There is no checked-in wasm anywhere in the chain: an assembler written
          twice from a written format, an interpreter, four compilers, and then the real compiler
          reproducing itself.
        </P>
        <Code label="a full build, from a clone with nothing in it" lang="text" code={EX_BUILD} />
        <P>
          That last line is the check that matters and it is not optional. The compiler the ladder
          builds is used to build the compiler again; if the two are not byte-identical the build
          is refused rather than installed. A compiler whose output depends on which compiler built
          it is one where every artefact afterwards was made by something nobody checked.
        </P>
      </Section>

      <Section
        id="trusted"
        kicker="the number to ask for"
        title="How much of this did somebody have to read?"
      >
        <P>
          The honest measure of a bootstrap is not how few lines it has, it is how many have to be
          trusted because a person read them and said so. Everything above them is trusted by
          derivation — it was produced by something already trusted.
        </P>
        <Facts
          rows={[
            ["the assembler that runs", "1,217 lines of Rust — turns L0 text into wasm bytes"],
            ["the L1 interpreter", "1,814 lines of hand-written L0 — the only program written in it"],
            ["the flattener", "500 lines — resolves imports, which no rung can do"],
            ["trusted by reading", "3,531 lines, being those three"],
            ["trusted by derivation", "everything else: four compilers and the wac compiler itself"],
            ["what it replaced", "18,203 lines of TypeScript, all of it in the first column"],
          ]}
        />
        <P>
          And the first of those has a witness of its own.{" "}
          <Lead>The L0 assembler is implemented twice</Lead> — once in Rust, which is the one the
          build runs, and once in JavaScript, from the same written format, with the two required
          to agree byte for byte. The second implementation is not in the trusted column: it is the{" "}
          <em>check</em> on the first rather than more code to read.
        </P>
        <P>
          That is the only check a bootstrap root can have. Everything above it is derived from it,
          so nothing above can be an oracle for it — two independent readings of a written
          specification is what is left, and it is what is done.
        </P>
        <Caveat title="The flattener is trusted and has no second implementation">
          <P>
            {m({ children: "import" })} is not a thing any rung understands — resolving a path is a
            file read, and no wac-L4 program can do one. So a driver flattens the module graph
            before the ladder sees it, concatenating modules and renaming the private declarations
            of two that chose the same name. A bug there produces a wrong program quietly, which is
            the definition of code that has to be trusted. It is counted in the 2,827 above rather
            than left out, because leaving it out would have been flattering.
          </P>
        </Caveat>
      </Section>

      <Section id="rungs" kicker="five languages" title="The ladder itself">
        <P>
          Every rung is a language, and every rung&rsquo;s compiler is written in the rung below.
          Only {n({ children: "wac" })} survives as a language name; the rest are numbered, because
          they look alike and are not alike — writing {m({ children: "==" })} where L1 wants{" "}
          {m({ children: "=" })} is a mistake that names invited and numbers do not.
        </P>
        <Table
          head={["rung", "what it adds", "written in", "size"]}
          rows={[
            [
              <span style={{ fontFamily: font.mono }}>wac-L0</span>,
              "wasm as text: one instruction per line, every index named, structs, arrays, packed bytes",
              "TypeScript and Rust, twice over",
              "—",
            ],
            [
              <span style={{ fontFamily: font.mono }}>wac-L1</span>,
              "s-expressions, closures, a heap — an interpreter, not a compiler",
              <strong style={{ color: c.text }}>hand-written wac-L0</strong>,
              "1,814 lines",
            ],
            [
              <span style={{ fontFamily: font.mono }}>wac-L2</span>,
              "i32, memory, functions, while, string literals",
              "wac-L1",
              "298 lines",
            ],
            [
              <span style={{ fontFamily: font.mono }}>wac-L3</span>,
              "C-family syntax, globals, scopes, shadowing",
              "wac-L2",
              "591 lines",
            ],
            [
              <span style={{ fontFamily: font.mono }}>wac-L4</span>,
              "structs, arrays, enum/match, methods, u8[] strings, wasm GC",
              "wac-L3",
              "1,331 lines",
            ],
            [
              <span style={{ fontFamily: font.mono }}>wac-L5</span>,
              "wac itself — all of core/ and all of wacc/src",
              "wac-L4",
              "4,109 lines",
            ],
          ]}
        />
        <P>
          Filenames say the same thing: {m({ children: "bootstrap/boot/l4.l3" })} is the L4
          compiler, written in L3.
        </P>

        <Sub id="bottom" title="The bottom, which is one instruction per line">
          <Code label="wac-L0 — the format the assembler reads" lang="text" code={EX_L0} />
          <P>
            No optimisation, no inference, nothing clever: every index is named so a human can
            check it against the wasm specification, which is the only way the root gets audited.
          </P>
        </Sub>

        <Sub id="interpreter" title="The first rung is an interpreter, deliberately">
          <Code label="wac-L1 — the only program written in raw L0" lang="text" code={EX_L1} />
          <P>
            An interpreter is smaller than a compiler, and L1 is the rung whose implementation a
            person has to write by hand in assembly text. Making it the cheapest possible thing is
            what keeps the hand-written root at 1,300 lines instead of several thousand.
          </P>
        </Sub>

        <Sub id="second" title="The second rung is where a compiler first appears">
          <Code label="wac-L2 — from bootstrap/boot/l3.l2, which is the L3 compiler" lang="text" code={EX_L2} />
          <P>
            Still s-expressions, and no longer an interpreter: this is the language the first real
            compiler is written in. Whole vocabulary: {m({ children: "i32" })}, fixed memory,
            functions, {m({ children: "while" })}, string literals. There is no allocator, so every
            table inside the compiler it holds is a hard-coded address — the file says so at the
            top, and lists them.
          </P>
        </Sub>

        <Sub id="c-family" title="The third rung is where it starts to look like wac">
          <Code label="wac-L3 — the same routine one rung up, from bootstrap/boot/l4.l3" code={EX_L3} />
          <P>
            <Lead>The same function, in the next language.</Lead> Braces, infix arithmetic, a
            condition in parentheses, {m({ children: "return" })}. Nothing was added to the
            program — it is the same loop over the same bytes — which is what makes the pair worth
            printing: the distance between two rungs is the syntax and not the work.
          </P>
        </Sub>

        <Sub id="gc" title="The fourth rung stops doing its own memory arithmetic">
          <Code label="wac-L4 — from bootstrap/boot/l5.l4, which is the L5 compiler" code={EX_L4} />
          <P>
            Every compiler below this one keeps its tokens at a fixed address —{" "}
            {m({ children: "i32 TOK = 262144;" })}, with the layout arithmetic written out at each
            use, because no rung below L4 has an allocator. Here the same table is{" "}
            {m({ children: "Tok[] toks" })}: a wasm GC array of a declared struct. Its own source
            calls that <em>the first thing on this ladder that has been true of a compiler here</em>.
          </P>
        </Sub>

        <Sub id="top" title="The top rung compiles the language this site is about">
          <Code label="wac-L5 — the shape core/option.wac is actually written in" code={EX_L5} />
          <P>
            Real wac: structs with {m({ children: "const this" })} methods, enums with
            comma-separated variants, {m({ children: "match" })} as both a statement and an
            expression, arrays, {m({ children: "u8[]" })}, reference globals — compiled through six
            languages and two interpreters. Its compiler is the last program in the chain, and
            compiling {m({ children: "packages/wacc/src" })} with it produces the compiler wac uses
            for everything else.
          </P>
        </Sub>
      </Section>

      <Section
        id="rules"
        kicker="why it converges"
        title="Two rules that make it a ladder rather than five unrelated languages"
      >
        <P>
          <Lead>Every rung emits wac-L0 text, not wasm bytes.</Lead> So nothing above L0
          re-implements LEB128 or section framing — work with a known answer and a new place to be
          wrong. There is one program in the whole chain that knows what a wasm byte looks like,
          and it is the one that was written twice.
        </P>
        <P>
          <Lead>From L3 up, each rung is a superset of the one below.</Lead> A rung&rsquo;s
          compiler is the previous compiler plus features, ported upward rather than rewritten,
          which is what makes the ladder converge on wac instead of wandering toward five
          languages that happen to share a syntax.
        </P>
        <P>
          One consequence worth stating, because it looks like an omission and is a decision:{" "}
          <Lead>generics belong to L5&rsquo;s compiler, not to L4&rsquo;s language.</Lead> They are
          the most expensive feature to implement and the cheapest to live without, so putting them
          in L4 would mean implementing monomorphisation in L3&rsquo;s compiler as well — paying
          for them twice, at the rung where code costs most to write. The tax is a growable vector
          hand-written per element type: 25 lines each, perhaps five of them.
        </P>
      </Section>

      <Section id="hosts" kicker="two engines" title="The same rungs, run two ways">
        <P>
          {m({ children: "bootstrap/ts/" })} drives every rung through Deno;{" "}
          {m({ children: "bootstrap/rust-ladder/" })} drives the same rungs through V8 embedded in
          Rust, and a test checks that the wac-L0 they produce is identical.
        </P>
        <P>
          That is a different claim from the two assemblers agreeing. The assembler differential
          covers <em>reading</em> a written format; this one covers <em>running</em> five
          compilers, where the differences an engine can introduce are the interesting ones. The
          one line of JavaScript in the Rust host is{" "}
          {m({ children: "new WebAssembly.Instance" })}, because that is a JS constructor and
          V8&rsquo;s C++ embedding API exposes no equivalent.
        </P>
        <P>
          The finished command runs on either engine too:{" "}
          {m({ children: "./bootstrap.sh --host wasmtime" })} builds the same compiler with no
          JavaScript underneath it at all, which is the only test of the claim that a wac program
          does not depend on one.
        </P>
      </Section>

      <Section
        id="not"
        kicker="honestly"
        title="What the top rung is not"
      >
        <P>
          <Lead>wac-L5 is the minimum that compiles wacc, and not a wac compiler.</Lead> That is
          the design rather than a shortfall: the ladder exists to reach{" "}
          {m({ children: "packages/wacc/src" })}, and every feature beyond what those lines use is
          a feature the rung below has to pay for too. Pointed at the wider corpus, 81 of 296 entry
          points compile and validate.
        </P>
        <P>
          The gaps are written down in{" "}
          <A href={`${BLOB}/bootstrap/README.md`} external>bootstrap/README.md</A> so nobody has to
          discover them: {m({ children: "import" })} is ignored and the flattener does the linking;{" "}
          {m({ children: "export" })} is honoured for functions and nothing else; a module-level{" "}
          {m({ children: "const" })} is refused, and refused badly. None of them is reachable from
          wacc&rsquo;s own source, which is exactly why they went unnoticed — and why they are
          listed rather than fixed.
        </P>
        <P>
          The measure that matters is not whether L5 is a good compiler. It is whether the compiler
          L5 <em>builds</em> is the right one, and that is checked from both ends: every one of
          wac&rsquo;s spec cases comes out as its expectation says, and the build refuses itself
          unless compiling the compiler twice gives the same bytes.
        </P>
      </Section>
    </Page>
  );
}
