// The language: how it reads, both surfaces, the boundary, and where WebAssembly runs out.
//
// The snippets are carried over unchanged from the page this replaces — they are checked by
// `site/tools/site.test.ts`, which compiles them and holds the two-surface pair to byte identity, so
// editing them here without editing that would be the drift the test exists to catch.

import InlineDemo from "../editor/InlineDemo";
import { TOTALS } from "../data/built";
import { TREE, BLOB, A, Code, Lead, m, P, Page, Pair, Section, Sub } from "./ui";
import { c, font, space } from "./tokens";

const GITHUB = "https://github.com/voltrevo/wac";



import {
  EX_ENUM,
  EX_GENERIC,
  EX_SURFACE_WAC,
  EX_SURFACE_WAPY,
  EX_WAPY_LIVE,
  EX_MIXED_WAC,
  EX_BEWORD,
  EX_MIXED_WAPY,
  EX_HELLO,
  EX_MATH,
  EX_ERROR,
  EX_STRUCT,
  EX_NULLABLE,
  EX_ARRAYS,
  EX_IMPORTS_MAIN,
  EX_IMPORTS_MATH,
  EX_CORE_MAIN,
  EX_CORE_LIB,
  EX_BINDGEN,
} from "../snippets";

export default function Language() {
  return (
    <Page current="language">
      <Section id="tour" kicker="the language" title="A tour, in one page">
        <P>
          Everything below compiles in this tab. The claim the rest of the site makes rests on the
          language being ordinary enough to write a Tor relay in and strict enough that the relay
          works, so this is the part to be skeptical about first.
        </P>

        <Sub id="hello" title="Hello world">
          <P>
            Functions have explicit return types. {m({ children: "export" })} makes them available
            to the host and to other wac files.
          </P>
          <InlineDemo initialCode={EX_HELLO} />
        </Sub>

        <Sub id="primitives" title="Primitives and control flow">
          <P>
            {m({ children: "i32 i64 f32 f64 bool string" })}, plus unsigned{" "}
            {m({ children: "u8 u16 u32 u64" })}. Full control flow: {m({ children: "if" })}/
            {m({ children: "else" })}, {m({ children: "while" })}, {m({ children: "for" })},{" "}
            {m({ children: "do" })}-{m({ children: "while" })}, {m({ children: "switch" })}, and a
            ternary.
          </P>
          <P>
            Conversions are never implicit, and there are four of them, because &ldquo;cast&rdquo;
            in C means four different things at once: {m({ children: "as" })} is lossless and the
            only one the checker will let you write when it might not be,{" "}
            {m({ children: "as!" })} is checked at run time and traps,{" "}
            {m({ children: "as~" })} truncates on purpose, and {m({ children: "as@" })}{" "}
            reinterprets the bits. <Lead>Which one you meant is in the source</Lead> rather than in
            the reader&rsquo;s head.
          </P>
          <InlineDemo initialCode={EX_MATH} />
        </Sub>

        <Sub id="errors" title="Errors point at the thing">
          <P>
            A condition has to be {m({ children: "bool" })} — there is no truthiness to reason
            about — and the diagnostic says what to write instead.
          </P>
          <Code label="what the compiler prints" code={EX_ERROR} />
        </Sub>

        <Sub id="structs" title="Structs, methods, subtyping">
          <P>
            Methods take an explicit receiver, and {m({ children: "const this" })} forbids mutating
            anything reachable through it — deeply, not one level.
          </P>
          <InlineDemo initialCode={EX_STRUCT} />
        </Sub>

        <Sub id="nullable" title="Nullable references">
          <P>
            {m({ children: "T?" })} is a distinct type, {m({ children: "!" })} unwraps it, and{" "}
            {m({ children: "is null" })} narrows. A reference that has not been checked cannot be
            dereferenced.
          </P>
          <InlineDemo initialCode={EX_NULLABLE} />
        </Sub>

        <Sub id="enums" title="Enums carry payloads, and match is exhaustive">
          <P>
            The feature the rest of this project leans on hardest: a function that answers{" "}
            <em>data, finished, or failed</em> cannot be written as a byte array with a convention,
            and a caller cannot forget the third case.
          </P>
          <InlineDemo initialCode={EX_ENUM} />
        </Sub>

        <Sub id="generics" title="Generics, monomorphised">
          <P>
            One instantiation per distinct set of arguments, so {m({ children: "Vec<i32>" })} costs
            what writing it by hand costs. Code size is byte-identical to the hand-written version.
          </P>
          <InlineDemo initialCode={EX_GENERIC} />
        </Sub>

        <Sub id="arrays" title="Arrays">
          <P>
            GC arrays, bounds-checked, with {m({ children: "i32[5]()" })} for a sized one and{" "}
            {m({ children: "i32[](1, 2, 3)" })} for a literal.
          </P>
          <InlineDemo initialCode={EX_ARRAYS} />
        </Sub>

        <Sub id="imports" title="Multi-file imports">
          <P>
            File-based, with {m({ children: "as" })} to rename. Diamond imports resolve once;
            circular imports are fine, because a wac file holds only declarations and there is no
            initialisation order to get wrong.
          </P>
          <Pair leftLabel="main.wac" rightLabel="math.wac" left={EX_IMPORTS_MAIN} right={EX_IMPORTS_MATH} />
        </Sub>

        <Sub id="core" title="One import is not a file">
          <P>
            {m({ children: "core" })} ships inside the compiler, so it is written without quotes —
            there is no path to be right or wrong about, and it cannot be pointed anywhere else.
          </P>
          <Pair leftLabel="main.wac" rightLabel="report.wac" left={EX_CORE_MAIN} right={EX_CORE_LIB} />
          <P>
            Those two files never mention each other, and neither declares{" "}
            {m({ children: "Read" })}. That matters because wac has <em>nominal</em> types and no
            closures: two identical declarations are two types, and nothing can convert between
            them. Within one project that costs nothing. Across two published libraries it is fatal
            — so a streaming transform naming {m({ children: "fn[Read()]" })} could never be handed
            a reader built anywhere else.
          </P>
          <P>
            Hence the rule for what goes in {m({ children: "core" })}, which is a test rather than a
            taste: <Lead>must this type cross a repository boundary through a function
            reference?</Lead> Containers and sum types do not — they live in a package. Today{" "}
            {m({ children: "Read" })} is the only thing that qualifies.
          </P>
        </Sub>
      </Section>

      <Section id="surfaces" kicker="two surfaces" title="Braces or indentation, one language">
        <P>
          The same language has two ways of being written down. Not a transpiler and not a preset:
          they share a parser for expressions and types, an AST, a resolver, a checker and an
          emitter, and differ only in how a file is laid out.
        </P>
        <Pair leftLabel="histogram.wac" rightLabel="histogram.wapy" left={EX_SURFACE_WAC} right={EX_SURFACE_WAPY} rightLang="wapy" />
        <P>
          <Lead>Those two compile to byte-identical wasm</Lead>, which is the shortest way to say
          that neither is a translation of the other — and a test in the compiler asserts it, so the
          sentence cannot quietly stop being true. A {m({ children: ".wac" })} file may import a{" "}
          {m({ children: ".wapy" })} file and the reverse, in any mixture.
        </P>
        <P>
          <Lead>Only one compiler reads the indented surface.</Lead> wacc has no wapy front end, so
          a {m({ children: ".wapy" })} file goes to the reference — which is the one place the
          reference is not merely the seed. Everything else here is compiled by wacc; this is the
          exception, and it is a gap in wacc rather than a rule about the language. The playground on
          this site answers with whichever compiler the entry requires, and says which one it used.
        </P>
        <P>
          <Lead>It is not Python.</Lead> It does not accept Python, and copying Python into a{" "}
          {m({ children: ".wapy" })} file is an explicit anti-goal. It borrows Python&rsquo;s
          shapes — {m({ children: "def" })}, {m({ children: "class" })},{" "}
          {m({ children: "and" })}/{m({ children: "or" })}/{m({ children: "not" })} and{" "}
          {m({ children: "None" })} — and keeps wac&rsquo;s types, its semantics and its errors.
          The receiver is {m({ children: "this" })} on both surfaces: it was{" "}
          {m({ children: "self" })} until 2026-08-27, and it was the one respelling that cost
          something, because it was the only one whose wac spelling is also a legal identifier.
          It has its own lexer and parser producing the same syntax tree, so a diagnostic names the
          line its author actually wrote.
        </P>
        <P>
          What stops a second surface becoming a permanent tax is a round trip:{" "}
          {m({ children: "wac → wapy → wac" })} must give back the <em>same syntax tree</em>, over{" "}
          {m({ children: "spec/tour.wac" })} and every wac source in the repository — 282 files. Trees
          rather than text,
          so the printer&rsquo;s canonicalisations are allowed and a change in meaning is not — and
          a feature added to one surface and forgotten in the other turns the suite red instead of
          drifting.
        </P>
        <Sub id="wapy-live" title="Editable, and running here">
          <InlineDemo initialCode={EX_WAPY_LIVE} surface="wapy" />
        </Sub>
        <Sub id="mixed" title="Mixed freely, in one program">
          <Pair leftLabel="stats.wac" rightLabel="report.wapy" left={EX_MIXED_WAC} right={EX_MIXED_WAPY} rightLang="wapy" />
        </Sub>
      </Section>

      <Section id="bindgen" kicker="the boundary" title="TypeScript bindgen">
        <P>
          The generator produces a self-contained {m({ children: ".ts" })} file with the wasm
          base64-encoded inline and typed wrappers around it. Zero runtime dependencies; primitive
          arrays marshal between JavaScript typed arrays and WasmGC arrays.
        </P>
        <Pair leftLabel="wac source" rightLabel="generated typescript" left={EX_ARRAYS} right={EX_BINDGEN} rightLang="ts" />
      </Section>

      <Section id="wasm-gaps" kicker="the other direction" title="What WebAssembly is missing">
        <P>
          Writing {Math.round(TOTALS.lines / 1000)},000 lines of byte-heavy systems code against WasmGC — TLS, SSH, Tor, gzip,
          Zstandard, BLS12-381, SHA-2, ChaCha20 — with no C runtime underneath and no linear memory
          in the artifact turns up gaps that are hard to see from anywhere else. The languages that
          usually report on WasmGC bring Java, Kotlin, Dart and Scheme; none of them is parsing a
          wire protocol out of a GC array.
        </P>
        <P>
          <Lead>GC arrays are read one element at a time.</Lead> There is no way to read four bytes
          of an {m({ children: "(array i8)" })} as an {m({ children: "i32" })}, so every word of
          every SHA-2 block, TLS record header and Tor cell costs about ten instructions where a
          load is one:
        </P>
        <Code label="packages/crypto/src/layout.wac" code={EX_BEWORD} />
        <P>
          <Lead>No SIMD that a GC-array codec can use</Lead> — wasm&rsquo;s vector instructions
          address linear memory, so getting a {m({ children: "v128" })} out of a GC array costs
          about as much as the vector operation saves.{" "}
          <Lead>Ten MVP integer instructions are unreachable</Lead> from the language, including{" "}
          {m({ children: "i32.rotl" })}, which is three quarters of every add-rotate-xor cipher.{" "}
          <Lead>No widening multiply and no add-with-carry</Lead>, so arbitrary-precision arithmetic
          — and therefore BLS12-381 — works in 32-bit limbs. And <Lead>nothing runs when a trap
          unwinds</Lead>, so there is no way to release anything on the way out.
        </P>
        <P>
          <Lead>And there is no byte swap.</Lead> Wasm loads are little-endian and most wire
          protocols are big-endian — TLS, SSH, Tor, and SHA-1 and SHA-2&rsquo;s message schedule —
          so even with linear memory a big-endian word is a load plus a hand-rolled six-operation
          swap. That one inverted a conclusion in our own design document: SHA-256 looked like the
          obvious motivating example for linear memory and turned out to be among the weakest,
          because the swap eats the gain, while a little-endian format like ChaCha20 or Zstandard
          would gain a lot.
        </P>
        <P>
          Every entry is marked <em>verified</em>, <em>believed</em> or <em>speculative</em>, and
          the distinction is load-bearing rather than decorative. Integer rotate sat on the list as
          a missing instruction until somebody checked:{" "}
          <Lead>{m({ children: "i32.rotl" })} has existed since 2017, and it was wac that had no
          way to spell it.</Lead> A list of things another project should fix is worth exactly what
          its worst entry is worth.
        </P>
        <P>
          Each of those is an issue in the repository with a measurement attached rather than a
          complaint:{" "}
          <A href={`${TREE}/issues/lang/open`} external>the open list</A>, and{" "}
          <A href={`${BLOB}/WASM-WISHLIST.md`} external>the wishlist</A> with the
          numbers.
        </P>
      </Section>
    </Page>
  );
}
