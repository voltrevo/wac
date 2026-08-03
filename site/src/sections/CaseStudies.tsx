// The two things that are hardest to argue with: a shell that agrees with bash, and a Tor client.
//
// Merged in from the wac-showcase page. The shell comes first even though Tor is the harder piece
// of engineering, because it is the easier *claim to check* — a reader can point their own `ssh`
// at it, and "499 scripts agree with GNU bash on stdout and exit status" is a sentence that
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

export default function CaseStudies() {
  return (
    <>
      <div style={s.section}>
        <h2 style={s.h2}>A shell, and an sshd that runs it</h2>
        <p style={s.p}>
          Quoting, expansion, here-documents, {tp("$(…)")}, pipelines, redirection, functions,
          loops, {tp("case")}, {tp("read")} — <strong style={{ color: "#e2e8f0" }}>499 scripts run
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
        <p style={{ ...s.p, marginBottom: 0 }}>
          The honest gaps: pipeline stages run one at a time, so {tp("yes | head -1")} would not
          terminate; there is no {tp("cd")}, because nothing in the platform has a working
          directory; and a pty is refused rather than half-implemented, exactly as a real sshd
          does when none is available.
        </p>
      </div>

      <div style={s.section}>
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
    </>
  );
}
