// The front page.
//
// It leads with the language, because that is where everything here started and because a reader
// who does not believe the language is good will not believe anything built in it. Then it turns,
// deliberately and early, to the thing that makes this unlike other language sites: the stack is
// being rebuilt in it, and the rebuild is far enough along to be checked against the software it
// has to interoperate with.
//
// Written for somebody who has seen a lot of language sites and assumes there is nothing behind
// them. That reader is not moved by adjectives; they are moved by a number they can go and verify
// and by the name of the implementation that disagreed with us and lost. So: no superlatives, every
// claim with its oracle attached, and the disclaimers left exactly where they are.

import InlineDemo from "../editor/InlineDemo";
import { TOTALS } from "../data/built";
import { A, Code, Facts, Lead, m, n, P, PAGES, Page, Section, Table, Wordmark } from "./ui";
import { c, font, space } from "./tokens";

// A whole program: a struct with a method, an array, a loop, and an export the reader can call.
// Compiled in their tab by the same `wacCompile` the playground uses.
const EX_FRONT = `export struct Histogram {
  i32[] bins;

  /// A histogram with \`n\` empty bins.
  Histogram of(i32 n) { return Histogram(i32[n]()); }

  void add(this, i32 v) {
    this.bins[v % this.bins.len()]++;
  }

  i32 peak(const this) {
    i32 best = 0;
    for (i32 i = 0; i < this.bins.len(); i++) {
      if (this.bins[i] > best) { best = this.bins[i]; }
    }
    return best;
  }
}

export i32 busiest(i32[] hours) {
  Histogram h = Histogram.of(24);
  for (i32 i = 0; i < hours.len(); i++) { h.add(hours[i]); }
  return h.peak();
}`;

/** The capability signature of a whole application — the argument for what "no ambient" buys. */
const EX_MAIN = `// packages/platform/example/wc.wac — the whole program's authority, in one line
export i32 main(Core core, Cli cli) { … }`;

const STACK: [string, string, string][] = [
  ["TLS 1.3", "client and server, X25519MLKEM768", "interoperates with OpenSSL and rustls"],
  ["Tor", "client, relay, directory authority, onion services", "a C tor bootstraps from our authority and carries a stream through our relays"],
  ["SSH-2", "client and server", "OpenSSH's own client cannot tell the difference"],
  ["a shell", "quoting, expansion, here-docs, pipelines, functions", "652 scripts agree with GNU bash on stdout and exit status"],
  ["60 applets", "cat, grep, sort, gzip, tar, diff, sha256sum, httpd, nc", "differential against the GNU tool where one exists"],
  ["Ethereum", "BLS12-381, SSZ, an Altair light client, RLP, ABI, state proofs", "2,233 vectors from consensus-spec-tests, all 29 BLS verify fixtures"],
  ["compression", "gzip, DEFLATE, Zstandard", "at or under the reference tools; zlib accepts the output"],
  ["a compiler", "wac's own lexer and parser, ported to wac", "agrees with the reference on every .wac file in the repo"],
];

export default function Home() {
  return (
    <Page current="home">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: space.section, marginTop: -18 }}>
        <div style={{ marginBottom: 22 }}><Wordmark size={64} /></div>
        <h1 style={{ fontFamily: font.mono, fontSize: 31, lineHeight: 1.35, fontWeight: 600, color: c.text, margin: `0 0 22px`, letterSpacing: "-0.02em" }}>
          A C-family language for WebAssembly GC —<br />
          <span style={{ color: c.accent }}>and a systems stack being rebuilt in it.</span>
        </h1>
        <P>
          Structs, methods, subtyping, generics, enums with payloads, nullable references — and
          WebAssembly&rsquo;s own collector owns the heap, so there is no allocator to write and no
          linear memory in the artifact. The compiler is TypeScript with{" "}
          <Lead>no dependencies</Lead>: no LLVM, no binaryen, nothing to install. It runs in a
          browser tab, which is how the editor below compiles.
        </P>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 34 }}>
          <a href="#/playground" style={{ background: c.accent, color: "#06231f", padding: "10px 18px", borderRadius: 5, fontFamily: font.mono, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            Playground
          </a>
          <a href="../shell.html" style={{ border: `1px solid ${c.lineBright}`, color: c.text, padding: "10px 18px", borderRadius: 5, fontFamily: font.mono, fontSize: 14, textDecoration: "none" }}>
            A shell in your browser →
          </a>
          <a href="#/stack" style={{ border: `1px solid ${c.lineBright}`, color: c.text, padding: "10px 18px", borderRadius: 5, fontFamily: font.mono, fontSize: 14, textDecoration: "none" }}>
            What is built in it →
          </a>
        </div>
      </div>

      {/* ── The language, running ────────────────────────────────────────── */}
      <Section id="try" kicker="the language" title="Edit it, and press run">
        <P>
          This compiles here — not on a server, and not ahead of time. Every demo on this site is
          the same pipeline the command line uses — ~16,000 lines of dependency-free TypeScript — running on this page.
        </P>
        <InlineDemo initialCode={EX_FRONT} />
        <div style={{ height: space.block }} />
        <P>
          Three properties matter more than the feature list, and each one is the reason something
          further down this page was possible.{" "}
          <Lead>The collector owns the heap</Lead> — no allocator, no free, no linear memory, so a
          buffer overrun is not a thing the language can express.{" "}
          <Lead>Types are nominal and there are no closures</Lead>, which costs a little at every
          seam and buys the property that a value cannot be quietly converted into something it is
          not. And <Lead>an import names a wac file and nothing else</Lead>:
        </P>
        <Code label="the entire authority of a program that reads files and prints" code={EX_MAIN} />
        <P>
          There is no {m({ children: "extern" })}, no declaration form, no way to write down the
          name of a function outside the program. So a module that takes no function parameter has{" "}
          <Lead>no wasm imports at all</Lead> — not "none that it uses", none in the binary — and
          the parameters of {m({ children: "main" })} are the complete list of what an application
          may do. Most sandboxes are a list of things taken away. This is the other direction:
          nothing is there until something hands it over.
        </P>
      </Section>

      {/* ── The turn ─────────────────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: space.section - 24, marginBottom: space.section }}>
        <Section id="stack" kicker="and then" title="We are rebuilding the stack in it">
          <P>
            A language is an argument until somebody finishes something in it. So the point of this
            project is not the tour above — it is the{" "}
            <Lead>{TOTALS.packages} packages and {Math.round(TOTALS.lines / 1000)},000 lines of wac</Lead>{" "}
            underneath, with <Lead>no C, no libc, no runtime library and no third-party code of any
            kind</Lead> in any of them. Not bindings to someone else&rsquo;s TLS. Not a wrapper
            around a Tor daemon. The bytes on the wire are produced by wac.
          </P>
          <Table
            head={["what", "how far", "what says so"]}
            rows={STACK.map(([what, far, oracle]) => [
              <span style={{ fontFamily: font.mono, whiteSpace: "nowrap" }}>{what}</span>,
              far,
              <span style={{ color: c.dim }}>{oracle}</span>,
            ])}
          />
          <P>
            That last column is the point of the whole table, and the next section is about why.
          </P>
          <Facts
            rows={[
              ["packages", String(TOTALS.packages)],
              ["lines of wac", `${Math.round(TOTALS.lines / 1000)}k`],
              ["tests", `~${Math.round(TOTALS.testsAll / 100) * 100}`],
              ["programs", String(TOTALS.programs)],
              ["dependencies", "0"],
              ["TypeScript in them", "0"],
            ]}
          />
          <P>
            <A href="#/stack">What each of those is, and how far it actually goes →</A>
          </P>
        </Section>
      </div>

      {/* ── The method, in one paragraph and a link ──────────────────────── */}
      <Section id="checked" kicker="how this is checked" title="We do not grade our own homework">
        <P>
          A test suite written by the same people as the code is a check on internal consistency and
          almost nothing else. So the rule, everywhere it is possible:{" "}
          <Lead>the oracle is somebody else&rsquo;s implementation</Lead> — OpenSSL and rustls,
          a real C tor, OpenSSH, GNU bash, zlib — and where there is no implementation to ask, a
          published vector nobody here produced.
        </P>
        <P>
          There are five more kinds of evidence under that one, including a state-space walk over
          every interleaving rather than a thousand random runs, and a trace that tells you which
          two routines leak a secret and at which lines.{" "}
          <A href="#/checked">All six, ordered by how much they are worth →</A>
        </P>
      </Section>

      {/* ── The live proof ───────────────────────────────────────────────── */}
      <Section id="run" kicker="or stop reading" title="Run it, in this tab">
        <P>
          A shell — {m({ children: "packages/sh" })} itself, with the sixty applets as commands —
          compiled to wasm, on a worker, talking to a capability world on the page&rsquo;s thread.
          It is the artifact {m({ children: "app:build --target browser" })} produces, copied
          unmodified. <A href="#/run">That, a hasher and a Mandelbrot set →</A>
        </P>
      </Section>

      {/* ── Where to go ──────────────────────────────────────────────────── */}
      <Section id="more" kicker="the rest" title="Where to go">
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", marginBottom: space.block }}>
          {PAGES.map(({ href, label, blurb }) => (
            <a key={href} href={href} style={{ display: "block", border: `1px solid ${c.line}`, borderRadius: 6, padding: "16px 18px", textDecoration: "none", background: c.panel }}>
              <div style={{ fontFamily: font.mono, fontSize: 15, color: c.accent, marginBottom: 7 }}>{label} →</div>
              <div style={{ color: c.dim, fontSize: 14, lineHeight: 1.55 }}>{blurb}</div>
            </a>
          ))}
        </div>
        <P>
          <span style={{ color: c.dim, fontSize: 15 }}>
            One note on how this is possible at all, since it is a fair question at this size and
            pace: the work is done by AI agents, with a human deciding what is worth building and
            what a claim has to survive before it goes on a page like this one. That is worth saying
            once, and it is secondary — the reason to look is the code and what it agrees with, both
            of which are linked from every claim above.
          </span>
        </P>
      </Section>
    </Page>
  );
}
