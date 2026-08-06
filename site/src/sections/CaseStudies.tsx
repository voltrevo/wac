// The three things that are hardest to argue with: a shell that agrees with bash, a Tor client,
// and a pairing that agrees with Ethereum's own fixtures.
//
// Merged in from the wac-showcase page. The shell comes first even though Tor is the harder piece
// of engineering, because it is the easier *claim to check* — a reader can point their own `ssh`
// at it, and "652 scripts agree with GNU bash on stdout and exit status" is a sentence that
// either holds or does not.
//
// Every snippet here is real source from wac-mono, abridged only by removing lines.

import { CodeBlock, kw, s, tp } from "../theme";

const SEAM = `export struct Output {
  u8[] out;
  u8[] err;
  i32 status;
  /** False when no program of that name exists, which the shell reports as 127. */
  bool found;

  Output ok(u8[] out) { return Output(out, u8[0](), 0, true); }
  Output fail(u8[] err, i32 status) { return Output(u8[0](), err, status, true); }
  Output missing() { return Output(u8[0](), u8[0](), 127, false); }
}`;

const SSH_SESSION = `$ ssh -p 2222 user@host 'seq 1 100 | grep 7 | wc -l'
19
$ ssh -p 2222 user@host 'x="a b c"; echo "$x" | tr " " "-"'
a-b-c`;

const NTOR = `u8[] xy = x25519(ephemeralPriv, serverEph);
u8[] xb = x25519(ephemeralPriv, onionKey);
// A small-order Y or B makes the shared value all zero for every scalar, so an attacker
// needs no private key at all. tor-spec says abort; there is nothing to salvage.
if (allZero(xy) || allZero(xb)) { return u8[0](); }

// Constant time, because a caller may retry on failure and a timing difference here
// leaks which byte of AUTH was wrong.
i32 diff = 0;
for (i32 i = 0; i < 32; i++) { diff = diff | (expected[i] ^ auth[i]); }
if (diff != 0) { return u8[0](); }

return hkdfExpandRfc5869(keySeed, mExpand(), keyLen);`;

const ONION = `rendezvous established at test000a
introduction acknowledged
joined: the service is hop 4
HTTP/1.0 200 OK
hello from behind an onion`;

const NETWORK = `network: all 4 nodes are up
consensus verified: 1 of 1 authorities signed
path: wacrelay2 -> wacrelay -> wacrelay3
circuit built, 3 hops
network: ok`;

const PROOF = `// packages/mpt/src/account.wac — what an eth_getProof answer actually is.
AccountProof a = accountAt(stateRoot, address, accountNodes);
if (a.ok && a.present) {
  // The storage root comes *out of the account proof*. A caller that supplies it
  // from anywhere else can be handed a perfectly valid proof of a different
  // account's storage.
  StorageProof s = storageAt(a.account.storageRoot, slot, storageNodes);
}`;

const WAIT = `// The wait list, and beside it what each entry belongs to: -2 the guard, -1 the
// listener, otherwise a client's index. Built rather than computed, because the offsets
// shift as clients come and go and an arithmetic slip here routes a stranger's bytes.
Vec<i32> ids = Vec.create();
Vec<i32> owner = Vec.create();
ids.push(linkRead.id);
owner.push(-2);
if (accepting) { ids.push(acc.id); owner.push(-1); }
for (i32 i = 0; i < clients.len(); i++) {
  if (clients.get(i).reading) {
    ids.push(clients.get(i).read.id);
    owner.push(i);
  }
}

i32 w = core.waitAny(ids.toArray(), -1);
if (w < 0) { break; }
i32 who = owner.get(w);`;

const LIMBS = `// packages/bls/src/fp.wac
// 381 bits, held in twelve 32-bit limbs least-significant first.
//
// Twelve passes of twelve 32x32 products, so 144 of them per
// multiply, accumulated in 64 bits because \`i64\` is the widest
// multiply wasm has -- the same reason \`bignum\` uses 32-bit
// limbs. There is no 64x64->128 on this machine, so 64-bit
// limbs would need four products each and buy nothing.`;

const DESCRIPTOR = `// packages/ssz/src/container.wac
//
// A type is four \`i32\`s in a flat table, stride 4, so the whole
// thing crosses the JS boundary as an \`i32[]\` and needs no
// struct marshalling:
//
//     kind   one of the KIND_* below
//     param  basic: bytes. bitvector/bitlist: N.
//            vector/list: length or limit
//     child  element type index, or index into \`fields\`
//     count  container: how many fields

export const i32 KIND_BASIC     = 0;
export const i32 KIND_BITVECTOR = 1;
export const i32 KIND_BITLIST   = 2;
export const i32 KIND_VECTOR    = 3;
export const i32 KIND_LIST      = 4;
export const i32 KIND_CONTAINER = 5;`;

export default function CaseStudies() {
  return (
    <>
      <div style={s.section} id="shell">
        <h2 style={s.h2}>A shell, and an sshd that runs it</h2>
        <p style={s.p}>
          Quoting, expansion, here-documents, {tp("$(…)")}, pipelines, redirection, functions,
          loops, {tp("case")}, {tp("read")} — <strong style={{ color: "#e2e8f0" }}>652 scripts run
          through GNU bash and through this one</strong>, and the two must agree on standard output{" "}
          <em>and</em> on the exit status. That is the only test worth much for a shell: nearly
          every rule has a case where the obvious implementation is subtly wrong, and bash is the
          one thing that will say so.
        </p>
        <p style={s.p}>
          External commands go through a single function, so what runs them can change without the
          rest of the shell noticing:
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>sh/src/program.wac · the seam</div>
          <CodeBlock code={SEAM} lang="wac" />
        </div>
        <p style={s.p}>
          Bytes in, bytes out, a status, and {tp("found")} — because a shell reports 127 for{" "}
          <em>no such command</em> and the program's own code for <em>ran and failed</em>, and one
          integer cannot say both.
        </p>
        <p style={s.p}>
          An SSH server hands a channel's command string to that shell in capturing mode and sends
          the buffer back down the channel. OpenSSH's own client cannot tell the difference, and
          you can point yours at it:
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>a real client, our server</div>
          <CodeBlock code={SSH_SESSION} lang="ts" />
        </div>
        <p style={s.p}>
          {tp("cd")}, {tp("pwd")}, {tp("ls")}, {tp("mkdir")} and {tp("rm")} work — the shell keeps
          its own working directory and resolves every path through it, because the capability
          world lets you <em>read</em> where you are and deliberately offers no {tp("chdir")}: a
          mutable working directory is ambient state that changes what every relative path in a
          program means.
        </p>
        <h3 style={s.h3}>Sixty programs it did not have to contain</h3>
        <p style={s.p}>
          The shell used to carry its own small {tp("cat")}, {tp("wc")}, {tp("grep")} and nine
          more, written only because nothing could be started. Meanwhile another package had those
          twelve done properly and forty-five besides. They are wired together now —{" "}
          <strong style={{ color: "#e2e8f0" }}>one line, {tp("sh.external = boxRun")}</strong> —
          so {tp("sort")}, {tp("sha256sum")}, {tp("gzip")}, {tp("cut")}, {tp("diff")} and{" "}
          {tp("shuf")} are commands you can type, in the browser demo above as much as on a
          command line, running the same code either way.
        </p>
        <p style={s.p}>
          An applet reads {tp("cli.readChunk()")} and writes {tp("cli.write(…)")} — the process's
          own streams — and wac has no closures, so it cannot be handed a substitute world: a fake
          capability has nowhere to put what it collected. So the host holds the child's world
          instead, for the length of one call. Between {tp("pushChild")} and {tp("popChild")},
          argv, standard input, both output streams and every relative path belong to the child.
          The applet needs no change and cannot tell.
        </p>
        <p style={{ ...s.p, marginBottom: 0 }}>
          What that is <em>not</em> is isolation: same wasm instance, same authority. The thing
          with a real boundary is {tp("spawn")}, which the shell tries first and which a browser
          cannot do yet. The other honest gaps: pipeline stages run one at a time, so{" "}
          {tp("yes | head -1")} does not terminate the way it does in bash — it does stop, because
          a captured buffer is capped and {tp("yes")} is written to notice a write that fails —
          and a pty is refused rather than half-implemented, exactly as a real sshd does when none
          is available.
        </p>
      </div>

      <div style={s.section} id="tor">
        <h2 style={s.h2}>A Tor client, on a TLS 1.3 stack that is also wac</h2>

        <div
          style={{
            borderLeft: "2px solid #fbbf24",
            padding: "2px 0 2px 14px",
            marginBottom: 16,
            color: "#9ca3af",
            fontSize: 15,
          }}
        >
          <strong style={{ color: "#e2e8f0" }}>Not for production, and the packages say so
          first.</strong>{" "}
          Nothing in the dependency chain is constant-time, and none of it has been reviewed by
          anyone. The compiler's own {tp("ctTrace")} mode found the leaks it found — two known,
          one that was not — which is evidence that the tooling works, not that the result is safe
          to point at a real peer. What follows is a demonstration of what the language can carry.
        </div>

        <p style={s.p}>
          It bootstraps <em>over Tor</em>: a one-hop circuit to a starting relay fetches the
          consensus, the certificates and the microdescriptors, verifies them against the directory
          authorities, and every circuit after that is chosen from what it learnt — bandwidth-weighted
          per position, distinct /16s, mutual families excluded, an exit whose policy carries the
          port, through a pinned guard set. Flow control works, authenticated SENDMEs included:{" "}
          <strong style={{ color: "#e2e8f0" }}>1.2MB over 209 streams on one circuit</strong>, two
          and a half times the circuit window. Tor needs Curve25519,
          SHA-256, HMAC, HKDF, AES-128-CTR and Ed25519, all of which the TLS work had already
          built; the only primitive that had to be added was <strong style={{ color: "#e2e8f0" }}>
          SHA-1</strong>, because Tor still specifies it for the running digest that authenticates
          relay cells.
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>tor/src/ntor.wac · tor-spec §5.1.4</div>
          <CodeBlock code={NTOR} lang="wac" />
        </div>
        <p style={s.p}>
          The two Diffie-Hellmans do different jobs: the one between ephemeral keys gives forward
          secrecy, the one against the relay's published onion key is what makes it{" "}
          <em>authenticated</em>. Drop either and the handshake still completes and still agrees a
          key — so a round-trip test cannot tell the difference, and the tests remove each
          contribution in turn.
        </p>

        <h3 style={s.h3}>One worker, every socket, one wait</h3>
        <p style={s.p}>
          A SOCKS5 proxy on top of it, so anything that speaks SOCKS goes over Tor. It holds one
          outstanding read per socket plus an accept, hands the list to {tp("waitAny")}, and
          re-issues whichever answered.
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>tor/src/socks.wac · the whole loop, less the branches</div>
          <CodeBlock code={WAIT} lang="wac" />
        </div>
        <p style={s.p}>
          Against a local testnet it has carried 3.2MB across eight concurrent streams,
          byte-identical. Built, the whole thing is <strong style={{ color: "#e2e8f0" }}>386.7
          KiB</strong> as a self-contained executable — 234.2 KiB of wasm, 71.8 KiB gzipped.
        </p>

        <h3 style={s.h3}>It reaches onion services</h3>
        <p style={s.p}>
          A v3 onion address <em>is</em> an ed25519 public key, so there is no lookup and no
          registry: a client that reaches the right address cannot be talking to the wrong service.
          Getting from the address to a stream takes six pieces — the address and its checksum, key
          blinding and time periods, the HSDir hash ring, both encryption layers of the descriptor,
          the introduction cells, and the hs-ntor handshake — and each is checked against tor&rsquo;s
          own values rather than against itself.
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>fetching a page from a real service, over our own circuits</div>
          <CodeBlock code={ONION} lang="text" />
        </div>
        <p style={s.p}>
          Four things the specification does not say plainly, each of which produces a well-formed
          and useless value with no local symptom. A time period is not a day on a testing network —{" "}
          {tp("get_time_period_length()")} ignores the consensus parameter entirely and returns eight
          minutes, so computing 1440 asks for a period nobody is in. The MAC&rsquo;s arguments are the
          other way round from how §3.3.2 reads. The INTRODUCE1 MAC covers the whole cell including
          twenty zero bytes, which are zeros, so nothing local tells the two spans apart — the first
          version of that test asserted the wrong one and passed. And a BEGIN cell on a rendezvous
          circuit has an empty address. The first two fell to differentials against tor&rsquo;s own
          values; <strong style={{ color: "#e2e8f0" }}>the last two needed a live service</strong>.
        </p>
        <p style={s.p}>
          Hosting one is the mirror of every row above, and it is partly there: the descriptor
          decodes under tor&rsquo;s own {tp("hs_desc_decode_descriptor")}, key blinding matches in
          both directions, and <strong style={{ color: "#e2e8f0" }}>publication works end to
          end</strong> — our directory and our relay both accept a {tp("POST /tor/hs/3/publish")},
          check it the way tor does, file it under the blinded key from its certificate, and serve
          it back, replacing what they hold only for a strictly newer revision. What is left is the
          service program itself: the loop that establishes introduction points and answers an
          introduction.
        </p>

        <h3 style={s.h3}>And it runs the other side</h3>
        <p style={s.p}>
          There is a relay now, and a directory authority, and a launcher that stands a whole network
          up from a description — waiting for each node to announce itself rather than sleeping, and
          failing by name if one never does.
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>a Tor network with no C in it, in about a second</div>
          <CodeBlock code={NETWORK} lang="text" />
        </div>
        <p style={s.p}>
          Being the responder is not the client with the arrows reversed. The key material goes the
          other way round — a relay&rsquo;s forward is the client&rsquo;s backward, because the two
          ends disagree about which way the exit is — and getting it wrong makes every cell
          unrecognised in both directions rather than raising a key error. A relay also talks to
          strangers, so every length in a CREATE2 is somebody else&rsquo;s claim and a trap is a
          denial of service.
        </p>
        <p style={s.p}>
          What that buys is the test nothing else can give — interop in the direction that counts,
          with the other implementation as the client:{" "}
          <strong style={{ color: "#e2e8f0" }}>a real C tor bootstraps from our directory authority,
          builds a three-hop circuit through our relays, and carries a stream over it</strong>. It
          reaches <em>Bootstrapped 100% (done)</em> with microdescriptors at their default, having
          accepted our descriptor, our key certificate, our vote and both flavours of our consensus
          through its own parsers, with the signature verified inside the parse.
        </p>
        <p style={s.p}>
          It also fills a window, which is the only way a flow-control bug shows itself. Without
          SENDMEs a 200KB upload works and a 300KB one fails: 500 cells of 498 bytes is 249,000,
          exactly where it stopped. With them, 1MB goes through, and 8MB the other way past a slow
          reader.
        </p>

        <h3 style={s.h3}>What building it actually found</h3>
        <p style={s.p}>
          The first real transfer through the proxy aborted the client, and the bug was older than
          the proxy: the Tor link layer had been handing the TLS client whatever the socket
          returned since the day it was written. It survived a year of directory fetches because a
          consensus arrives as a few small records that a TCP segment does not usually split. The
          first 400KB download arrived as 44KB in one chunk — eighty records with the last one cut
          in half — and it aborted. <strong style={{ color: "#e2e8f0" }}>A fast-connection bug,
          not a slow-connection one</strong>, which is the opposite of where anyone looks for a
          framing fault.
        </p>
        <p style={{ ...s.p, marginBottom: 0 }}>
          The root cause was an asymmetric API: the server side had a framing helper and the
          client side did not, so every client-side caller was invited to write the loop itself.
          Two did. One was correct for a year and one was silently wrong for a year, which is the
          expected score for an unwritten convention.
        </p>
      </div>

      <div style={s.section} id="ethereum">
        <h2 style={s.h2}>Ethereum, against Ethereum's own vectors</h2>
        <p style={s.p}>
          A pairing-based signature scheme is the least forgiving thing to write in a new language:
          the answer is one bit, every intermediate is a 381-bit field element, and nothing short
          of the whole tower being right produces anything but noise.{" "}
          <strong style={{ color: "#e2e8f0" }}>It agrees with all 29 of{" "}
          <code style={{ fontFamily: "monospace" }}>ethereum/bls12-381-tests</code>&rsquo; verify
          fixtures</strong>, all 28 deserialization fixtures, and all 21 aggregate and batch ones,
          at about 8ms per signature.
        </p>
        <p style={s.p}>
          It is <em>verification only</em>, deliberately: no signing, no key generation, no secret
          material anywhere in the package. That scope decision has a useful consequence — every
          input is public, so none of it needs to be constant-time, and the class of timing bug
          that makes elliptic-curve code hard to write does not arise.
        </p>
        <p style={s.p}>
          Each stage was gated on an external oracle rather than on internal consistency —{" "}
          {tp("Fp")} against Python, the Miller loop against {tp("@noble/curves")}, {tp("hash_to_G2")}{" "}
          against the CFRG vectors — because a field implementation in the wrong Montgomery
          representation passes every self-check it has and disagrees with every real vector.
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>bls/src/fp.wac · why the limbs are 32 bits</div>
          <CodeBlock code={LIMBS} lang="wac" />
        </div>
        <p style={s.p}>
          That comment is also entry five of{" "}
          <a href="#wasm-gaps" style={{ color: "#2dd4bf" }}>what WebAssembly is missing</a>: wasm
          has no widening multiply, so the whole field is built in half-width limbs to stay inside
          an {tp("i64")} accumulator.
        </p>

        <h3 style={s.h3}>A hash_tree_root that is described, not written</h3>
        <p style={s.p}>
          Beside it, SSZ — Ethereum&rsquo;s serialization and the Merkle proofs over it.{" "}
          <strong style={{ color: "#e2e8f0" }}>2,233 of Ethereum&rsquo;s own vectors pass</strong>:
          1,057 valid {tp("ssz_generic")}, all 45 {tp("ssz_static")}, and{" "}
          <strong style={{ color: "#e2e8f0" }}>all 1,131 <em>invalid</em> {tp("ssz_generic")}</strong>{" "}
          — the ones that check what it refuses, which is the half a decoder can pass by being too
          permissive. In 808 lines.
        </p>
        <p style={s.p}>
          The reason it is 709 and not several thousand is that a type is <em>data</em>:
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>ssz/src/container.wac · the descriptor</div>
          <CodeBlock code={DESCRIPTOR} lang="wac" />
        </div>
        <p style={{ ...s.p, marginBottom: 0 }}>
          So the nine light-client containers are nine descriptors rather than nine functions, and
          the whole schema crosses the JavaScript boundary as an {tp("i32[]")} with no marshalling
          at all. Four things that table makes it hard to get wrong, because they are where SSZ
          implementations go wrong: the pad target is the type&rsquo;s limit and not the
          data&rsquo;s length; a bitlist&rsquo;s trailing delimiter bit is measured rather than
          merkleized; a variable field&rsquo;s extent comes from the <em>next</em> offset; and the
          first offset must equal the fixed part&rsquo;s size, so a serialization claiming
          otherwise is malformed rather than merely unusual.
        </p>

        <h3 style={s.h3}>A light client that follows the chain</h3>
        <p style={s.p}>
          On top of those two, the Altair sync protocol.{" "}
          <strong style={{ color: "#e2e8f0" }}>All four of Ethereum&rsquo;s{" "}
          <code style={{ fontFamily: "monospace" }}>light_client/sync</code> cases run step by
          step</strong> — nineteen steps, sixteen real sync-committee signatures, every Merkle branch
          — with the store&rsquo;s finalized and optimistic headers matching the vectors&rsquo; checks
          after each one. In 642 lines, because the containers were already descriptors.
        </p>
        <p style={s.p}>
          The interesting part is what those vectors <em>cannot</em> check. Every update in them is a
          valid one: the suite is a liveness test, so a {tp("validateUpdate")} that returns{" "}
          {kw("true")} unconditionally passes all nineteen steps — the headers being checked come out
          of the update rather than out of the check. So the negatives are built by corrupting real
          data one field at a time, and <strong style={{ color: "#e2e8f0" }}>each was confirmed to
          fail against a deliberately broken client before being kept</strong>: a bit in the
          signature, a node of the finality branch (which the signature does not cover), a bootstrap
          committee key, all 32 participation bits cleared.
        </p>
        <p style={{ ...s.p, marginBottom: 0 }}>
          Two checks resisted that and are pinned directly instead. Every vector update is signed by
          almost the whole committee, so {tp(">= 2/3")} and {tp(">= 1/3")} accept exactly the same
          set, and a safety threshold of half the maximum behaves identically to one of zero.
          Weakening either is invisible to the vectors and they are the security boundary of the
          protocol — so the supermajority rule is a named function with its own test at 21 and 22 of
          32. <em>A passing suite is evidence about the cases it contains and about nothing else.</em>
        </p>

        <h3 style={s.h3}>From a verified header to a contract&rsquo;s answer</h3>
        <p style={s.p}>
          A light client gives you a header, and a header says nothing about what is <em>in</em> the
          state it commits to. Four packages close that gap, and together they mean a contract read
          is <strong style={{ color: "#e2e8f0" }}>checked rather than trusted</strong> — the provider
          serving the answer cannot change it without the state root you already verified saying so.
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>mpt/src/proof.wac · what a proof is worth</div>
          <CodeBlock code={PROOF} lang="wac" />
        </div>
        <p style={s.p}>
          {tp("keccak256")} — which is not SHA3-256, and differs from it by one domain byte, so the
          test asserts it <em>disagrees</em> with SHA3 and with truncated SHAKE rather than only
          agreeing with its own vectors. {tp("packages/rlp")}, against Ethereum&rsquo;s own{" "}
          {tp("RLPTests")}: 28 valid driven in both directions and 26 invalid all refused.{" "}
          {tp("packages/abi")}, schema-driven like SSZ&rsquo;s containers — thirty cases from{" "}
          {tp("npm:ethers")} decoded <em>and</em> re-encoded byte for byte, plus the malformed-offset
          refusals. And {tp("packages/mpt")}, anchored to all seven published roots of{" "}
          {tp("trieanyorder.json")}: inclusion, absence, and every perturbation.
        </p>
        <p style={s.p}>
          Two things that table hides. <strong style={{ color: "#e2e8f0" }}>Absence is an
          answer</strong> — a sound proof that nothing is stored at a slot is a result, not a
          failure, and a verifier that cannot say it forces its caller to guess. And the walk is{" "}
          <em>two</em> steps: the account proof yields a storage root, and the storage proof must be
          checked under <em>that</em> root rather than under the state root, or a caller can be
          handed a perfectly valid proof of a different account&rsquo;s storage.
        </p>
        <p style={{ ...s.p, marginBottom: 0 }}>
          {tp("packages/ens")} turns the name a person types into the node a contract is asked
          about — EIP-137&rsquo;s namehash, the DNS wire encoding, and both calls&rsquo; calldata,
          all against {tp("npm:ethers")}. What is missing is the honest half: ENSIP-15 normalisation
          is not implemented and says so, and making the call needs an endpoint. Every piece here is
          the part that can be checked offline against somebody else&rsquo;s bytes — which is
          deliberate, because that is the part where being wrong is silent.
        </p>
      </div>
    </>
  );
}
