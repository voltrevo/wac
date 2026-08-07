// The language itself: how it reads, the two surfaces, the boundary, and where WebAssembly
// itself runs out.
//
// Split out of the front page, which was a dozen screens of everything at once. What stayed on the
// front page is the claim; this is the evidence for the part of it about the language.

import InlineDemo from "./editor/InlineDemo";
import { CodeBlock, fn_, GITHUB, hl, kw, MONO, op, s, SideBySide, Solo, tp } from "./theme";
import { Page } from "./chrome";


// Enums and generics: the two features the tour did not have and the tagline did not mention.
// Both compile and run in the browser through `InlineDemo`, and both were run through `wacx`
// before being put here — the generic one twice, because `Pair.of(x, y)` in a return position
// has nothing to infer the type argument from and the spec's form is a typed declaration.
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
} from "./snippets";


export default function Language() {
  return (
    <Page current="language">
      <div style={s.section}>
        <h2 style={s.h2} id="tour">Language tour</h2>

        <h3 style={s.h3} id="hello">Hello world</h3>
        <p style={s.p}>
          Functions have explicit return types. {kw("export")} makes them
          available to the host and other {tp(".wac")} files.
        </p>
        <InlineDemo initialCode={EX_HELLO} />

        <h3 style={s.h3} id="primitives">Primitives and control flow</h3>
        <p style={s.p}>
          Types: {tp("i32")} {tp("i64")} {tp("f32")} {tp("f64")} {tp("bool")} {tp("string")}.
          Full control flow: {kw("if")}/{kw("else")}, {kw("while")}, {kw("for")}, {kw("do")}-{kw("while")}, {kw("switch")}, ternary.
        </p>
        <InlineDemo initialCode={EX_MATH} />

        <h3 style={s.h3} id="errors">Error diagnostics</h3>
        <p style={s.p}>
          No implicit conversions — write {fn_("while (b != 0)")} not {fn_("while (b)")}.
          Try it — the code block above is editable! The compiler tells you
          exactly what went wrong:
        </p>
        <Solo code={EX_ERROR} lang="wac" />

        <h3 style={s.h3} id="structs">Structs and methods</h3>
        <p style={s.p}>
          Structs compile to WasmGC struct types. Methods use {kw("this")} (mutable)
          or {kw("const")} {kw("this")} (readonly). Static methods omit {kw("this")}.
        </p>
        <Solo code={EX_STRUCT} lang="wac" />

        <h3 style={s.h3} id="nullable">Nullable references</h3>
        <p style={s.p}>
          {op("?")} makes a type nullable. {op("!")} unwraps (traps on null).
          Test with {kw("is")} {kw("null")} / {kw("is")} {kw("not")} {kw("null")}.
        </p>
        <Solo code={EX_NULLABLE} lang="wac" />

        <h3 style={s.h3} id="enums">Enums carry payloads, and match is exhaustive</h3>
        <p style={s.p}>
          A variant may hold values, and {kw("match")} over one must cover every case — a missing
          arm is a compile error, not a fallthrough. Generic enums give you {tp("Option<T>")} and{" "}
          {tp("Result<T, E>")}, which is where wac-mono's standard library starts.
        </p>
        <InlineDemo initialCode={EX_ENUM} />

        <h3 style={s.h3} id="generics">Generics, monomorphised</h3>
        <p style={s.p}>
          A struct may take type parameters. {tp("Pair<i32>")} and {tp("Pair<string>")} are
          separate types the compiler stamps out — no boxing, and nothing erased, so a{" "}
          {tp("Vec<i32>")} holds machine integers.
        </p>
        <InlineDemo initialCode={EX_GENERIC} />

        <h3 style={s.h3} id="arrays">Arrays</h3>
        <p style={s.p}>
          GC-managed arrays with {fn_(".len()")} and bounds checking.
          Construct with {tp("i32[5]()")} (sized) or {tp("i32[](1,2,3)")} (fixed).
        </p>
        <Solo code={EX_ARRAYS} lang="wac" />

        <h3 style={s.h3} id="imports">Multi-file imports</h3>
        <p style={s.p}>
          File-based imports with {kw("import")} / {kw("from")}. Diamond
          imports resolve correctly. Rename with {kw("as")} to avoid collisions.
        </p>
        <SideBySide
          leftLabel="main.wac" rightLabel="math.wac"
          left={EX_IMPORTS_MAIN} right={EX_IMPORTS_MATH}
          leftLang="wac" rightLang="wac"
        />

        <h3 style={s.h3} id="core">One import is not a file</h3>
        <p style={s.p}>
          {kw("core")} ships inside the compiler, so it is written without quotes — there is no path
          to be right or wrong about, and it cannot be pointed anywhere else. It holds one enum, and
          the bar for a second is high.
        </p>
        <SideBySide
          leftLabel="main.wac" rightLabel="report.wac"
          left={EX_CORE_MAIN} right={EX_CORE_LIB}
          leftLang="wac" rightLang="wac"
        />
        <p style={s.p}>
          Those two files never mention each other, and neither declares {tp("Read")}. That matters
          because wac has <em>nominal</em> types and no closures: two identical declarations are two
          types, and there is nothing you could write to convert between them. Within one project
          that costs nothing — both sides import the same file. Across two published libraries it is
          fatal, so a streaming transform that names {tp("fn[Read()]")} could never be handed a
          reader built anywhere else.
        </p>
        <p style={s.p}>
          Hence the rule for what goes in {kw("core")}, which is a test rather than a taste:{" "}
          <strong style={{ color: "#e2e8f0" }}>must this type cross a repository boundary through a
          function reference?</strong> Containers and sum types do not — they live in a package, and
          a copy in each project is duplication rather than a wall. Today {tp("Read")} is the only
          thing that qualifies.
        </p>

        <p style={s.p}>
          Also: four cast modes ({op("as")} lossless, {op("as!")} checked, {op("as~")} lossy, {op("as@")} raw),
          struct subtyping via {kw("struct")} {tp("Rect")} : {tp("Shape")},
          and function references ({tp("fn[i32(i32, i32)]")}).
        </p>
      </div>

      {/* Two surfaces. New since the last time this page was written, and the thing most likely
          to be misread as a transpiler — hence the byte-identity claim, which is the shortest
          way to say that it is not one. */}

      <div style={s.section}>
        <h2 style={s.h2} id="surfaces">Two surfaces, one language</h2>
        <p style={s.p}>
          The same language can be written with braces or with indentation. {tp(".wapy")} is the
          second surface — {kw("def")}, {kw("class")}, {kw("and")}/{kw("or")}/{kw("not")},{" "}
          {kw("None")}, {kw("self")} — and it is <strong style={{ color: "#e2e8f0" }}>not
          Python</strong>: it does not accept Python, and copying Python into it is an explicit
          anti-goal. It borrows the shapes, not the semantics.
        </p>
        <SideBySide
          leftLabel="hist.wac" rightLabel="hist.wapy"
          left={EX_SURFACE_WAC} right={EX_SURFACE_WAPY}
          leftLang="wac" rightLang="wapy"
        />
        <p style={s.p}>
          These two files compile to <strong style={{ color: "#e2e8f0" }}>byte-identical
          wasm</strong>. Not the same behaviour — the same bytes. There is no transpilation step
          and no generated intermediate: {tp(".wapy")} has its own lexer and parser producing the
          same syntax tree, so a diagnostic names the line its author wrote, and the resolver,
          checker and emitter never learn which surface ran.
        </p>

        <h3 style={s.h3} id="wapy-live">Editable, and running here</h3>
        <p style={s.p}>
          Compiled in this tab by the same {fn_("wacCompile")} call as every other demo on the
          page. The extension is what selects the frontend, so the only thing that differs is
          the file&rsquo;s name.
        </p>
        <InlineDemo initialCode={EX_WAPY_LIVE} surface="wapy" />

        <h3 style={s.h3} id="mixed">Mixed freely, in one program</h3>
        <p style={s.p}>
          Neither surface is privileged, so an import graph may cross between them as often as it
          likes. Here a {tp(".wac")} file imports a class from a {tp(".wapy")} file, and a{" "}
          {tp(".wapy")} file imports a function from that {tp(".wac")} file.
        </p>
        <SideBySide
          leftLabel="stats.wac" rightLabel="report.wapy"
          left={EX_MIXED_WAC} right={EX_MIXED_WAPY}
          leftLang="wac" rightLang="wapy"
        />
        <p style={s.p}>
          wac stays the canonical form, which is a statement about documentation rather than about
          the compiler: the spec is written in it, and the converter runs in that direction so
          that <a href={`${GITHUB}/blob/master/atoms/wac/wapyRoundTrip.test.ts`} target="_blank"
          rel="noopener" style={{ color: "#2dd4bf" }}>a test</a> can convert all 50,000 lines of
          wac-mono and check that parsing the result gives back the identical syntax tree.
        </p>
      </div>

      {/* Bindgen */}
      <div style={s.section}>
        <h2 style={s.h2} id="bindgen">TypeScript bindgen</h2>
        <p style={s.p}>
          {fn_("wacBindgen")} produces a self-contained {tp(".ts")} file
          with the wasm binary base64-encoded inline and typed wrapper functions.
          Zero runtime dependencies. Primitive arrays automatically marshal between
          JS typed arrays and WasmGC arrays.
        </p>
        <SideBySide
          leftLabel="wac source" rightLabel="generated typescript"
          left={EX_ARRAYS} right={EX_BINDGEN}
          leftLang="wac" rightLang="ts"
        />
      </div>

      {/* What WebAssembly is missing. Evidence collected from writing 50,000 lines against it,
          which is a thing this project has and most WasmGC users do not — the languages with GC
          arrays are not parsing wire protocols with them. */}
      <div style={s.section}>
        <h2 style={s.h2} id="wasm-gaps">What WebAssembly is missing</h2>
        <p style={s.p}>
          Writing 50,000 lines of byte-heavy systems code against WasmGC — TLS, SSH, Tor, gzip,
          Zstandard, BLS12-381, SHA-2, ChaCha20 — with no C runtime underneath and no linear
          memory in the artifact turns up gaps that are hard to see from anywhere else. The
          languages that report WasmGC&rsquo;s rough edges bring Java, Kotlin, Dart and Scheme,
          where the arrays hold references and the hot loops are dispatch. The languages that
          report linear memory&rsquo;s rough edges bring C, C++ and Rust, which never touch a GC
          array at all.
        </p>
        <p style={s.p}>
          {" "}
          <a href={`${GITHUB}/blob/master/WASM-WISHLIST.md`} target="_blank" rel="noopener"
             style={{ color: "#2dd4bf" }}>WASM-WISHLIST.md</a>{" "}
          is the running list: each entry is something this project wanted and could not have,
          with the code that works around it and what the workaround costs. Entries are marked
          verified, believed or speculative, and the distinction is load-bearing — integer rotate
          looked like a missing instruction until someone checked and found {fn_("i32.rotl")} has
          existed since 2017 and it was wac that had no way to spell it.
        </p>
        <ul style={s.ul}>
          <li>
            <strong style={{ color: "#e2e8f0" }}>Nothing copies between a GC array and linear
            memory.</strong> {fn_("array.copy")} takes two array type indices, {fn_("memory.copy")}{" "}
            takes two memory operands, and there is no instruction with one of each. Assembling one{" "}
            {tp("v128")} from a GC array costs 32 instructions — as much as the vector operation
            saves.
          </li>
          <li>
            <strong style={{ color: "#e2e8f0" }}>GC arrays are read one element at a time.</strong>{" "}
            No way to read four bytes of an {tp("(array i8)")} as an {tp("i32")}, so every word of
            every SHA-2 block, TLS record header and Tor cell costs about ten instructions where a{" "}
            {fn_("i32.load")} is one:
          </li>
        </ul>
        <Solo code={EX_BEWORD} lang="wac" />
        <ul style={s.ul}>
          <li>
            <strong style={{ color: "#e2e8f0" }}>There is no byte swap.</strong> Wasm loads are
            little-endian and most wire protocols are big-endian. This one inverted a conclusion in
            our own design work: SHA-256 looked like the obvious argument for linear memory and
            turned out to be among the weakest, because the swap eats the gain.
          </li>
          <li>
            <strong style={{ color: "#e2e8f0" }}>SIMD has no lane rotate.</strong> Scalar wasm has
            had {fn_("i32.rotl")} since the MVP. Every vector rotate is three instructions, which
            is 12 of the 20 in a vectorised ChaCha20 half-round — and add-rotate-xor is the shape
            of ChaCha20, Salsa20, BLAKE2, BLAKE3, SHA-1, SHA-2 and Keccak alike.
          </li>
          <li>
            <strong style={{ color: "#e2e8f0" }}>No widening multiply, no add-with-carry.</strong>{" "}
            {fn_("i64.mul")} gives the low 64 bits of a 128-bit product and there is no way to ask
            for the high half, so arbitrary-precision arithmetic — and therefore BLS12-381 — works
            in 32-bit limbs.
          </li>
          <li>
            <strong style={{ color: "#e2e8f0" }}>Nothing runs when a trap unwinds.</strong> A trap
            goes straight to the host, so there is no way to release anything on the way out.
          </li>
        </ul>
        <p style={{ ...s.p, marginBottom: 0 }}>
          Four more, with the measurements, in the document.
        </p>
      </div>
    </Page>
  );
}
