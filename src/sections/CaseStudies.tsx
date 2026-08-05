// The three things that are hardest to argue with: a shell that agrees with bash, a Tor client,
// and a pairing that agrees with Ethereum's own fixtures.
//
// Merged in from the wac-showcase page. The shell comes first even though Tor is the harder piece
// of engineering, because it is the easier *claim to check* — a reader can point their own `ssh`
// at it, and "539 scripts agree with GNU bash on stdout and exit status" is a sentence that
// either holds or does not.
//
// Every snippet here is real source from wac-mono, abridged only by removing lines.

import { CodeBlock, s, tp } from "../theme";

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
          loops, {tp("case")}, {tp("read")} — <strong style={{ color: "#e2e8f0" }}>539 scripts run
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
          It verifies a consensus against the directory authorities, picks a bandwidth-weighted
          three-hop path, builds the circuit and carries streams over it. Tor needs Curve25519,
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
        <h2 style={s.h2}>BLS12-381 and SSZ, against Ethereum's own vectors</h2>
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
          <strong style={{ color: "#e2e8f0" }}>1,093 of Ethereum&rsquo;s own vectors pass</strong>:
          1,048 {tp("ssz_generic")} and all 45 {tp("ssz_static")}, which is everything an Altair
          light client needs. In 709 lines.
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
      </div>
    </>
  );
}
