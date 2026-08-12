// Where this is going, for somebody who has not read a design document.
//
// Each direction has a document written for the people building it — decisions with their reasons,
// an order of work, a state of play. This says what each one is *for*, what would count as
// arriving, and what exists today. Every section carries its own state table, because a plan
// without a status is a wish, and because "not started" appearing this often is the thing that
// makes the rest of the page credible.

import { TOTALS } from "../data/built";
import { BLOB, A, Caveat, Code, Lead, m, P, Page, Section, Table } from "./ui";
import { c, font } from "./tokens";



const WAC_DESIGN = "https://github.com/voltrevo/wac/blob/master/design";

const SEALED = `$ ssh -p 2222 user@host
$ ls /                       # a filesystem that is not the host's
bin  etc  home  tmp
$ echo hi > /home/user/notes
$ exit
# …and the writes are still there next time`;

const CORE = `import { Read } from core;   // no quotes: it is not a file`;

/** A direction's steps and whether they exist. Done is the only state that gets the accent. */
function State({ rows }: { rows: [string, string][] }) {
  return (
    <Table
      rows={rows.map(([what, state]) => [
        what,
        <span style={{ fontFamily: font.mono, whiteSpace: "nowrap", color: state.startsWith("done") ? c.accent : c.dim }}>
          {state}
        </span>,
      ])}
      align={["left", "right"]}
    />
  );
}

export default function Roadmap() {
  return (
    <Page current="roadmap">
      <Section id="top" kicker="where this is going" title="Four directions, and what would count as arriving">
        <P>
          What these have in common is the shape of the claim. Not that wac <em>could</em> do these
          things — that a specific, checkable thing would count as having done them, and that you
          can see today how much of it exists.
        </P>
      </Section>

      <Section id="wacland" kicker="direction one" title="One image, two very different hosts">
        <P>
          A system that is the same system wherever it runs: in a browser tab, on Deno or Node, and
          in the userland of a bootable machine — a minimal kernel and a WebAssembly runtime, with no
          JavaScript anywhere in it. Log in over real OpenSSH, land in a shell, and find a
          filesystem, a home directory, {m({ children: "/bin" })} full of programs, a process table
          you can {m({ children: "ps" })} and {m({ children: "kill" })}, and a{" "}
          {m({ children: "^C" })} that interrupts — none of it touching the machine it happens to be
          running on.
        </P>
        <Code label="a session on a filesystem that is not the host's" code={SEALED} lang="text" />
        <P>
          What it is <em>not</em> is a Linux emulator: no ELF loading, no syscall emulation, no
          qemu. The userland is this project&rsquo;s own shell and applets, checked against
          GNU&rsquo;s behaviour, and the system under them is wac too.
        </P>
        <P>
          <Lead>The arrival test</Lead> is deliberately hard to fudge: load one image in two{" "}
          <em>substantially different</em> hosts and show the same users, files, programs, shell
          behaviour and services in both, with no implicit access to either. Substantially different
          means one JavaScript host and one that is not — two JavaScript hosts would satisfy the
          sentence and prove nothing, because they share the transport, the worker model and the
          event loop.
        </P>
        <State
          rows={[
            ["a filesystem of its own, in memory or on the host", "done"],
            ["an image format — persist and reload", "done"],
            ["a second host with no JavaScript in it", "done"],
            ["process table, users and login, a line discipline", "done"],
            ["init — services as a file in the image", "done"],
            ["a spawned stage reaching the session's filesystem", "done"],
            ["a desktop", "started"],
          ]}
        />
        <P>
          <Lead>Most of this direction arrived.</Lead> The whole differential corpus — all{" "}
          {TOTALS.corpus} scripts — runs against three different filesystems, memory, an image and a
          real disk, and agrees on every one. Beside that comparison sits the test that stops it
          being vacuous: if the image were secretly in memory too, three identical things would
          agree perfectly, so it also checks the image outlives its own process and the sealed
          session does not.
        </P>
        <P>
          The row that kept the strongest version of this honest has closed. A spawned stage used to
          be handed the host&rsquo;s filesystem rather than the session&rsquo;s, so a sealed session
          was sealed everywhere except through a spawn; a child asks its parent over a channel now,
          and the browser terminal&rsquo;s spawned programs see the same {m({ children: "/bin" })}{" "}
          it does.
        </P>
        <P>
          Closing it is also what made the rest visible, and that is the more useful thing to report.
          Turning spawning on for sealed sessions made two latent leaks reachable within the day —{" "}
          {m({ children: "tar" })} asking the host whether a path was a symbolic link, so the same
          image archived differently depending on what the computer happened to have at that path —
          and it turned out every service {m({ children: "init" })} started had no filesystem at all
          and no way to say so. Both are fixed. Both were invisible while nothing spawned, which is
          the argument for treating this direction as well exercised rather than finished.{" "}
          <A href={`${BLOB}/design/system/0001-a-self-contained-system.md`} external>design/0001</A>
        </P>
        <P>
          The desktop is the last of the eight steps and has started: a window manager written in wac
          over this system, with the terminal as one window. Its test is the one that makes it a
          system rather than a picture of one —{" "}
          {m({ children: "cd /home/wac" })} typed in the terminal moves what the files window lists.
          What is still missing is above all of it: {m({ children: "init" })} starts services and
          never stops one, and there is no restart policy, no dependency order and no readiness.
        </P>
      </Section>

      <Section id="native-host" kicker="direction two" title="A host with no JavaScript in it">
        <P>
          There were three hosts — browser, Node, Deno — and all three are JavaScript, so they share
          the transport, the worker model and the event loop. That made them poor evidence for
          portability: a design flaw common to all three is invisible from any of them. The fourth
          is <Lead>Rust on wasmtime</Lead>, with no JavaScript in the artifact and, deliberately, no
          WASI reaching the program — and it <Lead>exists now</Lead>.
        </P>
        <P>
          <Lead>It is no longer the destination, and that makes it more load-bearing rather than
          less.</Lead> The single-binary goal never needed it: {m({ children: "deno compile" })}
          produces one file too, and measured against each other on wacc compiling itself the
          wasmtime build was <Lead>3.4&times; slower</Lead> for a smaller artifact — 3.36s against
          1.02s, and that is already after a collector fix that took it down from 12.3s. So wasmtime
          is shelved as a target and kept as a host, and a Rust host on V8 becomes the primary one:
          exactly Deno&rsquo;s numbers in 63 MB against 105 MB, so a lean host and V8&rsquo;s speed
          turned out not to be a trade.
        </P>
        <P>
          The cost of that is easy to lose, so it is written here too. Four hosts are a portability
          requirement <em>because</em> browser, Node and Deno share an engine — and with a Rust host
          on V8 as well, <Lead>wasmtime becomes the only thing here that is not V8</Lead>. Keeping it
          green is what keeps the argument above true, which is why nobody is making it fast and
          everybody is keeping it passing.
        </P>
        <P>
          No WASI because the capability world already <em>is</em> the interface, and WASI would be
          a second one with different opinions — plus the thing this system cannot do without is{" "}
          {m({ children: "spawn" })}, and a wasm module cannot instantiate another wasm module. If
          the runtime cannot make a second instance, nothing later can add it.
        </P>
        <P>
          There is a second prize. Today a spawned child is confined by the <em>language</em> — wac
          has no ambient authority, so a child cannot reach what it was not handed — but arbitrary
          JavaScript in a worker can, because a worker inherits the process&rsquo;s permissions. On
          this host a child instance gets exactly the imports the parent hands it, so{" "}
          {m({ children: "spawn" })} becomes a confinement primitive rather than only a composition
          one.
        </P>
        <P>
          And a third, which may be the one that matters most.{" "}
          <Lead>A run should be reproducible, and time should be a scheduling decision rather than
          a measurement.</Lead> Everything hard about testing this system comes from interleaving —
          a zero-length write that ended a stream only when a reader happened to be parked; a corpus
          that hangs once in fifty runs and only on an idle machine. Owning the schedule buys
          replay. <em>Advancing</em> the clock when nothing is runnable buys something else: the
          transitions that take hours become milliseconds.
        </P>
        <P>
          That is not a mocked {m({ children: "now()" })}. A mocked clock lets a test <em>state</em>{" "}
          a time; a scheduler-owned one lets a test <em>pass through</em> one. Almost everything the
          Tor stack has pinned is a steady state, because every transition needs hours of wall clock
          — a time period rolling while a client looks for a service, an introduction point expiring
          with a message in flight. It is already costing accuracy rather than only coverage: the
          rotation vectors use an eight-minute period because a test network shrinks the interval to
          make rotation observable at all, so the production branch has never met a live network.
        </P>
        <State
          rows={[
            ["the toolchain, and the two mechanisms proven on a probe", "done"],
            ["the runtime itself — filesystem, spawn, network", "done"],
            ["a deterministic mode, and virtual time on top of it", "designed, not started"],
          ]}
        />
        <P>
          <Lead>The runtime arrived, and this direction is mostly finished.</Lead> The acceptance
          test was one a host cannot pass by accident — two capability requests completing{" "}
          <em>out of order</em>, waited on together, each resolving its own value, where a runtime
          that answered everything immediately would pass the types and fail that. It passes, and it
          was checked to fail: gutting the sleep so every ticket settles at once makes the test say
          so by name. <A href={`${BLOB}/issues/system/closed/0087-wacland-under-wasmtime-a-second-host-with-no-javascript.md`} external>Issue 0087</A>{" "}
          is closed, and what it bought is on{" "}
          <A href="#/checked/two-hosts">the method page</A>, because a second host is a kind of
          evidence rather than a feature.
        </P>
        <P>
          What is left here is the second half, and it is the half this direction was really for: a
          deterministic mode and a clock the scheduler owns. The seams are in rather than
          retrofitted — {m({ children: "waitAny" })} answers the first ticket in the{" "}
          <em>caller&rsquo;s</em> list rather than the first to finish, so a program&rsquo;s
          behaviour does not depend on how threads were scheduled, and a wait&rsquo;s deadline lives
          in the runtime&rsquo;s own table rather than inside a worker&rsquo;s memory, where a
          scheduler can see it. The clock is still real; it is no longer invisible.
        </P>
      </Section>

      <Section id="ethereum" kicker="direction three" title="Reading a contract without trusting whoever served it">
        <P>
          An <Lead>Ethereum-centric reference distribution</Lead>: one coherent system where a
          person can see which network backend is in use and replace it, hold an account no
          application ever sees the key for, resolve a name, read contract state <em>verified</em>{" "}
          rather than believed, and inspect a signing request before approving it.
        </P>
        <P>
          <em>Reference</em> because it is one worked example rather than a sanctioned one, and{" "}
          <em>-centric</em> because Ethereum is what it is built around rather than what it belongs
          to. Nobody has blessed this and nobody needs to — which is also why the core exposes
          nothing Ethereum-shaped, and why no contract holds automatic authority over the system.
        </P>
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
        <P>
          Most of the read path exists, and <A href="#/stack/ethereum">the stack page</A> has the
          numbers. Signing is last on purpose, and not because it is hard: it is the first thing
          here that touches secret material, so it gets a different gate.
        </P>
        <Caveat title="What the signing gate means">
          Every secret-consuming routine under a constant-time trace from its <em>first</em> commit
          rather than retrofitted, with structured keys rather than random ones; constant-time
          inversion or blinding chosen by construction, because the trace is dynamic and a pass is
          necessary rather than sufficient; and the distribution saying plainly what has and has not
          been reviewed, for as long as that is true.
        </Caveat>
        <P>
          <A href={`${BLOB}/design/system/0003-an-ethereum-centric-reference-distribution.md`} external>design/0003</A>
        </P>
      </Section>

      <Section id="packages" kicker="direction four" title="Packages, and the version diamond wac cannot have">
        <P>
          Every import is a relative file path, plus one that is not: {m({ children: "core" })}, the
          module the compiler ships.
        </P>
        <Code code={CORE} />
        <P>
          That is the first provider of a mechanism meant to grow: a prefix resolving to a set of
          wac sources that need not be files on disk — an embedded module, a checkout beside you, or
          one day a fetched package. The next step is the directory kind, which is what lets a
          library live in its own repository at all.
        </P>
        <P>
          The constraint worth knowing now, because it decides what a package service can be:{" "}
          <Lead>wac has nominal types and no closures</Lead>, so two identical declarations are two
          types and nothing can convert between them. Cargo tolerates two versions of a crate in one
          build because Rust has closures and the seam can usually be converted; here the call
          cannot be made at all. So a package system on top of this has to resolve <em>flat</em> —
          one version of each package globally, closer to Go than to npm. Deciding that now costs a
          paragraph; discovering it later costs a manifest format.
        </P>
        <State
          rows={[
            ["`core`, embedded in the compiler", "done"],
            ["a directory provider — a package in its own repo", "not started"],
            ["a package service", "a destination, not a plan"],
          ]}
        />
        <P>
          <A href={`${WAC_DESIGN}/0001-import-resolution-core-and-what-packages-inherit.md`} external>wac design/0001</A>
        </P>
      </Section>

      <Section id="not-this" kicker="the other list" title="What is deliberately not on it">
        <P>
          A package manager with a website. A standard library that grows by accretion. Anything
          that requires a maintainer&rsquo;s permission. The compiler is dependency-free TypeScript
          and the point of every direction above is to keep the number of things you have to trust
          small enough to read — a claim that gets harder to hold, not easier, as the list gets
          longer.
        </P>
      </Section>
    </Page>
  );
}
