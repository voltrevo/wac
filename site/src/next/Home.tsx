// The front page.
//
// The sequence, settled over several mockups with the operator: the wordmark, one sentence, then
// *the shell* — a real one, running here — then the honesty about what it is not yet, then one
// editable program, then Tor, Ethereum, and every package.
//
// The shell comes before the code on purpose. A reader who has seen a hundred language sites is not
// moved by a tour; they are moved by typing into something that could not exist unless the claims
// were true. And it is introduced as *wacland* rather than as a demo, because the point is not that
// a terminal is on the page — it is that the shell, the applets and the filesystem are all wac.
//
// Written for somebody who assumes there is nothing behind a language site: no superlatives, every
// number checkable, and the unflattering parts kept.

import { useEffect, useState } from "react";
import InlineDemo from "../editor/InlineDemo";
import { BUILT, TOTALS } from "../data/built";
import { TREE, A, Caveat, Code, Facts, Lead, m, P, Page, Section, Table } from "./ui";
import { ASSETS, c, font, space } from "./tokens";

/**
 * The commands the terminal shows, and what they print.
 *
 * Hardcoded, because a page cannot run a shell to render itself — but the repository's
 * `tools/frontpage.test.ts` runs these exact lines through `packages/box/example/boxsh.wac` and
 * fails if the output ever stops matching. So this is a claim with a test behind it rather than a
 * plausible-looking screenshot.
 */
/**
 * The bootstrap, as the suite reports it — `packages/wacc/test/selfHostEmit.test.ts`.
 *
 * Stage A is wacc built by the TypeScript compiler, B is wacc built by A, and C is what B produces
 * when asked to compile wacc. B and C being the same bytes is the whole claim, and the byte count
 * is that test's own output rather than a number typed here.
 */
const BOOTSTRAP = `stage A   wacc, built by the TypeScript compiler
stage B   wacc, built by stage A
stage C   wacc, as stage B compiles it

B == C    11 sources, 266,818 bytes, identical`;

export const TRANSCRIPT: [string, string][] = [
  ["seq 1 20 | grep 7 | wc -l", "2"],
  ["echo 'a whole new stack' | gzip -c | wc -c", "41"],
  ["echo hello | sha256sum", "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  -"],
];

/**
 * One program, compiled and run through `wacx` before it was put here.
 *
 * `main` first and the enum after it, because a file is a set of declarations rather than a
 * sequence of them — and because the point of the example is what it does, not its vocabulary. The
 * commented line is the invitation: swapping the markers gives `Hello, Alice and Bob!`.
 */
const EX_HELLO = `export string main() {
  Option<string> name = Option.None;
  // Option<string> name = Option.Some("Alice and Bob");

  return "Hello, " + match (name) {
    case Some(v): v,
    case None: "world"
  } + "!";
}

/// A value that might not be there. Declared after it is used — wac has no
/// forward declarations, because a file is a set of declarations rather than
/// a sequence of them.
enum Option<T> {
  Some(T value),
  None
}`;



/**
 * Whether the browser demos are built beside this page.
 *
 * `site/tools/syncDemos.ts` writes them into `site/public/`, and CI runs it — but a plain
 * checkout has none, and a dev server answers a missing `shell.html` with `index.html`, which
 * renders the entire site inside the iframe. `demos.json` is written next to them, so its presence
 * is the honest signal, and its absence gets a link instead of a nested copy of this page.
 */
function useDemosBuilt(): boolean {
  const [built, setBuilt] = useState(false);
  useEffect(() => {
    let live = true;
    // `r.ok` is not the test: a dev server answers a missing path with `index.html`, so the fetch
    // succeeds and the iframe renders the whole site inside itself. Only JSON that parses means the
    // demos are really there.
    fetch(`${ASSETS}demos.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no demos"))))
      .then(() => { if (live) setBuilt(true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return built;
}

export default function Home() {
  const demosBuilt = useDemosBuilt();
  return (
    <Page current="home" contents={false}>
      {/* ── The wordmark, as a prompt ─────────────────────────────────────
          The gradient is spent here and nowhere else on the page; the rule beside it is solid, so
          the two do not compete. `clamp` reaches its cap by about 620px, because keying the middle
          term to the viewport made the heading *smaller* than the fixed size it replaced at every
          width below a wide desktop. */}
      <div style={{ display: "flex", gap: 22, alignItems: "stretch", marginBottom: 66, marginTop: 4 }}>
        <div style={{ width: 2, borderRadius: 2, flex: "none", background: c.text, opacity: 0.85 }} />
        <div>
          <h1
            style={{
              margin: 0, fontFamily: font.mono, fontWeight: 700, letterSpacing: "-0.04em",
              lineHeight: 0.95, fontSize: "clamp(56px, 18vw, 112px)",
            }}
          >
            <span style={{ color: c.faint, fontWeight: 400 }}>$</span>{" "}
            <span
              style={{
                background: "linear-gradient(104deg, #5eead4 2%, #67e8f9 26%, #818cf8 58%, #c084fc 86%)",
                WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
              }}
            >
              wac
            </span>
            <span style={{ color: c.accent }}>_</span>
          </h1>
          {/* One sentence, left to wrap where it must. Forcing a break after the em dash put it on
              two lines even where one fitted; the non-breaking spaces only stop the two places a
              natural break reads as a mistake. */}
          <p style={{ margin: "16px 0 0", maxWidth: "62ch", color: c.body, fontSize: "clamp(16px, 3.4vw, 20px)", lineHeight: 1.5, textWrap: "balance" }}>
            A C-family language for WebAssembly&nbsp;GC — and a whole new stack written&nbsp;in&nbsp;it.
          </p>
        </div>
      </div>

      {/* ── The shell ─────────────────────────────────────────────────────── */}
      <Section id="wacland" kicker="start here" title="Meet wacland: userland written in wac">
        <P>
          A shell, {TOTALS.applets} applets and a filesystem, running on a worker in this tab — and{" "}
          <Lead>all of it is wac</Lead>. Not busybox compiled to wasm, not a libc port, not wac glue
          around somebody else&rsquo;s binaries: it is {m({ children: "packages/sh" })} itself, the
          same program that runs on a command line, and the only thing underneath it is the compiler.
        </P>

        {/* The real thing, in an iframe. It loads in parallel with this page rather than blocking
            it — a separate document never holds up the parent's first paint — and it needs the
            cross-origin isolation headers the service worker installs, which is why it can only be
            embedded from this origin. */}
        <div style={{ border: `1px solid ${c.lineBright}`, borderRadius: 7, overflow: "hidden", background: "#06070a", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 13px", background: c.panelHi, borderBottom: `1px solid ${c.line}`, fontFamily: font.mono, fontSize: 11.5, color: c.faint }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c.lineBright }} />
            ))}
            <span style={{ marginLeft: 6 }}>wacland · in your browser</span>
          </div>
          {demosBuilt
            ? (
              <iframe
                src={`${ASSETS}shell.html`}
                title="A shell written in wac, running in this page"
                style={{ display: "block", width: "100%", height: 340, border: 0, background: "#06070a" }}
              />
            )
            : (
              // No demos in this checkout, so the session is printed rather than run. It is the
              // same list the terminal opens on, and tools/frontpage.test.ts fails if
              // this stops being what the shell answers.
              <div style={{ padding: "18px 16px", fontFamily: font.mono, fontSize: 13, lineHeight: 1.65, color: "#d7dde6" }}>
                <pre style={{ margin: 0, overflowX: "auto" }}>
                  {TRANSCRIPT.map(([cmd, out]) => (
                    <span key={cmd}>
                      <span style={{ color: c.accent }}>$</span> {cmd}
                      {"\n"}
                      {out}
                      {"\n"}
                    </span>
                  ))}
                </pre>
                <div style={{ color: c.faint, marginTop: 12, fontSize: 12 }}>
                  not built in this checkout — site/tools/syncDemos.ts builds it, and CI
                  runs that on every deploy. <A href={`${ASSETS}shell.html`}>open it directly</A>
                </div>
              </div>
            )}
        </div>

        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            Those commands were not typed in for the screenshot — the frame runs them on load, and
            what it prints is this build&rsquo;s own answer. The prompt underneath is live: type
            anything else.
          </span>
        </P>

        <Caveat title="not complete yet">
          Saving, reopening and logging back in all work now — a session&rsquo;s filesystem is a
          file, {m({ children: "sshd -i" })} serves sessions from one, and two keys land in two
          homes where neither can read the other&rsquo;s private file. What is missing is smaller
          and more specific. A spawned stage used to read the machine rather than the session, so
          sealing held only where nothing spawned; it asks its parent now, over a channel, and a
          child&rsquo;s writes are its parent&rsquo;s writes — though turning spawning on is still turning up
          latent leaks, two of them the day this was written, so the sealing is better tested than
          finished. Above it sits the plainer gap:{" "}
          {m({ children: "init" })} starts services and never stops one — signals deliver now, and
          nothing has been wired to use them — and there is no restart policy, no dependency order
          and no readiness, which is the difference between starting services and supervising
          them.
        </Caveat>
        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            {m({ children: "sort" })}, {m({ children: "sha256sum" })}, {m({ children: "gzip" })},{" "}
            {m({ children: "diff" })}, {m({ children: "tar" })}, {m({ children: "nc" })} — with
            pipelines, loops, variables, history, and redirection into a filesystem that survives a
            reload. The shell agrees with GNU bash on <Lead>{TOTALS.corpus} differential scripts</Lead>, on
            standard output and exit status. <A href="#/run">Two more running here →</A>
          </span>
        </P>
      </Section>

      {/* ── The language ──────────────────────────────────────────────────── */}
      <Section id="language" kicker="and this is the language it is written in" title="Edit it, and press run">
        <P>
          Generics are monomorphised, so {m({ children: "Option<T>" })} costs what writing it out by
          hand costs. {m({ children: "match" })} is exhaustive, so the empty case cannot be
          forgotten. This compiles in your tab, by a compiler with no dependencies at all.
        </P>
        <InlineDemo initialCode={EX_HELLO} />
        <div style={{ height: space.block }} />
        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            The collector owns the heap, so there is no allocator to write and no linear memory in
            the artifact. The compiler is <Lead>~16,000 lines of TypeScript</Lead> with no LLVM, no
            binaryen and nothing to install. <A href="#/language">The rest of the language →</A>
          </span>
        </P>
      </Section>

      {/* ── wacc ──────────────────────────────────────────────────────────── */}
      <Section id="wacc" kicker="one of them, in full" title="The compiler, written in wac">
        <P>
          The compiler above is TypeScript. <Lead>It is being replaced by itself.</Lead>{" "}
          {m({ children: "packages/wacc" })} is that compiler written in wac — the lexer, the
          parser, the type checker and the emitter — and the point is not the compiler. A compiler
          is the program shape this language is worst at: syntax trees want sum types, symbol tables
          want generics, everything wants strings. Writing one is how the language finds out what it
          is missing, with a real consumer rather than by argument.
        </P>
        <P>It reaches a fixpoint, which is what a bootstrap means:</P>
        <Code label="wacc compiling itself" lang="text" code={BOOTSTRAP} />
        <P>
          Every rung was checked against the TypeScript compiler before the next was started — token
          streams, syntax trees, then diagnostics at exact positions. The type checker was finished
          against four independent corpora rather than one: a generated sweep of{" "}
          <Lead>10,013 programs with 0 false alarms and 0 contradictions</Lead>, and — newest, and
          the only one written by nobody with this checker in mind — <Lead>the repository&rsquo;s own
          365 files</Lead>, a Tor relay and an SSH server and the compiler itself, with no false
          alarm among them. Broken on purpose — twenty-three ways now, up from seven — it catches{" "}
          <Lead>192 of 195</Lead>.
        </P>
        <P>
          The measurement that matters most is against the specification rather than against the
          other compiler. This page carried the wrong version of it twice: first &ldquo;every
          rejection the spec documents, no exceptions&rdquo;, which was true of a third of the spec
          because the extractor read the test file as text and found 101 of its 304 illegal
          programs; then the honest figure over all of them, which was 277 refused and two legal
          programs wrongly refused. Both are now out of date in the other direction. It refuses{" "}
          <Lead>303 of 304</Lead> and misses one, and of the programs the spec calls legal it is
          silent on <Lead>367 of 367</Lead>. The second number is the one to read: a checker that
          reports less than the specification can be finished, and one that invents a diagnostic
          cannot be trusted at all — and that invariant now holds over the whole of the spec rather
          than the third of it anybody had measured.
        </P>
        <Caveat title="not finished">
          The emitter compiles <Lead>362 of the repository&rsquo;s 365 wac files</Lead> whole, and
          the corpus being the live repository is why that count used to move in both directions —
          code written for other reasons walked in using what the emitter had not reached. It has
          caught up: nothing in the repository is declined any more, and all three files it cannot
          finish block on the same thing, which is not a language feature but an import the harness
          does not supply. None of the 365 produces an invalid module, and — since
          &ldquo;whole&rdquo; was made to mean what it says, by checking every{" "}
          {m({ children: "export" })} a file declares is a function in the module rather than taking
          the emitter&rsquo;s word — none of the 359 is missing one either. That is the
          property that had to hold before a fixpoint meant anything: a walk that approved what the
          emitter cannot emit would reach one on garbage. Everything here is still built with the
          TypeScript compiler today. It is the seed, and the self-hosted one is not yet the compiler
          of record — though its output now runs everything: <Lead>34 of 34 packages pass their own
          test suites on modules wacc emitted</Lead>, 1,663 tests, with {m({ children: "tor" })}
          &rsquo;s 310 among them. It was six not long ago, and what moved it was the bindgen helpers
          that carry values across the boundary, one family at a time. What that does{" "}
          <em>not</em> mean is the interesting part: the harness swaps only the wasm bytes and keeps
          the reference&rsquo;s interface metadata, so a green package says this emitter is right for
          it rather than that wacc produced its bindings. It has a bindgen of its own —{" "}
          {m({ children: "waccx bindgen" })}, which writes the glue and <Lead>names what it
          declined</Lead> rather than emitting a call that will not work. <Lead>And the swap has now
          happened.</Lead> With {m({ children: "WAC_BIND_FROM=wacc" })} beside it the interface
          description and the generator are wacc&rsquo;s too, and every package&rsquo;s own suite
          passes with the reference not in the room at all — it compiles wacc, and nothing else here.
          Two flags rather than one, so that when something breaks it is clear whether the bytes or
          the description was at fault. What is left is not a capability but a default: the build
          still reaches for the reference unless told otherwise.
        </Caveat>
        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            <A href="#/stack/wacc">The ladder, and why the emitter is not checked on its bytes →</A>
          </span>
        </P>
      </Section>

      {/* ── Tor ───────────────────────────────────────────────────────────── */}
      <Section id="tor" kicker="and another" title="Tor">
        <P>
          A client that verifies a consensus and builds circuits; a SOCKS5 proxy; a relay; a
          directory authority; onion services. On this repository&rsquo;s own TLS 1.3, on its own
          crypto, with nothing borrowed from the C implementation but the specification.
        </P>
        <P>
          The strongest evidence is somebody else&rsquo;s client. An unmodified{" "}
          {m({ children: "curl" })}, through our SOCKS proxy, fetching a page from an onion service{" "}
          <em>we host</em>:
        </P>
        <Code
          label="curl, our proxy, our relays, our onion service"
          lang="text"
          code={"$ curl --socks5-hostname 127.0.0.1:9250 http://kybekhk…qqd.onion/\nhello from behind an onion"}
        />
        <P>
          <Lead>And it works the other way round.</Lead> A real C tor bootstraps from our directory
          authority, builds a three-hop circuit through our relays and carries a stream over it —
          reaching <em>Bootstrapped 100%</em> having accepted our descriptor, certificate, vote and
          both consensus flavours through its own parsers. Every component is tracked in both
          directions, and the ones where our code is on both sides are recorded as exactly that
          rather than counted as green.
        </P>
        <Caveat title="not ready to be relied on">
          Try it — that is what it is for. Just do not depend on it yet: <Lead>wac is unstable by
          choice</Lead>, and still breaks its own language when that makes the language better, so
          everything written in it moves with it. None of this has been reviewed by anyone, and
          anonymity is a separate question from correctness that it does not answer yet.
        </Caveat>
        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            <A href="#/stack/tor">What is in it, and what checked each piece →</A>
          </span>
        </P>
      </Section>

      {/* ── Ethereum ──────────────────────────────────────────────────────── */}
      <Section id="ethereum" kicker="and a third" title="Ethereum">
        <P>
          Ask a node who owns a name, or what a balance is, and you believe what it tells you. There
          is no way to check it — you are trusting whoever runs the endpoint, and a wrong answer
          looks exactly like a right one.
        </P>
        <P>
          <Lead>This checks.</Lead> It follows the chain&rsquo;s headers itself and verifies the
          committee signatures on them, so a header it accepts is one that was signed rather than one
          a server asserted. Every answer is then proved against that header: a node returns the
          value <em>and</em> the path through the trie that leads to it, and a value somebody altered
          cannot produce a path that still hashes to the root.
        </P>
        <P>
          Worked all the way through, that is a name resolving without trust — from{" "}
          {m({ children: "vitalik.eth" })} to the registry&rsquo;s storage to the owner recorded
          there, each step proved against a root the light client verified rather than taken on the
          node&rsquo;s word.
        </P>
        <P>
          <span style={{ fontSize: 15, color: c.dim }}>
            What that rests on: an Altair light client (all four sync cases from{" "}
            {m({ children: "consensus-spec-tests" })}), SSZ (2,233 published vectors, including all
            1,131 <em>invalid</em> ones), BLS12-381 verification (all 29 fixtures), keccak256, RLP,
            the contract ABI, and Merkle-Patricia proofs anchored to an{" "}
            {m({ children: "eth_getProof" })} from a real client.
          </span>
        </P>
        <Caveat title="to do">
          No EVM, so no contract calls — and no simulation of a transaction before it is approved. A
          verified resolution stops at ownership and the resolver&rsquo;s address. No signing, so it
          reads the chain and does not write to it. No receipts or logs, so contract events cannot
          arrive as notifications. The light client is Altair on a minimal config and has never
          followed mainnet. Being a full node is not the target: a light client that follows
          consensus, and local execution backed by state proofs.
        </Caveat>
        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            <A href="#/stack/ethereum">The packages under that, and their vectors →</A>
          </span>
        </P>
      </Section>

      {/* ── Everything ────────────────────────────────────────────────────── */}
      <Section
        id="packages"
        kicker="all of it"
        title={`${TOTALS.packages} packages, ${Math.round(TOTALS.lines / 1000)}k lines, no dependencies`}
      >
        <P>
          In dependency order — nothing imports anything above it. No C, no libc, no runtime library,
          and no third-party code in any package&rsquo;s {m({ children: "src/" })}.
        </P>
        <Table
          head={["package", "what it is", "lines", "tests"]}
          align={["left", "left", "right", "right"]}
          rows={[
            ...BUILT.map((p) => [
              <a href={`${TREE}/packages/${p.name}`} target="_blank" rel="noopener" style={{ fontFamily: font.mono, color: c.accent, textDecoration: "none", whiteSpace: "nowrap" }}>{p.name}</a>,
              <span style={{ color: c.dim }}>{p.what}</span>,
              <span style={{ fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>{p.lines.toLocaleString()}</span>,
              <span style={{ fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>{p.tests}</span>,
            ]),
            [
              <span style={{ fontFamily: font.mono, color: c.text }}>total</span>,
              "",
              <span style={{ fontFamily: font.mono, color: c.text, fontVariantNumeric: "tabular-nums" }}>{TOTALS.lines.toLocaleString()}</span>,
              <span style={{ fontFamily: font.mono, color: c.text, fontVariantNumeric: "tabular-nums" }}>{TOTALS.tests.toLocaleString()}</span>,
            ],
          ]}
        />
        <Facts
          rows={[
            ["dependencies", "0"],
            ["TypeScript in them", "0"],
            ["tests, both suites", `~${Math.round(TOTALS.testsAll / 100) * 100}`],
          ]}
        />
        <P>
          <A href="#/checked">How each of those is checked →</A>{" "}
          <span style={{ color: c.dim }}>
            — six kinds of evidence, starting with a foreign implementation on the other end.
          </span>
        </P>
      </Section>
    </Page>
  );
}
