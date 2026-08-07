// Where this is going, for somebody who has not read a design document.
//
// The four directions have documents of their own — wac-mono's `design/0001`, `0003` and this
// repo's `design/0001` — and those are written for the people building them: decisions with their
// reasons, an order of work, a state of play. This page is the other audience. It says what each
// one is *for*, what would count as arriving, and what exists today, and links to the document for
// anyone who wants the argument rather than the summary.
//
// The rule for this page is the one the rest of the site follows: nothing is claimed as done that
// is not done, and the honest status is more interesting than the plan anyway.

import { CodeBlock, MONO, s, tp } from "./theme";
import { Page } from "./chrome";

const DESIGN = `${MONO}/blob/master/design`;
const WAC_DESIGN = "https://github.com/voltrevo/wac/blob/master/design";

const SEALED = `$ ssh -p 2222 user@host
$ ls /                       # a filesystem that is not the host's
bin  etc  home  tmp
$ echo hi > /home/user/notes
$ exit
# …and the writes are still there next time`;

const CORE = `import { Read } from core;   // no quotes: it is not a file`;

/** A step and whether it exists, rendered as a small table under each direction. */
function State({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ border: "1px solid #2e2e3e", borderRadius: 6, overflowX: "auto", marginBottom: 16 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <tbody>
          {rows.map(([what, state]) => (
            <tr key={what}>
              <td style={{ padding: "7px 12px", color: "#9ca3af", borderBottom: "1px solid #1e1e2e" }}>{what}</td>
              <td
                style={{
                  padding: "7px 12px",
                  borderBottom: "1px solid #1e1e2e",
                  whiteSpace: "nowrap",
                  color: state.startsWith("done") ? "#2dd4bf" : "#6b7280",
                  fontFamily: "monospace",
                }}
              >
                {state}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Roadmap() {
  return (
    <Page current="roadmap">
      <div style={s.section}>
        <h1 style={{ ...s.h2, fontSize: 32, marginBottom: 12 }}>Where this is going</h1>
        <p style={s.p}>
          Four directions, each with a document that argues it properly. What they have in common is
          the shape of the claim: not that wac could do these things, but that a specific thing would
          count as having arrived, and that you can check today how much of it exists.
        </p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2} id="wacland">One image, two very different hosts</h2>
        <p style={s.p}>
          <strong style={{ color: "#e2e8f0" }}>Wacland</strong> is a system that is the same system
          wherever it runs: in a browser tab, on Deno or Node, and in the userland of a bootable
          machine — a minimal kernel and a WebAssembly runtime, with no JavaScript anywhere in it.
          Log in over real OpenSSH, land in a shell, and find a filesystem, a home directory,{" "}
          {tp("/bin")} full of programs, a process table you can {tp("ps")} and {tp("kill")}, and a{" "}
          {tp("^C")} that interrupts — none of it touching the machine it happens to be running on.
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>a session on a filesystem that is not the host&rsquo;s</div>
          <CodeBlock code={SEALED} lang="text" />
        </div>
        <p style={s.p}>
          What it is <em>not</em> is a Linux emulator: no ELF loading, no syscall emulation, no qemu.
          The userland is this project&rsquo;s own shell and applets, checked against GNU&rsquo;s
          behaviour, and the system under them is wac too.
        </p>
        <p style={s.p}>
          <strong style={{ color: "#e2e8f0" }}>The arrival test</strong> is deliberately hard to
          fudge: load one image in two <em>substantially different</em> hosts and show the same
          users, files, programs, shell behaviour and services in both, with no implicit access to
          either. Substantially different means one JavaScript host and one that is not — two
          JavaScript hosts would satisfy the sentence and prove nothing, because they share the
          transport, the worker model and the event loop.
        </p>
        <State
          rows={[
            ["a filesystem of its own, in memory or on the host", "done"],
            ["an image format — persist and reload", "not started"],
            ["a second host with no JavaScript in it", "not started"],
            ["process table, users and login, line discipline", "not started"],
            ["init, and eventually a desktop", "not started"],
          ]}
        />
        <p style={{ ...s.p, marginBottom: 0 }}>
          The filesystem is real today: a shell mounted on an in-memory image passes 57 of the same
          differential scripts it passes on the host&rsquo;s, and answers identically to bash on
          both.{" "}
          <a href={`${DESIGN}/0001-a-self-contained-system.md`} target="_blank" rel="noopener" style={{ color: "#60a5fa" }}>
            design/0001
          </a>
        </p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2} id="native-host">A host with no JavaScript in it</h2>
        <p style={s.p}>
          There are three hosts today — browser, Node, Deno — and they are all JavaScript, so they
          share the transport, the worker model and the event loop. That makes them poor evidence for
          portability: a design flaw common to all three is invisible. The fourth host is{" "}
          <strong style={{ color: "#e2e8f0" }}>Rust on wasmtime</strong>, with no JavaScript in the
          artifact and, deliberately, no WASI reaching the program.
        </p>
        <p style={s.p}>
          No WASI because the capability world already <em>is</em> the interface, and WASI would be a
          second one with different opinions — plus the thing this system cannot do without is{" "}
          {tp("spawn")}, and a wasm module cannot instantiate another wasm module. If the runtime
          cannot make a second instance, nothing later can add it.
        </p>
        <p style={s.p}>
          There is a second prize. Today a spawned child is confined by the <em>language</em> — wac
          has no ambient authority, so a child cannot reach what it was not handed — but arbitrary
          JavaScript in a worker can, because a worker inherits the process&rsquo;s permissions. On
          this host a child instance gets exactly the imports the parent hands it, so {tp("spawn")}{" "}
          becomes a confinement primitive rather than only a composition one.
        </p>
        <p style={s.p}>
          There is a third reason, and it may be the one that matters most.{" "}
          <strong style={{ color: "#e2e8f0" }}>A run should be reproducible, and time should be a
          scheduling decision rather than a measurement.</strong> Everything hard about testing this
          system comes from interleaving — a zero-length write that ended a stream only when a reader
          happened to be parked; a corpus that hangs once in fifty runs and only on an idle machine.
          Owning the schedule buys replay. <em>Advancing</em> the clock when nothing is runnable buys
          something else: the transitions that take hours become milliseconds.
        </p>
        <p style={s.p}>
          That is not a mocked {tp("now()")}. A mocked clock lets a test <em>state</em> a time; a
          scheduler-owned one lets a test <em>pass through</em> one — which is how tor&rsquo;s own
          simulator works, and it exists for this exact problem. Almost everything the Tor stack has
          pinned is a steady state, because every transition needs hours of wall clock: a time period
          rolling while a client looks for a service, an introduction point expiring with a message in
          flight, a consensus refresh firing. And it is already costing accuracy rather than only
          coverage — the rotation vectors use an eight-minute period because a test network shrinks
          the interval to make rotation observable at all, so the production branch has never met a
          live network.
        </p>
        <State
          rows={[
            ["toolchain, and the two mechanisms proven on a probe", "done"],
            ["the runtime itself", "not started"],
            ["a deterministic mode, and virtual time on top of it", "designed, not started"],
          ]}
        />
        <p style={{ ...s.p, marginBottom: 0 }}>
          The acceptance test is one a runtime cannot pass by accident: two capability requests that
          complete <em>out of order</em>, waited on together, each resolving its own value — a host
          that answered everything immediately would pass the types and fail that. The seam for the
          clock is known and small today: a wait&rsquo;s deadline currently lives inside the
          worker&rsquo;s own memory, where a scheduler cannot see it, so it can neither say who is
          runnable nor decide which time to advance to.{" "}
          <a href={`${MONO}/blob/master/issues/open/0087-wacland-under-wasmtime-a-second-host-with-no-javascript.md`} target="_blank" rel="noopener" style={{ color: "#60a5fa" }}>
            issue 0087
          </a>
        </p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2} id="ethereum">Reading a contract without trusting whoever served it</h2>
        <p style={s.p}>
          An <strong style={{ color: "#e2e8f0" }}>Ethereum-centric reference distribution</strong>:
          one coherent system where a person can see which network backend is in use and replace it,
          hold an account no application ever sees the key for, resolve a name, read contract state{" "}
          <em>verified</em> rather than believed, and inspect a signing request before approving it.
        </p>
        <p style={s.p}>
          <em>Reference</em> because it is one worked example rather than a sanctioned one, and{" "}
          <em>-centric</em> because Ethereum is what it is built around rather than what it belongs
          to. Nobody has blessed this and nobody needs to — which is also why the core exposes nothing
          Ethereum-shaped, and why no contract holds automatic authority over the system.
        </p>
        <State
          rows={[
            ["consensus verification — the Altair light client", "done"],
            ["SSZ, Merkle proofs, BLS12-381 verification", "done"],
            ["keccak256, RLP, the contract ABI", "done"],
            ["Merkle-Patricia state proofs", "done"],
            ["ENS — the name half", "done"],
            ["secp256k1 signing", "gated — see below"],
            ["the reference application itself", "not started"],
          ]}
        />
        <p style={s.p}>
          Most of the read path exists, and{" "}
          <a href="#/showcase/ethereum" style={{ color: "#2dd4bf" }}>the showcase</a> has the
          numbers. Signing is last on purpose, and not because it is hard: it is the first thing here
          that touches secret material, so it gets a different gate — every secret-consuming routine
          under a constant-time trace from its <em>first</em> commit rather than retrofitted, and the
          distribution saying plainly what has and has not been reviewed for as long as that is true.
        </p>
        <p style={{ ...s.p, marginBottom: 0 }}>
          <a href={`${DESIGN}/0003-an-ethereum-centric-reference-distribution.md`} target="_blank" rel="noopener" style={{ color: "#60a5fa" }}>
            design/0003
          </a>
        </p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2} id="packages">Packages, and the version diamond wac cannot have</h2>
        <p style={s.p}>
          Every import is a relative file path, plus one that is not: {tp("core")}, the module the
          compiler ships.
        </p>
        <div style={{ marginBottom: 16 }}>
          <CodeBlock code={CORE} lang="wac" />
        </div>
        <p style={s.p}>
          That is the first provider of a mechanism meant to grow: a prefix resolving to a set of wac
          sources that need not be files on disk — an embedded module, a checkout beside you, or one
          day a fetched package. The next step is the directory kind, which is what lets a library
          live in its own repository at all.
        </p>
        <p style={s.p}>
          The constraint worth knowing about now, because it decides what a package service can be:{" "}
          <strong style={{ color: "#e2e8f0" }}>wac has nominal types and no closures</strong>, so two
          identical declarations are two types and nothing can convert between them. Cargo tolerates
          two versions of a crate in one build because Rust has closures and the seam can usually be
          converted; here the call cannot be made at all. So a package system on top of this has to
          resolve <em>flat</em> — one version of each package globally, closer to Go than to npm.
          Deciding that now costs a paragraph; discovering it later costs a manifest format.
        </p>
        <State
          rows={[
            ["`core`, embedded in the compiler", "done"],
            ["a directory provider — a package in its own repo", "not started"],
            ["a package service", "a destination, not a plan"],
          ]}
        />
        <p style={{ ...s.p, marginBottom: 0 }}>
          <a href={`${WAC_DESIGN}/0001-import-resolution-core-and-what-packages-inherit.md`} target="_blank" rel="noopener" style={{ color: "#60a5fa" }}>
            wac design/0001
          </a>
        </p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2} id="not-this">What is deliberately not on this list</h2>
        <p style={{ ...s.p, marginBottom: 0 }}>
          A package manager with a website. A standard library that grows by accretion. Anything that
          requires a maintainer&rsquo;s permission. The compiler is dependency-free
          TypeScript and the point of every direction above is to keep the number of things you have
          to trust small enough to read — which is a claim that gets harder to hold, not easier, as
          the list gets longer.
        </p>
      </div>
    </Page>
  );
}
