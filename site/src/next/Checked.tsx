// How this is checked — the page neither version of this site had.
//
// The oracle table was a section on the front page, which undersold it: "we never grade our own
// homework" is not a supporting detail, it is the reason any number elsewhere on this site is worth
// reading. And it is only one of six kinds of evidence here, the others being interleaving
// enumeration, secret-dependence tracing, mutation, a spec where every claim carries a test, and
// tests written in the language itself.
//
// Ordered by how much a skeptical reader should weigh them: a foreign implementation disagreeing
// with you is worth more than any suite you wrote, and the further down this page you go the more
// the evidence is internal.

import { A, Caveat, Code, Lead, m, P, Page, Section, Sub, Table } from "./ui";
import { c, font } from "./tokens";

const MONO_REPO = "https://github.com/voltrevo/wac-mono";

const EX_INTERLEAVE = `// packages/platform/test/bridge_model.test.ts
/** Walk every interleaving of the two agents' moves to \`depth\`. */
function enumerate(depth: number, moves: readonly Move[]): Broken[] { … }`;

const EX_CT = `// A routine is run twice with the same public input and different secrets, and the
// ordered sequence of branches AND memory indices is compared.
assertNoSecretDependence(routine, { publicInput, secrets: [allZero, allOnes, oneBit] });`;

export default function Checked() {
  return (
    <Page current="checked">
      <Section id="top" kicker="how this is checked" title="We do not grade our own homework">
        <P>
          A test suite written by the same people as the code is a check on internal consistency and
          almost nothing else. A round-trip test where both ends are ours tests only that we are
          consistently wrong. Everything below is ordered by how much weight it deserves, and the
          first kind is worth more than all the rest together:{" "}
          <Lead>somebody else&rsquo;s implementation disagreeing with us</Lead>.
        </P>
      </Section>

      <Section id="oracles" kicker="evidence, first kind" title="A foreign implementation on the other end">
        <P>
          Where an implementation exists to talk to, it is the test. Not a fixture captured from it
          once — the real thing, running, with our bytes going into it and its bytes coming back.
        </P>
        <Table
          head={["the oracle", "what it settles"]}
          rows={[
            [<span style={{ fontFamily: font.mono }}>OpenSSL, rustls</span>, "our TLS 1.3 client and server, both directions, each configured to accept nothing but the suite under test"],
            [<span style={{ fontFamily: font.mono }}>C tor</span>, "our relay carries its circuits; our directory authority bootstraps it to 100%; it parses every cell, certificate, vote and consensus we produce"],
            [<span style={{ fontFamily: font.mono }}>OpenSSH</span>, "its client against our server, its server against our client"],
            [<span style={{ fontFamily: font.mono }}>GNU bash</span>, <span>652 scripts, compared on standard output <em>and</em> exit status</span>],
            [<span style={{ fontFamily: font.mono }}>zlib, GNU gzip, zstd</span>, "our compressed output decompressed by theirs, and the reverse"],
            [<span style={{ fontFamily: font.mono }}>consensus-spec-tests</span>, <span>2,233 SSZ vectors, including all 1,131 <em>invalid</em> ones</span>],
            [<span style={{ fontFamily: font.mono }}>ethereum/tests</span>, "RLP driven in both directions against the published bytes"],
            [<span style={{ fontFamily: font.mono }}>npm:ethers, anvil</span>, "contract ABI encoding and decoding, and a state proof taken from a real client"],
            [<span style={{ fontFamily: font.mono }}>@noble/curves, Python</span>, "each stage of the BLS12-381 tower, gated separately"],
          ]}
        />
        <P>
          What that buys is specific rather than rhetorical. A framing bug in the Tor link layer
          survived a year of directory fetches, because a consensus arrives as a few small records
          that a TCP segment does not usually split. The first 400KB download through the proxy
          found it in seconds — 44KB in one chunk, eighty records with the last one cut in half.{" "}
          <Lead>A fast-connection bug, not a slow-connection one</Lead>, which is the opposite of
          where anyone looks for a framing fault.
        </P>
        <P>
          The root cause is the reason this page exists. The server side had a framing helper and
          the client side did not, so every client-side caller was invited to write the loop itself.
          Two did. One was correct for a year and one was silently wrong for a year — which is the
          expected score for an unwritten convention, and is not a thing a suite we wrote would have
          told us.
        </P>
      </Section>

      <Section id="symmetry" kicker="the trap it avoids" title="Why a round trip proves less than it looks">
        <P>
          Encode, decode, compare: the shape of a thousand test suites, and it can only fail if the
          two halves disagree. Both being wrong the same way passes.{" "}
          <Lead>A decoder written from the same misreading as its encoder is invisible to it.</Lead>
        </P>
        <P>
          So round trips are used here to find <em>asymmetry</em> and never as the primary evidence
          for correctness. The primary evidence is the paragraph above: their encoder, our decoder.
          Where no counterpart exists — a wac-only data structure, say — the fallback is a property
          the format itself has to satisfy, checked over generated inputs, rather than a mirror of
          our own code.
        </P>
      </Section>

      <Section id="interleavings" kicker="evidence, second kind" title="Every interleaving, not a sample">
        <P>
          Concurrency bugs do not fail reproducibly, so a suite that runs them a thousand times is
          measuring luck. Two real ones here were like that: a zero-length write ended a stream{" "}
          <em>only when a reader happened to be parked</em>, and a corpus hung about once in fifty
          runs <em>and only on an idle machine</em>. A fuzzer found them, eventually.
        </P>
        <P>
          The bridge protocol, the child lifecycle and the worker pool are pure transition functions
          now, and their tests walk the state space instead of sampling it:
        </P>
        <Code label="packages/platform/test/bridge_model.test.ts" code={EX_INTERLEAVE} lang="ts" />
        <P>
          Four model tests over the platform&rsquo;s concurrency. What they establish is different
          in kind from "we ran it a lot": every ordering to the given depth was tried, so the class
          of bug is excluded rather than not-yet-observed.
        </P>
      </Section>

      <Section id="cttrace" kicker="evidence, third kind" title="Tracing what a secret touches">
        <P>
          The compiler has a mode that records the ordered sequence of branches taken <em>and</em>{" "}
          memory indices used. Run a routine twice with the same public input and different secrets;
          a difference is a leak with a source line on it.
        </P>
        <Code label="how a routine is held to it" code={EX_CT} lang="ts" />
        <P>
          Both halves matter, and the second is the one tools usually miss: a secret-dependent{" "}
          <em>index</em> has no branch at all. {m({ children: "SBOX[key_byte]" })} touches a cache
          line the key chose, which is how AES keys have come out of cache timing since 2005 — and a
          branch-counting tool calls it uniform.
        </P>
        <P>
          The results are on <A href="#/stack/crypto">the stack page</A>, including the two routines
          that leak and the five lines they leak at. They are published because a measurement that
          only appears when it is flattering is not a measurement.
        </P>
        <Caveat title="Uniform is not a proof of constant time">
          The trace is dynamic, it sees only what wasm does, and it cannot see that an
          instruction&rsquo;s own latency may depend on its operands. It says two runs took the same
          path, not that they took the same time.
        </Caveat>
      </Section>

      <Section id="mutation" kicker="evidence, fourth kind" title="Testing the tests">
        <P>
          A passing suite says the code does what the suite checks. It says nothing about what the
          suite forgot. So the code is mutated — a comparison flipped, a constant changed — and the
          suite is asked to notice.
        </P>
        <P>
          <Lead>434 of 497 mutants killed</Lead> in the packages measured so far. The interesting
          number is the other 63: each one is a line whose behaviour nothing checks, and they are
          written down as <A href={`${MONO_REPO}/blob/master/issues/open/0005-mutation-testing-found-54-untested-behaviours.md`} external>an open issue</A>{" "}
          rather than quietly tolerated.
        </P>
      </Section>

      <Section id="spec" kicker="evidence, fifth kind" title="A specification that cannot drift">
        <P>
          The language has a written specification, and <Lead>409 of its claims carry a tag</Lead>{" "}
          like {m({ children: "[§wac-core-one-type-8fjm2wq]" })}. Every tag names a test. A claim
          without evidence beside it reads as evidence, which is the failure mode a specification
          has, so a test walks the specification and fails with the list of any tag nothing covers.
        </P>
        <P>
          It found one on the day it was written: a claim about counted loops that was true, and had
          been true and unchecked since it was written. The same idea guards the rest of the
          project&rsquo;s prose — the package map is generated and its staleness is a failing test,
          and a README that prints a function signature is checked against the parsed source, which
          caught two signatures that had quietly stopped being real.
        </P>
      </Section>

      <Section id="in-wac" kicker="evidence, sixth kind" title="Tests written in the language itself">
        <P>
          <Lead>78 test files are written in wac</Lead>, not in the host language, and run through
          the same compiler as everything else. That is partly principle — a package whose tests are
          all in TypeScript is a package whose author avoided their own language — and partly
          coverage: a test written in wac exercises the compiler on the way past, which is how
          several emitter bugs were found by code that was trying to test something else.
        </P>
      </Section>

      <Section id="honest" kicker="and" title="What none of this establishes">
        <P>
          None of it has been reviewed by anyone. Interoperating with an implementation is not the
          same as being safe against an adversary — a peer that follows the protocol exercises the
          paths a peer follows, and an attacker specifically does not. Everything cryptographic here
          says <em>not for production</em> in its own README, first line, and means it.
        </P>
        <P>
          The claim this page makes is narrower and, we think, worth more:{" "}
          <Lead>where a number appears on this site, something outside this project put it
          there.</Lead>
        </P>
      </Section>
    </Page>
  );
}
