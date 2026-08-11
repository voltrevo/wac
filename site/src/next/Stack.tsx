// The stack: what has been built in wac, and what says each claim is true.
//
// This page merges what used to be two — an inventory of packages and a set of case studies — because
// they were arguing the same thing from two ends and a reader had to visit both to get the point.
// The order is deliberate: the capability world first, since it is what makes an *application*
// possible at all, then the four things that would be hard to fake, then the whole inventory.
//
// Prose carried over from the pages this replaces, which had been corrected against the sources
// several times; the numbers come from `../data/built`, generated from the repository's own generated map.

import { BUILT, TOTALS } from "../data/built";
import { TREE, A, Caveat, Code, Facts, Lead, m, P, Page, Section, Sub, Table } from "./ui";
import { c, font, space } from "./tokens";



const EX_WC = `// packages/platform/example/wc.wac — a complete application, with no TypeScript beside it
export i32 main(Core core, Cli cli) {
  u8[] data = u8[0]();
  if (cli.argCount().wait() < 1) {
    data = cli.readStdin().wait();
  } else {
    FileResult f = cli.readFile(cli.arg(0).wait()).wait();
    if (!f.ok) { core.warn("wc: " + f.error); return 1; }
    data = f.bytes;
  }
  Counts n = count(data);
  core.log(itoa(n.lines) + " " + itoa(n.words) + " " + itoa(n.bytes));
  return 0;
}`;

const EX_SHEBANG = `#!/usr/bin/env -S deno run                    # built with no capabilities
#!/usr/bin/env -S deno run --allow-read       # built with --allow-read`;

const EX_SEAM = `export struct Output {
  u8[] out;
  u8[] err;
  i32 status;
  /** False when no program of that name exists, which the shell reports as 127. */
  bool found;
}`;

const EX_SSH = `$ ssh -p 2222 user@host 'seq 1 100 | grep 7 | wc -l'
19
$ ssh -p 2222 user@host 'x="a b c"; echo "$x" | tr " " "-"'
a-b-c`;

const EX_WAIT = `// The wait list, and beside it what each entry belongs to: -2 the guard, -1 the
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

const EX_ONION = `rendezvous established at test000a
introduction acknowledged
joined: the service is hop 4
HTTP/1.0 200 OK
hello from behind an onion`;

const EX_NTOR = `// packages/tor/src/ntor.wac — tor-spec §5.1.4
u8[] xy = x25519(ephemeralPriv, serverEph);
u8[] xb = x25519(ephemeralPriv, onionKey);
// A small-order Y or B makes the shared value all zero for every scalar, so an
// attacker needs no private key at all. tor-spec says abort; nothing to salvage.
if (allZero(xy) || allZero(xb)) { return u8[0](); }

// Constant time, because a caller may retry and a timing difference here leaks
// which byte of AUTH was wrong.
i32 diff = 0;
for (i32 i = 0; i < 32; i++) { diff = diff | (expected[i] ^ auth[i]); }
if (diff != 0) { return u8[0](); }`;

const EX_NETWORK = `network: all 4 nodes are up
consensus verified: 1 of 1 authorities signed
path: wacrelay2 -> wacrelay -> wacrelay3
circuit built, 3 hops
network: ok`;

const EX_PROOF = `// packages/mpt/src/account.wac — what an eth_getProof answer actually is
AccountProof a = accountAt(stateRoot, address, accountNodes);
if (a.ok && a.present) {
  // The storage root comes *out of the account proof*. A caller that supplies it
  // from anywhere else can be handed a perfectly valid proof of a different
  // account's storage.
  StorageProof s = storageAt(a.account.storageRoot, slot, storageNodes);
}`;

export default function Stack() {
  return (
    <Page current="stack">
      <Section id="top" kicker="the stack" title="What is built in it">
        <P>
          <Lead>{TOTALS.packages} packages, {TOTALS.lines.toLocaleString()} lines of wac,{" "}
          {TOTALS.programs} command-line programs and four browser pages.</Lead> No C, no libc, no
          runtime library, and no third-party code in any package&rsquo;s {m({ children: "src/" })}.
          Each was written because the layer under it needed something, which is why the list reads
          like an operating system rather than a portfolio.
        </P>
        <Facts
          rows={[
            ["packages", String(TOTALS.packages)],
            ["lines of wac", `${Math.round(TOTALS.lines / 1000)}k`],
            ["tests, both suites", `~${Math.round(TOTALS.testsAll / 100) * 100}`],
          ]}
        />
      </Section>

      <Section id="capabilities" kicker="why an application is possible" title="Capabilities, because an import names a file">
        <P>
          wac&rsquo;s {m({ children: "import" })} reads other wac source and does nothing else — a
          file beside it, or {m({ children: "core" })}, which the compiler ships. There is no{" "}
          {m({ children: "extern" })}, no declaration form, no way to write down the name of a
          function that lives outside the program. The only host code a module can call is a value
          somebody handed it.
        </P>
        <P>
          Take that seriously and a whole program becomes a function that takes the world as
          parameters. Here is one, and there is no TypeScript in its directory:
        </P>
        <Code label="the whole thing" code={EX_WC} />
        <P>
          Reading {m({ children: "main" })}&rsquo;s parameters tells you this program reads the
          clock, prints, and touches the filesystem. Nothing else is reachable, because there is
          nowhere else to reach. That is a property of the binary rather than a promise about it:{" "}
          <Lead>a module that takes no function parameter imports nothing at all</Lead> — not
          &ldquo;nothing it uses&rdquo;, an empty import section — and a module that takes one
          imports exactly one dispatcher, per signature rather than per parameter. A spec test
          compiles both and reads {m({ children: "WebAssembly.Module.imports" })} to say so. Behind {m({ children: "readFile(…).wait()" })} the host is doing
          asynchronous work on another thread while this one is parked — asynchronous work called
          synchronously, with none of the colouring that usually spreads through everything it
          touches.
        </P>
        <P>
          What the world leaves out is as deliberate as what it offers. {m({ children: "cwd" })} is
          readable and there is <Lead>no {m({ children: "chdir" })}</Lead>: a mutable working
          directory is ambient state that changes what every relative path in a program means, from
          anywhere, which is the shape this world exists to avoid. A program that moves around keeps
          its own idea of where it is and passes whole paths — which is exactly what the shell does,
          and why its {m({ children: "cd" })} is its own.
        </P>
        <Sub id="grants" title="Granted at build, not at run">
          <P>
            A built program takes no permission flags of its own and every argument goes to the
            application. Whoever packages it decides what it may do; whoever runs it cannot widen
            that. The shebang is exactly the grants, so the answer is readable with{" "}
            {m({ children: "head -1" })}:
          </P>
          <Code label="the first line of the artifact" code={EX_SHEBANG} lang="ts" />
          <P>
            And a child gets what its parent chose <em>intersected with what the parent itself
            has</em>, enforced by the host rather than trusted. So a program can hand out one
            capability of the several it holds, and <Lead>can never hand out one it lacks</Lead> —
            authority only narrows.
          </P>
        </Sub>
      </Section>

      <Section id="shell" kicker="hard to fake, #1" title="A shell that agrees with bash">
        <P>
          Quoting, expansion, here-documents, {m({ children: "$(…)" })}, pipelines, redirection,
          functions, loops, {m({ children: "case" })}, {m({ children: "read" })} —{" "}
          <Lead>{TOTALS.corpus} scripts run through GNU bash and through this one</Lead>, and the two must agree
          on standard output <em>and</em> on the exit status. That is the only test worth much for a
          shell: nearly every rule has a case where the obvious implementation is subtly wrong, and
          bash is the one thing that will say so.
        </P>
        <Code label="sh/src/program.wac · the seam external commands go through" code={EX_SEAM} />
        <P>
          Bytes in, bytes out, a status, and {m({ children: "found" })} — because a shell reports
          127 for <em>no such command</em> and the program&rsquo;s own code for <em>ran and
          failed</em>, and one integer cannot say both. That seam is why {TOTALS.applets} applets from another
          package became commands you can type with a single line of wiring, in a browser tab as
          much as on a command line, running the same code either way.
        </P>
        <P>
          An SSH server hands a channel&rsquo;s command string to that shell and sends the buffer
          back down the channel. <Lead>OpenSSH&rsquo;s own client cannot tell the difference</Lead>,
          and you can point yours at it:
        </P>
        <Code label="a real client, our server" code={EX_SSH} lang="ts" />
        <P>
          Ask it for a pty and it refuses, which is what a real sshd does when none is available —
          a refusal a client already knows how to handle, rather than half a terminal it does not.
        </P>
        <Sub id="applets" title="Sixty programs it did not have to contain">
          <P>
            The shell used to carry its own small {m({ children: "cat" })}, {m({ children: "wc" })}
            and {m({ children: "grep" })}, written only because nothing could be started. Another
            package had those done properly and forty-five besides. They are wired together with one
            line — {m({ children: "sh.external = boxRun" })} — so {m({ children: "sort" })},{" "}
            {m({ children: "sha256sum" })}, {m({ children: "gzip" })} and {m({ children: "diff" })}{" "}
            are commands you can type, <A href="#/run">in a browser tab</A> as much as on a command
            line, running the same code either way.
          </P>
          <P>
            An applet reads {m({ children: "cli.readChunk()" })} and writes{" "}
            {m({ children: "cli.write(…)" })} — the process&rsquo;s own streams — and wac has no
            closures, so it cannot be handed a substitute world: a fake capability has nowhere to
            put what it collected. So the host holds the child&rsquo;s world instead, for the length
            of one call. Between {m({ children: "pushChild" })} and {m({ children: "popChild" })},
            argv, standard input, both output streams and every relative path belong to the child.
            The applet needs no change and cannot tell.
          </P>
          <P>
            What that is <em>not</em> is isolation: same wasm instance, same authority — so it is
            the <em>fallback</em>. The shell spawns them: a worker can create a worker, and a
            browser bundle is its own program, so {m({ children: "sort" })} is this program again
            with {m({ children: "sort" })} as its first argument — its own instance, its own
            grants, its own {m({ children: "SharedArrayBuffer" })}. Which is why pipeline stages
            run at once and {m({ children: "yes | head -1" })} terminates the way it does in bash.
          </P>
          <P>
            Telling the two routes apart took the one place they differ, because an applet cannot:
            a <em>called</em> applet&rsquo;s output is captured and capped at 8 MiB, so{" "}
            {m({ children: "seq 1 1500000 | wc -c" })} truncates, and a spawned one&rsquo;s queue
            drains as the next stage reads it. <Lead>The spawned answer is the one GNU gives</Lead>,
            which is how a real Chromium says which route ran.
          </P>
        </Sub>
      </Section>

      <Section id="wacland" kicker="what the shell grew into" title="A system, not a shell with commands">
        <P>
          The shell and the applets were the first half. What has been built around them since is
          the part that makes a session something you can leave and come back to.
        </P>
        <Table
          head={["what", "and what makes it more than a name"]}
          rows={[
            ["a filesystem that is a value", <span>{m({ children: "Fs" })} is held by the program, not reached through the host — in memory, on a real disk, or synthesised, resolved by longest prefix so the three compose</span>],
            ["an image", <span>that filesystem written to one file, so a session survives a restart — and a session that changes nothing writes byte-identical bytes</span>],
            ["users and login", <span>mode and owner enforced from data inside the image; two keys land in two homes and neither can read the other&rsquo;s private file</span>],
            [<span style={{ fontFamily: font.mono }}>/bin</span>, <span>synthesised from the applet list, so it cannot disagree with what is wired in — and {m({ children: "/bin/wc -l" })} runs</span>],
            [<span style={{ fontFamily: font.mono }}>/dev</span>, <span>a real CSPRNG in a program built with no filesystem grant at all, because randomness is a host function rather than a grant</span>],
            [<span style={{ fontFamily: font.mono }}>/proc</span>, <span>a process table, so {m({ children: "ps" })} answers about the session it is running in</span>],
            [<span style={{ fontFamily: font.mono }}>init</span>, <span>{m({ children: "/etc/init" })} is a file you can {m({ children: "cat" })} and edit; each line becomes a real child with its own grants</span>],
          ]}
        />
        <P>
          Two things stop that list being a set of claims. The whole corpus runs against{" "}
          <Lead>three different filesystems</Lead> — memory, an image and a real disk — and all{" "}
          {TOTALS.corpus} scripts agree across them, which is the differential a virtual filesystem
          needs and is easy not to have. Beside it a test that keeps the first from being vacuous:
          if the image were secretly in memory too, three identical things would agree perfectly, so
          it also checks the image outlives its own process and the sealed session does not.
        </P>
        <P>
          And a sealed session — a shell built with <em>no capabilities at all</em> — is held to
          being unable to reach the machine by any of four routes, through a pipe as well as
          directly. Before that test the line was held by a comment, and a comment is what somebody
          edits.
        </P>
        <Caveat title="init is not a supervisor, and says so">
          No restart policy, no dependency order, no health checks, no readiness, and no way to stop
          a service once it is running. All five are named in the source, because a supervisor that
          quietly did none of them would look like the real thing until the first service died.
        </Caveat>
      </Section>

      <Section id="tor" kicker="hard to fake, #2" title="Tor, both ends">
        <Caveat title="Not for production, and the packages say so first">
          None of this has been reviewed by anyone. On side channels the honest statement is a
          measurement rather than a shrug — see <A href="#/stack/crypto">below</A> — and anonymity
          is a separate question from correctness that this does not have yet: Proposal 271 is
          partial, there is no padding, and stream isolation is by port rather than by destination.
          A wrong path selection builds a circuit that works perfectly with the anonymity quietly
          removed, which is the failure mode that does not announce itself.{" "}
          <Lead>Do not point it at the real Tor network.</Lead>
        </Caveat>
        <P>
          It bootstraps <em>over Tor</em>: a one-hop circuit to a starting relay fetches the
          consensus, the certificates and the microdescriptors, verifies them against the directory
          authorities, and every circuit after that is chosen from what it learnt —
          bandwidth-weighted per position, distinct /16s, mutual families excluded, an exit whose
          policy carries the port, through a pinned guard set. There is a SOCKS5 proxy on top, and
          it reaches onion services.
        </P>
        <P>
          Almost none of the cryptography under that was new. Tor needs Curve25519, SHA-256, HMAC,
          HKDF, AES-128-CTR and Ed25519, and the TLS work had already built every one of them; the{" "}
          <Lead>only primitive this whole stack added was SHA-1</Lead>, which Tor still specifies
          for the running digest that authenticates a circuit&rsquo;s relay cells.
        </P>
        <Code label="tor/src/ntor.wac · the handshake, abridged" code={EX_NTOR} />
        <P>
          The two Diffie-Hellmans do different jobs: the one between ephemeral keys gives forward
          secrecy, the one against the relay&rsquo;s published onion key is what makes it{" "}
          <em>authenticated</em>. Drop either and the handshake still completes and still agrees a
          key — so a round-trip test cannot tell the difference, and the tests remove each
          contribution in turn.
        </P>
        <Sub id="waitany" title="One worker, every socket, one wait">
          <P>
            A SOCKS5 proxy on top of it, so anything that speaks SOCKS goes over Tor. It holds one
            outstanding read per socket plus an accept, hands the list to{" "}
            {m({ children: "waitAny" })}, and re-issues whichever answered.
          </P>
          <Code label="tor/src/socks.wac · the whole loop, less the branches" code={EX_WAIT} />
          <P>
            Against a local testnet it has carried 3.2MB across eight concurrent streams,
            byte-identical. Built, the whole thing is <Lead>386.7 KiB</Lead> as a self-contained
            executable — 234.2 KiB of wasm, 71.8 KiB gzipped.
          </P>
        </Sub>
        <Sub id="onion" title="It reaches onion services">
          <P>
            A v3 onion address <em>is</em> an ed25519 public key, so there is no lookup and no
            registry: a client that reaches the right address cannot be talking to the wrong
            service. Six pieces get from the address to a stream, and each is checked against
            tor&rsquo;s own values rather than against itself.
          </P>
          <Code label="fetching a page from a real service, over our own circuits" code={EX_ONION} lang="text" />
          <P>
            Four things the specification does not say plainly, each producing a well-formed and
            useless value with no local symptom. A time period is not a day on a testing network.
            The MAC&rsquo;s arguments are the other way round from how §3.3.2 reads. The INTRODUCE1
            MAC covers the whole cell including twenty zero bytes — which are zeros, so nothing
            local tells the two spans apart, and the first version of that test asserted the wrong
            one and passed. And a BEGIN cell on a rendezvous circuit has an empty address.{" "}
            <Lead>The first two fell to differentials against tor&rsquo;s own values; the last two
            needed a live service.</Lead>
          </P>
          <P>
            It hosts one too, which is the mirror of every piece above and not a symmetry: the
            client proves nothing about itself and the service proves everything, so every cell it
            sends carries a signature or a MAC the client&rsquo;s equivalent does not. Publication
            works end to end — our directory and our relay accept a{" "}
            {m({ children: "POST /tor/hs/3/publish" })}, check it the way tor&rsquo;s own{" "}
            {m({ children: "desc_decode_plaintext_v3" })} does, file it under the blinded key from
            its certificate, and replace what they hold only for a strictly newer revision. The
            descriptor decodes whole under tor&rsquo;s{" "}
            {m({ children: "hs_desc_decode_descriptor" })}, and key blinding matches in both
            directions, so the blinded secret a service signs with is byte-identical to
            tor&rsquo;s.
          </P>
          <P>
            Which is why the transcript on the front page is the one that counts:{" "}
            <Lead>an unmodified {m({ children: "curl" })} fetched a page from a service we
            host</Lead>, with the introduction point and the rendezvous point our relays as well.
          </P>
        </Sub>
        <Sub id="tor-both" title="And it runs the other side">
          <P>
            There is a relay, a directory authority, and a launcher that stands a whole network up
            from a description — waiting for each node to announce itself rather than sleeping, and
            failing by name if one never does.
          </P>
          <Code label="a Tor network with no C tor in it, in about a second" code={EX_NETWORK} lang="text" />
          <P>
            Which buys the test nothing else can give, with the other implementation as the client:{" "}
            <Lead>a real C tor bootstraps from our directory authority, builds a three-hop circuit
            through our relays, and carries a stream over it</Lead> — reaching <em>Bootstrapped
            100%</em> having accepted our descriptor, certificate, vote and both consensus flavours
            through its own parsers.
          </P>
          <P>
            It also fills a window, which is the only way a flow-control bug shows itself. Without
            SENDMEs a 200KB upload works and a 300KB one fails: 500 cells of 498 bytes is 249,000,
            exactly where it stopped. With them, 1MB goes through, and 8MB the other way past a slow
            reader.
          </P>
        </Sub>
        <Sub id="found" title="What building it actually found">
          <P>
            The first real transfer through the proxy aborted the client, and the bug was older than
            the proxy: the link layer had been handing the TLS client whatever the socket returned
            since the day it was written. It survived a year of directory fetches because a
            consensus arrives as a few small records that a segment does not usually split. The
            first 400KB download arrived as 44KB in one chunk — eighty records with the last one cut
            in half — and it aborted. <Lead>A fast-connection bug, not a slow-connection one</Lead>,
            which is the opposite of where anyone looks for a framing fault.
          </P>
          <P>
            The root cause was an asymmetric API: the server side had a framing helper and the
            client side did not, so every client-side caller was invited to write the loop itself.
            Two did. One was correct for a year and one was silently wrong for a year, which is the
            expected score for an unwritten convention. <A href="#/checked/oracles">Why that is on
            the method page →</A>
          </P>
        </Sub>
      </Section>

      <Section id="ethereum" kicker="hard to fake, #3" title="Ethereum, against the published vectors">
        <P>
          A pairing-based signature scheme is the least forgiving thing to write in a new language:
          the answer is one bit, every intermediate is a 381-bit field element, and nothing short of
          the whole tower being right produces anything but noise.{" "}
          <Lead>It agrees with all 29 of {m({ children: "ethereum/bls12-381-tests" })}&rsquo; verify
          fixtures</Lead>, all 28 deserialization fixtures and all 21 aggregate ones, at about 8ms a
          signature. Verification only, deliberately — no signing, no key generation, no secret
          material anywhere in the package.
        </P>
        <P>
          Beside it SSZ, the consensus layer&rsquo;s serialization and the Merkle proofs over it:{" "}
          <Lead>2,233 vectors from {m({ children: "consensus-spec-tests" })}</Lead>, including all
          1,131 <em>invalid</em> ones — the half a decoder passes by being too permissive. On top of
          those, the Altair sync protocol runs all four {m({ children: "light_client/sync" })} cases
          step by step: nineteen steps, sixteen real sync-committee signatures, every Merkle branch.
        </P>
        <P>
          The interesting part is what those vectors <em>cannot</em> check. Every update in them is
          valid, so a {m({ children: "validateUpdate" })} that returns true unconditionally passes
          all nineteen steps. The negatives are built by corrupting real data one field at a time,
          and <Lead>each was confirmed to fail against a deliberately broken client before being
          kept</Lead>.
        </P>
        <Sub id="proofs" title="From a verified header to a contract's answer">
          <P>
            A light client gives you a header, and a header says nothing about what is <em>in</em>{" "}
            the state it commits to. keccak256, RLP, the contract ABI and Merkle-Patricia proofs
            close that gap, so a contract read is <Lead>checked rather than trusted</Lead> — the
            provider serving the answer cannot change it without the state root disagreeing.
          </P>
          <Code label="mpt/src/account.wac · what a proof is worth" code={EX_PROOF} />
          <P>
            Two things that snippet hides. <Lead>Absence is an answer</Lead> — a sound proof that
            nothing is stored at a slot is a result, not a failure. And the walk is <em>two</em>{" "}
            steps, which is the trap: the storage proof must be checked under the root the account
            proof yielded, or a caller can be handed a perfectly valid proof of a different
            account&rsquo;s storage.
          </P>
          <P>
            {m({ children: "packages/ens" })} turns the name a person types into the node a contract
            is asked about — EIP-137&rsquo;s namehash, the DNS wire encoding and both calls&rsquo;
            calldata, every case against {m({ children: "npm:ethers" })}. The honest half is that{" "}
            <Lead>ENSIP-15 normalisation is not implemented</Lead>, so a name is hashed as given: the
            corpus generator refuses to admit a name unless {m({ children: "ethers" })} says it is
            already normalised, which keeps the tests true and leaves the gap where a reader can see
            it.
          </P>
        </Sub>
      </Section>

      <Section id="wacc" kicker="hard to fake, #4" title="The compiler, being rewritten in the language it compiles">
        <P>
          {m({ children: "packages/wacc" })} is the wac compiler ported to wac, so that it can
          eventually compile itself. The point is not the compiler.{" "}
          <Lead>A compiler is the program shape this language is worst at</Lead> — syntax trees want
          sum types, symbol tables want generics, everything wants strings — so it exercises the
          friction with a real consumer rather than by argument.
        </P>
        <P>
          It is built as a ladder, and each rung is checked against the TypeScript implementation
          before the next is started. Same input, compare outputs, no judgement calls about which is
          right.
        </P>
        <Table
          head={["rung", "oracle", "state"]}
          rows={[
            [<span style={{ fontFamily: font.mono }}>lexer</span>, "token streams match, position for position", <span style={{ color: c.accent }}>passes</span>],
            [<span style={{ fontFamily: font.mono }}>parser</span>, "syntax trees match under a canonical form", <span style={{ color: c.accent }}>passes</span>],
            [<span style={{ fontFamily: font.mono }}>type checker</span>, "diagnostics match, including positions", <span style={{ color: c.accent }}>passes</span>],
            [<span style={{ fontFamily: font.mono }}>emitter</span>, "both modules run and answer the same", <span style={{ color: c.warm }}>356 of 359 files, 0 invalid</span>],
            [<span style={{ fontFamily: font.mono }}>bootstrap</span>, "a fixpoint: it compiles itself, byte for byte", <span style={{ color: c.accent }}>reached</span>],
          ]}
        />
        <P>
          The type checker is the one worth reading the numbers for, because it was finished against{" "}
          <em>four</em> independent corpora rather than one: every rejection the language&rsquo;s
          own specification documents, the reference compiler&rsquo;s own test suite, a
          generated sweep over the cross product of type against context —{" "}
          <Lead>10,013 programs, 0 false alarms, 0 contradictions</Lead> — and, most recently, the
          repository&rsquo;s own 341 wac files, with no false alarm among them. It reports a subset of the
          reference&rsquo;s diagnostics at its exact positions and never invents one.
        </P>
        <P>
          <Lead>Against the specification it is not a subset, and the honest numbers are worse than
          the ones this page carried.</Lead> The contract was built on an extractor that read the
          test file as text and found 101 of its 304 illegal programs, so &ldquo;101 of 101 refused,
          no exceptions&rdquo; was true of a third of the spec. Over the whole of it the checker
          refuses <Lead>303 of 304</Lead> and misses one; of the programs the spec calls legal it is
          silent on <Lead>367 of 367</Lead>. Across files, where the recording was right from the
          start, it is 15 of 15 and 41 of 41.
        </P>
        <P>
          The false alarms are what mattered and there are none. A checker that reports less than the
          reference can be compared to it; one that invents a diagnostic cannot, and that invariant
          had been asserted over a third of its domain until the extractor was replaced. The missing
          two thirds held 14 legal programs it refused, eleven of them one bug — a flag that answered
          both <em>may I write through this</em> and <em>may I rebind this name</em>, which made
          every linked-list walk in the spec illegal. The remaining sixteen rejections it missed were
          closed in one pass, each written as a specification case first and watched to fail before
          being implemented.
        </P>
        <P>
          <span style={{ fontSize: 14.5, color: c.dim }}>
            Still a subset of the <em>reference</em>, and deliberately — roughly 210 distinct
            diagnostics exist there and this implements a fraction, reporting fewer rather than
            different ones. Reporting a diagnostic the reference does not is what would break the
            comparison, so the checker stays quiet where it cannot type something rather than
            guessing.
          </span>
        </P>
        <P>
          <Lead>The last rung is reached, which is the one the others were for.</Lead> Take wacc,
          compile it with the reference to get stage A; compile wacc <em>with stage A</em> to get
          stage B; then ask stage B to compile wacc, and compare. <Lead>B and C are the same
          bytes.</Lead> A compiler that reproduces itself is what a bootstrap means, and nothing
          short of running it can show it.
        </P>
        <P>
          It is nearly finished — the emitter compiles <Lead>356 of the repository&rsquo;s 359 wac
          files</Lead> whole. That number used to fall as often as it rose, because the corpus is the
          live repository and code written for other reasons walks in using things this emitter had
          not reached; what changed is that the emitter caught up. <Lead>Nothing in the repository is
          declined any more.</Lead> All three files it cannot finish block on the same thing, and it
          is not a language feature: an import of a file the harness does not supply. Every answer it
          gives for the specification&rsquo;s own cases agrees — 356 of 356, from the 241 of 275
          programs it emits whole — and all 84 of the specification&rsquo;s rejections are also its.
          And <em>none of the 359 produces an invalid module</em>, which is the property that had to
          hold before the fixpoint meant anything: a walk that approves a function the emitter cannot
          actually emit would reach a fixpoint on garbage.
        </P>
        <Sub id="wacc-emitter" title="Why the emitter is not checked on its bytes">
          <P>
            The obvious oracle for an emitter is that the wasm comes out identical, and it is the
            wrong one. Byte identity pins the type section&rsquo;s ordering, index assignment,
            section order and{" "}
            <Lead>the width of a number&rsquo;s encoding</Lead> — a wasm integer may legally be
            written in one byte or five — none of which is the language. Held to it, this would be
            reproducing an implementation rather than a language, against a reference that changes
            several times a day.
          </P>
          <P>
            So the two modules are <em>run</em> and their answers compared, on every program in the
            set. That is what catches the class of fault the whole exercise exists to find: a
            literal reader that took decimal digits and stopped, so{" "}
            {m({ children: "0xff" })} compiled to {m({ children: "0" })}. It had been there since
            the first slice, and nothing found it because every hand-written case used plain decimal
            — <em>a corpus tests what its author thought to write down.</em>
          </P>
        </Sub>
      </Section>

      <Section id="crypto" kicker="the unflattering part" title="What the side-channel trace says">
        <P>
          The compiler has a mode that records the ordered sequence of branches taken{" "}
          <em>and</em> memory indices used. Run a routine twice with the same public input and
          different secrets, compare the two traces, and a difference is a leak with a source line
          on it. Both halves matter: a secret-dependent branch is the obvious one, and a
          secret-dependent <em>index</em> has no branch at all — {m({ children: "SBOX[key_byte]" })}{" "}
          touches a cache line the key chose, which is how AES keys have been recovered from cache
          timing since 2005.
        </P>
        <Table
          head={["routine", "events per run", "result"]}
          align={["left", "right", "left"]}
          rows={[
            [<span style={{ fontFamily: font.mono }}>sha256</span>, "1,555", <span style={{ color: c.accent }}>uniform</span>],
            [<span style={{ fontFamily: font.mono }}>chachaBlock</span>, "1,598", <span style={{ color: c.accent }}>uniform</span>],
            [<span style={{ fontFamily: font.mono }}>poly1305</span>, "139", <span style={{ color: c.accent }}>uniform</span>],
            [<span style={{ fontFamily: font.mono }}>x25519Base</span>, "1,620,094", <span style={{ color: c.accent }}>uniform</span>],
            [<span style={{ fontFamily: font.mono }}>ghash</span>, "513", <span style={{ color: c.warm }}>leaks — control flow diverges</span>],
            [<span style={{ fontFamily: font.mono }}>aesExpandKey</span>, "455", <span style={{ color: c.warm }}>leaks — four secret-dependent indices</span>],
            [<span style={{ fontFamily: font.mono }}>aesEncrypt</span>, "8,631", <span style={{ color: c.warm }}>leaks — five, plus divergence</span>],
            [<span style={{ fontFamily: font.mono }}>bcryptPbkdf</span>, "&gt; 4,194,304", <span style={{ color: c.dim }}>not measured — exceeds the buffer</span>],
          ]}
        />
        <P>
          This is on the site because it is the shape of claim the rest of the site is making. The
          x25519 row is the one worth reading twice — the ladder is uniform across every one of 1.6
          million events, which is what &ldquo;structurally uniform&rdquo; used to assert without
          evidence. And AES leaks in five places rather than one.
        </P>
        <Caveat title="Uniform is not a proof of constant time">
          The trace is dynamic, it sees only what wasm does, and it cannot see that an
          instruction&rsquo;s own latency may depend on its operands. It says two runs took the same
          path, not that they took the same time. Do not use any of this where an attacker can
          observe timing.
        </Caveat>
      </Section>

      <Section id="packages" kicker="all of it" title="Every package">
        <P>
          In dependency order — nothing imports anything above it. Generated from the repository&rsquo;s
          own generated map, so these numbers are the tree&rsquo;s rather than a claim about it.
        </P>
        <Table
          head={["package", "what it is", "lines", "tests"]}
          align={["left", "left", "right", "right"]}
          rows={BUILT.map((p) => [
            <a href={`${TREE}/packages/${p.name}`} target="_blank" rel="noopener" style={{ fontFamily: font.mono, color: c.accent, textDecoration: "none", whiteSpace: "nowrap" }}>{p.name}</a>,
            <span style={{ color: c.dim }}>{p.what}</span>,
            <span style={{ fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>{p.lines.toLocaleString()}</span>,
            <span style={{ fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>{p.tests}</span>,
          ])}
        />
        <div style={{ height: space.tight }} />
        <P>
          <A href="#/roadmap">Where this is going →</A>
        </P>
      </Section>
    </Page>
  );
}
