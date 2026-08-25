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
 * `tools/wac/frontpage_test.wac` runs these exact lines through `packages/box/example/boxsh.wac` and
 * fails if the output ever stops matching. So this is a claim with a test behind it rather than a
 * plausible-looking screenshot.
 */
/**
 * The bootstrap, as the suite reports it — `packages/wacc/test/wac/selfhostemit_test.wac`.
 *
 * Stage A is wacc built by the TypeScript compiler, B is wacc built by A, and C is what B produces
 * when asked to compile wacc. B and C being the same bytes is the whole claim.
 *
 * **The two figures are typed here and go stale**, which they had: they said 11 sources and 266,818
 * bytes into 2026-08-20, when the compiler was 16 sources and the artefact 968 KB. The size is rounded
 * on purpose — it moved three times on the day this was written, 960,310 bytes to 965,855 to 968,370,
 * because it moves with every change to the compiler. `deno task seed` prints it to the byte on every
 * rebuild, and it is a fixed point, checked rather than asserted; `packages/wacc/src` is the source
 * count. What the block is really claiming is the word at the end of the line.
 */
const BOOTSTRAP = `stage A   wacc, built by the TypeScript compiler
stage B   wacc, built by stage A
stage C   wacc, as stage B compiles it

B == C    17 sources, 1,059 KB, identical`;

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

        <Caveat title="what is missing">
          No supervision: {m({ children: "init" })} starts services and never stops one, with no
          restart policy, no dependency order and no readiness. Sealing a session off from the
          machine is tested rather than finished — turning spawning on still turns up leaks. There
          is no package manager, and no way to install anything into a session that is not built
          into it.
        </Caveat>
        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            {m({ children: "sort" })}, {m({ children: "sha256sum" })}, {m({ children: "gzip" })},{" "}
            {m({ children: "diff" })}, {m({ children: "tar" })}, {m({ children: "nc" })} — with
            pipelines, loops, variables and redirection into a filesystem that survives a reload.
            The shell agrees with GNU bash on <Lead>{TOTALS.corpus} differential scripts</Lead>, on
            standard output and exit status. <A href="#/run">Two more running here →</A>
          </span>
        </P>
      </Section>

      {/* ── The language ──────────────────────────────────────────────────── */}
      <Section id="language" kicker="and this is the language it is written in" title="Edit it, and press run">
        <P>
          Curly braces, {m({ children: "if" })} and {m({ children: "for" })}, structs and enums —
          and a type checker that will not let a {m({ children: "match" })} miss a case or a null go
          unchecked. Generics cost nothing at runtime. The collector is the platform&rsquo;s own, so
          there is no allocator to write and no linear memory to manage.
        </P>
        <InlineDemo initialCode={EX_HELLO} />
        <div style={{ height: space.block }} />
        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            No headers, no build system, no package manager: a file imports another file, and{" "}
            {m({ children: "core" })} is the only thing the compiler ships. Nothing to install.{" "}
            <A href="#/language">The rest of the language →</A>
          </span>
        </P>
      </Section>

      {/* ── wacc ──────────────────────────────────────────────────────────── */}
      <Section id="wacc" kicker="one of them, in full" title="The compiler, written in wac">
        <P>
          <Lead>wac is self-hosted.</Lead> {m({ children: "packages/wacc" })} is the compiler,
          written in wac, and it is what builds everything here — the packages, the programs, the
          demos on this page. The TypeScript compiler it grew out of is the seed —{" "}
          <Lead>~19,000 lines</Lead>, and building wacc is the only job it has left.
        </P>
        <Code label="wacc compiling itself" lang="text" code={BOOTSTRAP} />
        <P>
          Those two figures are read from the suite and typed here, so they are a snapshot; the same
          chain <A href="#/run/bootstrap">runs in this browser</A> on the Run page, where the byte
          count is whatever your machine just produced rather than whatever was true when this
          sentence was written.
        </P>
        <P>
          It is measured against the specification rather than against the other compiler. It
          refuses <Lead>all 317</Lead> of the one-file programs the spec calls illegal, and never
          invents a diagnostic — silent on all <Lead>371</Lead> it calls legal. The second is the
          number that matters: a checker reporting less than the spec can be finished, while one
          that reports what the spec does not cannot be trusted at all.
        </P>
        <P>
          <Lead>Both ledgers of known misses are empty</Lead>, which is the part worth saying out
          loud. {m({ children: "specsingle_test.wac" })} keeps two lists — the illegal programs this
          checker accepts, and the legal ones it refuses — and a program leaving either list fails
          the test until somebody deletes the line. The second list was fourteen when the corpus was
          recorded; eleven of those were one bug, a local aliasing something const could not be
          rebound, which made every linked-list walk in the specification illegal.
        </P>
        <Caveat title="not finished">
          Some of the repository&rsquo;s own files it still cannot compile whole — and it says which
          feature stopped it rather than emitting something that fails later. What the sweep asserts
          is the shape rather than a score: some whole, some partial, <em>none invalid</em>, and none
          of the modules it calls whole missing an export its source declares. And the way back is
          closing: {m({ children: "box" })} no longer builds with the seed at all, because the
          shell&rsquo;s compression library uses instructions only wacc has.
        </Caveat>
        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            <A href="#/stack/wacc">How the compiler is checked →</A>
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
          authority, builds a three-hop circuit through our relays and carries a stream over it,
          reaching <em>Bootstrapped 100%</em> through its own parsers.
        </P>
        <Caveat title="not ready to be relied on">
          Try it; that is what it is for. Just do not depend on it: <Lead>wac is unstable by
          choice</Lead> and still breaks its own language when that makes the language better. None
          of this has been reviewed by anyone, and anonymity is a separate question from correctness
          that it does not answer.
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
          Ask a node who owns a name and you are trusting whoever runs it. A wrong answer looks
          exactly like a right one.
        </P>
        <P>
          <Lead>This checks.</Lead> It follows the chain&rsquo;s headers itself and verifies the
          committee signatures on them, then makes the node prove every answer against a header it
          has accepted — the value, <em>and</em> the path through the trie that leads to it. Alter
          the value and the path stops hashing to the root. {m({ children: "vitalik.eth" })}{" "}
          resolves that way end to end, registry to storage to owner, with nothing taken on the
          endpoint&rsquo;s word.
        </P>
        <P>
          <span style={{ fontSize: 15, color: c.dim }}>
            Checked against the published vectors: SSZ&rsquo;s 2,233 including all 1,131{" "}
            <em>invalid</em> ones, BLS12-381&rsquo;s 29 fixtures, and the consensus spec&rsquo;s own
            sync cases.
          </span>
        </P>
        <Caveat title="to do">
          No EVM, so no contract calls, and no simulating a transaction before approving it. No
          signing: it reads the chain and does not write to it. No receipts or logs. The light
          client is Altair on a minimal config and has never followed mainnet.
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
            — eight kinds of evidence, starting with a foreign implementation on the other end.
          </span>
        </P>
      </Section>
    </Page>
  );
}
