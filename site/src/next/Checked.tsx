// How this is checked — the page neither version of this site had.
//
// The oracle table was a section on the front page, which undersold it: "we never grade our own
// homework" is not a supporting detail, it is the reason any number elsewhere on this site is worth
// reading. And it is only one of eight kinds of evidence here, the others being interleaving
// enumeration, secret-dependence tracing, mutation, a coverage ledger where every unreached line
// carries a written reason, a spec where every claim carries a test, and tests written in the
// language itself.
//
// Ordered by how much a skeptical reader should weigh them: a foreign implementation disagreeing
// with you is worth more than any suite you wrote, and the further down this page you go the more
// the evidence is internal.

import { TOTALS } from "../data/built";
import { BLOB, A, Caveat, Code, Facts, Lead, m, P, Page, Section, Sub, Table } from "./ui";
import { c, font } from "./tokens";



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
        <P>
          <Lead>Most of these re-run on every suite run; some were witnessed once.</Lead> The
          distinction is worth more than the word <em>live</em> on its own, because a row nothing
          re-runs can rot silently and read exactly like one that cannot.{" "}
          {m({ children: "packages/tor" })}&rsquo;s own interop table draws it cell by cell — <Lead>seven of its fifteen</Lead> are re-run by{" "}
          {m({ children: "ctor_live.test.ts" })} and {m({ children: "packages/tls" })}&rsquo;s two
          interop files, and <Lead>eight are by hand</Lead>: the six onion-service cells and our
          client&rsquo;s two directions against C tor relays. The reason is mechanical rather than
          principled — the wac test network cannot start a C tor — and it is stated here for the same
          reason it is stated there.
        </P>
        <Table
          head={["the oracle", "what it settles"]}
          rows={[
            [<span style={{ fontFamily: font.mono }}>OpenSSL, rustls</span>, "our TLS 1.3 client and server, both directions, each configured to accept nothing but the suite under test"],
            [<span style={{ fontFamily: font.mono }}>C tor</span>, "our relay carries its circuits; our directory authority bootstraps it to 100%; it parses every cell, certificate, vote and consensus we produce"],
            [<span style={{ fontFamily: font.mono }}>OpenSSH</span>, "its client against our server, its server against our client"],
            [<span style={{ fontFamily: font.mono }}>GNU bash</span>, <span>{TOTALS.corpus} scripts, compared on standard output <em>and</em> exit status</span>],
            [<span style={{ fontFamily: font.mono }}>zlib, GNU gzip, zstd</span>, "our compressed output decompressed by theirs, and the reverse"],
            [<span style={{ fontFamily: font.mono }}>consensus-spec-tests</span>, <span>2,233 SSZ vectors, including all 1,131 <em>invalid</em> ones</span>],
            [<span style={{ fontFamily: font.mono }}>ethereum/tests</span>, "RLP driven in both directions against the published bytes"],
            [<span style={{ fontFamily: font.mono }}>npm:ethers, anvil</span>, "contract ABI encoding and decoding, and a state proof taken from a real client"],
            [<span style={{ fontFamily: font.mono }}>@noble/curves, Python</span>, <span>each stage of the BLS12-381 tower, gated separately — a field in the wrong Montgomery representation passes every self-check it has and fails every real vector</span>],
            [<span style={{ fontFamily: font.mono }}>Deno&rsquo;s filesystem</span>, <span>our in-memory one: the same script of writes, listings, renames and removals against both, transcript for transcript</span>],
            [<span style={{ fontFamily: font.mono }}>Chromium</span>, <span>its {m({ children: "RTCPeerConnection" })} opens a data channel to our WebRTC peer and receives our echo — SDP, ICE, DTLS 1.2, SCTP and DCEP, against libwebrtc rather than a second Python stack</span>],
            [<span style={{ fontFamily: font.mono }}>coturn, aioice</span>, <span>our STUN, and RFC 5769&rsquo;s published vectors beside it</span>],
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

      <Section id="two-hosts" kicker="evidence, second kind" title="A second host that shares nothing with the first">
        <P>
          There were three hosts — browser, Node, Deno — and they are all JavaScript, so they share
          the transport, the worker model and the event loop. That makes them poor evidence for
          anything: <Lead>a design flaw common to all three is invisible from any of them.</Lead>
        </P>
        <P>
          The fourth is Rust on wasmtime, with no JavaScript in the artifact and no WASI reaching
          the program. It shares no code with the others — the{" "}
          {m({ children: "SharedArrayBuffer" })}, the {m({ children: "Atomics.wait" })}, the
          sequence counters and the ring of slots have no counterpart in it and none was
          reimplemented. What crosses between the two is an image and a set of answers.
        </P>
        <Facts
          rows={[
            ["corpus scripts agreeing across both hosts", String(TOTALS.corpus)],
            ["image written on one, read on the other", "byte-identical"],
          ]}
        />
        <P>
          The sharpest of those is the second. A session that changes nothing writes the{" "}
          <em>same bytes</em> on either host — no directory order, no clock reading, no allocator
          padding leaking into the file. And the whole of it composes: the JavaScript host writes an
          image with two users, two homes and two private files, the host with no JavaScript serves
          it, and <Lead>a real OpenSSH client logs in as each of them</Lead> — each landing in their
          own home, each reading their own secret, and one refused the other&rsquo;s. The permission
          check is our own code reading a mode and an owner stored inside the image, which the
          operating system could not enforce if it tried: the image is one file owned by whoever ran
          the process.
        </P>
        <P>
          What it found is the argument for it. Every path in the native host was resolved against
          the wrong directory — {m({ children: "cat f" })} worked and{" "}
          {m({ children: "cd sub; cat f" })} did not, which is the most ordinary thing a script
          does and was invisible to every test that never changed directory.
        </P>
        <Caveat title="A canary that did not fire, and was worth more than one that did">
          Perturbing the native host&rsquo;s directory listing to answer in reverse order changed
          nothing in the crossing test — because everything a session does to files goes through the
          virtual filesystem <em>inside</em> the image, so the host surface being exercised is two
          calls wide. That is now written at the top of the test, because the file otherwise reads
          as covering far more than it does.
        </Caveat>
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

      <Section id="interleavings" kicker="evidence, third kind" title="Every interleaving, not a sample">
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

      <Section id="cttrace" kicker="evidence, fourth kind" title="Tracing what a secret touches">
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

      <Section id="mutation" kicker="evidence, fifth kind" title="Testing the tests">
        <P>
          A passing suite says the code does what the suite checks. It says nothing about what the
          suite forgot. So the code is mutated — a comparison flipped, a constant changed — and the
          suite is asked to notice.
        </P>
        <P>
          <Lead>434 of 497 mutants killed</Lead> on the first full run. The other 63 are not all
          gaps — nine were discarded as provably equivalent or uncompilable — and the 54 that did
          survive have been worked down to eight as tests were written for them, in{" "}
          <A href={`${BLOB}/issues/system/open/0005-mutation-testing-found-54-untested-behaviours.md`} external>an open issue</A>{" "}
          rather than quietly tolerated.
        </P>
        <P>
          <Lead>Those eight are unverified rather than open, and the instrument is why.</Lead>{" "}
          {m({ children: "tools/mutate.ts" })} ran the tests without a flag the suite itself had
          grown, so from the day the datagram capability landed every scope holding a net test was
          red before anything was mutated — and this tool excludes those mutants as unmeasurable,
          quietly enough that the headline still read like a score. Then the honest baseline turned
          out to take 673s against a 600s cap, which would have timed out a whole scope&rsquo;s
          mutants and recorded them as <em>killed</em>. Both are fixed; the re-run has not happened.
          A mutant that was never measured is not a gap in the tests, and a test written for one is
          a test written against a guess.
        </P>
      </Section>

      <Section id="coverage" kicker="evidence, sixth kind" title="Every unreached line has a written reason">
        <P>
          Mutation testing asks whether a test would notice a change. This asks the question before
          that one: whether the line was <em>run at all</em> — and, where it was not, makes somebody
          write down why.
        </P>
        <P>
          <Lead>36 of the 39 packages carry a coverage ledger</Lead> — and so does{" "}
          {m({ children: "core" })}, which is not a package — a file listing every branch point the
          suite does not reach, each with a sentence saying what would reach it. The three without
          one are {m({ children: "wacc" })}, which is 36,000 lines and its own project;{" "}
          {m({ children: "box" })}; and {m({ children: "wac" })}, added days ago.
        </P>
        <P>
          <Lead>The ratchet runs both ways, and the second direction is the unusual one.</Lead> An
          uncovered point nobody listed fails the run, which is the ordinary half. A point that{" "}
          <em>is</em> listed and turns out to be covered fails too — {m({ children: "covledger.wac" })}{" "}
          answers it with <em>&ldquo;the gap has been closed — drop the entry, and say so&rdquo;</em>.
          A ledger that quietly dropped those would stop being a record of what is still missing, and
          would decay into a list of excuses nobody rereads.
        </P>
        <P>
          The same rule applies to the reasons. A rule that no longer matches anything fails —{" "}
          <em>&ldquo;the rule explains something that is gone&rdquo;</em> — and since 2026-08-24 a
          rule whose every point another rule already claims is reported as having nothing of its
          own. That one was written after a rule in{" "}
          {m({ children: "packages/tls" })} spent months asserting that a P-384 certificate chain
          &ldquo;exists to generate and nothing reads what it makes&rdquo;, while a test read it. It
          survived because a broader rule covered the same line, so it never matched nothing and
          never tripped the first check.
        </P>
        <Caveat title="what a covered line is not">
          It is not a checked one. A guard can be reached by a test that asserts only that something
          was refused, never that it was refused for the right reason — and the coverage number
          cannot tell those apart. Two of this repository&rsquo;s client refusals were in exactly
          that state: executed on every run, and nothing in the suite would have failed if they had
          returned the wrong answer.
        </Caveat>
      </Section>

      <Section id="spec" kicker="evidence, seventh kind" title="A specification that cannot drift">
        <P>
          The language has a written specification, and <Lead>392 of its claims carry a tag</Lead>{" "}
          like {m({ children: "[§wac-core-one-type-8fjm2wq]" })}. Every tag names a test. A claim
          without evidence beside it reads as evidence, which is the failure mode a specification
          has, so a test walks the specification and fails with the list of any tag nothing covers.
        </P>
        <P>
          <Lead>The guard runs from the tag, not from the rule, and that is a gap rather than a
          detail.</Lead> It proves every tag has a test. It cannot prove every rule has a tag — so a
          normative sentence written without one is invisible to exactly the check that exists to
          catch prose nobody stands behind. Sweeping{" "}
          {m({ children: "spec/spec/*.md" })} for the phrasings a rule is written in —{" "}
          <em>is a compile error</em>, <em>is refused</em>, <em>is not allowed</em> — with no tag
          nearby finds rules that nothing runs, and{" "}
          <A href={`${BLOB}/issues/lang/open/0125-eleven-stated-spec-rules-have-nothing-that-measures-them.md`} external>an open issue</A>{" "}
          lists them. Both compilers refuse every one that can be written as a program, at the same
          positions — so the rules work and are held up by nobody, and the failure mode is a refactor
          quietly dropping one while the suite stays green.
        </P>
        <P>
          It found one on the day it was written: a claim about counted loops that was true, and had
          been true and unchecked since it was written. The same idea guards the rest of the
          project&rsquo;s prose — the package map is generated and its staleness is a failing test,
          and a README that prints a function signature is checked against the parsed source, which
          caught two signatures that had quietly stopped being real.
        </P>
      </Section>

      <Section id="in-wac" kicker="evidence, eighth kind" title="Tests written in the language itself">
        <P>
          <Lead>{TOTALS.wacTests} test files are written in wac</Lead>, not in the host language, and run through
          the same compiler as everything else. That is partly principle — a package whose tests are
          all in TypeScript is a package whose author avoided their own language — and partly
          coverage: a test written in wac exercises the compiler on the way past, which is how
          several emitter bugs were found by code that was trying to test something else.
        </P>
      </Section>

      <Section id="no-oracle" kicker="when there is none" title="The case where nobody else has the answer">
        <P>
          {m({ children: "keccak256" })} is the hash Ethereum is built on, and it is <em>not</em>{" "}
          SHA3-256: the original padding predates the standard, so this machine&rsquo;s OpenSSL and
          node ship SHA-3 and both SHAKEs and no keccak256 at all. There was nothing to run it
          against.
        </P>
        <P>
          So the claim is narrowed to what the evidence supports rather than widened to fill the
          gap. {m({ children: "sha3_256" })} and both SHAKEs <em>are</em> checked against{" "}
          {m({ children: "node:crypto" })}, which pins the permutation, the rate handling and the
          squeeze — everything the two share.{" "}
          <Lead>What that cannot pin is the one byte they differ by</Lead>, so the domain byte is
          isolated deliberately: the empty message, where it is the only thing the permutation sees,
          against a constant every Ethereum client agrees on. Then two more lengths, including a
          partial block with the padding well inside it.
        </P>
        <P>
          And then the other direction, which is the half that catches the actual failure mode: the
          same file asserts keccak256 <em>disagrees</em> with both SHA3-256 and a SHAKE256 truncated
          to 32 bytes, at six message lengths chosen around the sponge&rsquo;s rate — 0, 1, 135, 136,
          137, 272. <Lead>One wrong padding byte gives a hash that is the right length, avalanches,
          is perfectly self-consistent, and is silently the other algorithm.</Lead> Agreement with
          the three constants says which of the two this is; disagreement says it is not the
          neighbour it would be mistaken for.
        </P>
        <P>
          Written down that way because the alternative is the failure this whole page is about — a
          test that agrees with its own implementation and reads, from the outside, exactly like one
          that agreed with somebody else&rsquo;s.
        </P>
      </Section>

      <Section id="unfalsifiable" kicker="when the vectors cannot tell" title="Checks the suite cannot make">
        <P>
          Published vectors are the strongest evidence here and they still have a blind spot: they
          contain the cases somebody thought to write. The light client&rsquo;s do, and the gap is
          exact. Every update in them is signed by almost the whole committee, so{" "}
          <Lead>{m({ children: "≥ 2/3" })} and {m({ children: "≥ 1/3" })} accept the same set</Lead>,
          and a safety threshold of half the maximum behaves identically to one of zero. Weaken
          either and all nineteen steps still pass.
        </P>
        <P>
          They are also the security boundary of the protocol. So the supermajority rule is a named
          function with a test of its own, on the boundary rather than near it: with 32 members two
          thirds is 21.33, so 22 is the first supermajority and <em>21 is not</em> — 21 × 3 = 63,
          which is less than 2 × 32.
        </P>
        <P>
          The general form is worth saying plainly, because it is what the rest of this page assumes:{" "}
          <Lead>a passing suite is evidence about the cases it contains and about nothing
          else.</Lead>
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
