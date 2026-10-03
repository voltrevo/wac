// The language: how it reads, the boundary, and where WebAssembly runs out.
//
// The snippets are carried over unchanged from the page this replaces — they are checked by
// `site/tools/site.test.ts`, which compiles them, so
// editing them here without editing that would be the drift the test exists to catch.

import InlineDemo from "../editor/InlineDemo";
import { TOTALS } from "../data/built";
import { TREE, BLOB, A, Code, Lead, m, P, Page, Pair, Section, Sub } from "./ui";
import { c, font, space } from "./tokens";

const GITHUB = "https://github.com/voltrevo/wac";



import {
  EX_ENUM,
  EX_GENERIC,
  EX_BEWORD,
  EX_HELLO,
  EX_MATH,
  EX_ERROR,
  EX_STRUCT,
  EX_CONST,
  EX_UNION,
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
        <P>
          This is the short version. The long one is <A href="#/spec">the specification</A>:
          forty-nine chapters whose examples are programs, each one compiled against the compiler in
          the tree, with the answer it must give written above it.
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
            {m({ children: "i8 i16 i32 i64" })}, their unsigned twins{" "}
            {m({ children: "u8 u16 u32 u64" })}, {m({ children: "f32 f64 bool" })}, and{" "}
            {m({ children: "string" })} as a reference type. Full control flow: {m({ children: "if" })}/
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
            Methods take an explicit receiver and reach their fields through it —{" "}
            {m({ children: "this.x" })}, always; a bare field name is not in scope.{" "}
            {m({ children: "const this" })} forbids mutating anything reachable through it — deeply,
            not one level.
          </P>
          <InlineDemo initialCode={EX_STRUCT} />
        </Sub>

        <Sub id="const" title="Const is part of the type">
          <P>
            {m({ children: "const" })} at the front of a declaration applies throughout: the name
            cannot be rebound, and nothing can be written through the reference, at any depth. It
            travels with the reference — read out of a field, returned from a method, handed to a
            parameter — and no binding of a plain type can hold it again.
          </P>
          <P>
            Parentheses move the name outside it. {m({ children: "(const Counter) latest" })} can be
            rebound, and whatever it holds is still read-only. That is the form a cursor walking a
            const list is written in.
          </P>
          <InlineDemo initialCode={EX_CONST} />
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

        <Sub id="unions" title="Unions take apart by type">
          <P>
            {m({ children: "union<f64, string, bool>" })} holds a value of any one of its members,
            with no constructor to call: a member is a union value as it is. A{" "}
            {m({ children: "match" })} on it has one arm per member type, the subject has that type
            inside the arm, and leaving a member out is a compile error.
          </P>
          <InlineDemo initialCode={EX_UNION} />
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
            GC arrays, bounds-checked, with {m({ children: "[1, 2, 3]" })} for a literal and{" "}
            {m({ children: "i32[].filled(5, 0)" })} for a sized one. A growable one is{" "}
            {m({ children: "Vec<T>" })}, read with {m({ children: ".get(i)" })} — indexing with
            brackets is for arrays.
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
            {m({ children: "core" })} ships inside the compiler, so it is a name rather than a path —
            there is no file to be right or wrong about, and it cannot be pointed anywhere else.
          </P>
          <Pair leftLabel="main.wac" rightLabel="report.wac" left={EX_CORE_MAIN} right={EX_CORE_LIB} />
          <P>
            Those two files never mention each other, and neither declares{" "}
            {m({ children: "Read" })}. That matters because wac has <em>nominal</em> types and no
            closures: two identical declarations are two types, and nothing can convert between
            them. Within one project that costs nothing. Across two published libraries it is fatal
            — so a streaming transform naming {m({ children: "fn<Read()>" })} could never be handed
            a reader built anywhere else.
          </P>
          <P>
            Hence the rule for what goes in {m({ children: "core" })}, which is a test rather than a
            taste: <Lead>must this type cross a repository boundary through a function
            reference?</Lead> {m({ children: "Read" })} was the first thing to qualify. The markup
            tree and the conversion symbols followed for the same reason, and the containers —{" "}
            {m({ children: "Vec" })}, {m({ children: "Map" })}, {m({ children: "Option" })},{" "}
            {m({ children: "Result" })} — for a weaker one: a program that wants a map should not
            have to find a package first. Nothing in {m({ children: "core" })} holds a capability,
            so importing it reaches nothing outside the program.
          </P>
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
