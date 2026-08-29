// Using wac in a project of your own — the page the site did not have.
//
// The site could describe wac from every angle except the one a reader acts on: how to get it and
// what the first hour looks like. `docs/your-own-project.md` has had that all along, and a link at
// the bottom of the front page is not the same as a page.
//
// **This is a companion to that document, not a copy of it.** The guide runs every step in an empty
// directory and keeps what did not work, with issue numbers; it is the reference. This is the arc —
// get it, run something, hand it a capability, make it a project, build it — and it ends by sending
// the reader there. When they disagree the guide is right, which is why every claim here is one the
// guide also makes rather than a fresh one.
//
// The curl line is first because that is the question. Everything else on this site answers "is this
// real"; this page answers "what do I type".

import { A, BLOB, Caveat, Code, Lead, m, P, Page, Section, Table } from "./ui";

const GUIDE = `${BLOB}/docs/your-own-project.md`;

const EX_START_CURL = `$ curl -fsSL https://raw.githubusercontent.com/voltrevo/wac/master/bootstrap.sh \\
    | sh -s -- --host deno`;

const EX_START_HELLO = `// main.wac
import { Cli, Core } from "std/platform.wac";

export i32 main(Core core, Cli cli) {
  cli.write("hello from wac\\n".toBytes());
  return 0;
}`;

const EX_START_RUN = `$ wac run main.wac
hello from wac`;

const EX_START_CAPS = `FileResult f = cli.readFile("wac.json5").wait();
cli.write((f.ok ? "read ok\\n" : "refused\\n").toBytes());`;

const EX_START_GRANT = `$ wac run src/read.wac                 # refused   (exit 1)
$ wac run --allow-read src/read.wac    # read ok   (exit 0)`;

const EX_START_PROJECT = `// wac.json5
{
  imports: {
    'dep/': { git: 'https://github.com/voltrevo/wac', ref: 'master' },
  },
}`;

const EX_START_COMMANDS = `wac check   src/main.wac              # diagnostics, nothing written
wac run     src/main.wac [args…]      # compile to a temporary file and run
wac build   src/main.wac -o hello     # hello.wasm — one file, nothing beside it
wac hello.wasm                        # run it — the manifest says what it needs
wac test    src/math_test.wac         # or a directory
wac bindgen src/main.wac [--js]       # the glue a JavaScript host calls it through`;

export default function Start() {
  return (
    <Page current="start">
      <Section id="get" kicker="start here" title="Getting the command">
        <Lead>
          One line, no clone, and no Rust.
        </Lead>
        <Code label="installs `wac` on your PATH" lang="text" code={EX_START_CURL} />
        <P>
          That builds the compiler from source — through a ladder of five rungs whose lowest is
          hand-written wasm assembly text — and puts {m({ children: "wac" })} on your PATH. There is
          no seed to fetch and nothing from npm. {m({ children: "--host nodejs" })} is the same
          command run by node instead.
        </P>
        <P>
          Without a {m({ children: "--host" })} you get the default, a native binary on V8, which is
          faster and needs cargo and a C++ toolchain. The script checks for what it needs before it
          does any work rather than after.
        </P>
        <Table
          head={["--host", "needs", "what you get"]}
          rows={[
            [m({ children: "v8" }), "cargo, a C++ toolchain", "a native binary — the default"],
            [m({ children: "wasmtime" }), "cargo", "a native binary with no JavaScript in it"],
            [m({ children: "deno" }), "deno", "one JavaScript file with a shebang"],
            [m({ children: "nodejs" }), "node", "the same file, run by node"],
          ]}
        />
        <P>
          <b>Every host produces the same command</b>, because the command is itself a wac program —
          {" "}{m({ children: "packages/wac/src/wac.wac" })} — that the host carries. What differs is
          the engine underneath it, so the JavaScript hosts are not a cut-down version:{" "}
          <A href={`${BLOB}/packages/wacc/test/wac/commandparity_test.wac`} external>
            commandparity_test.wac
          </A>{" "}
          holds every command they share to the same output on all of them.
        </P>
        <Caveat title="sh -s -- is not decoration">
          It is how you pass arguments to a script that arrived on standard input. Without it the
          flags are read by your shell instead of by the script, and what you get is the default
          host — silently, which is the failure worth naming.
        </Caveat>
      </Section>

      <Section id="hello" kicker="the first file" title="One file, no configuration">
        <Code label="main.wac" code={EX_START_HELLO} />
        <Code lang="text" code={EX_START_RUN} />
        <P>
          {m({ children: "main" })} may take {m({ children: "()" })}, {m({ children: "(Core)" })} or
          {" "}{m({ children: "(Core, Cli)" })} — the host builds what the signature asks for and
          nothing else. Its {m({ children: "i32" })} is the process exit status.
        </P>
      </Section>

      <Section
        id="capabilities"
        kicker="what a program may do"
        title="Capabilities are handed in, never ambient"
      >
        <P>
          A program can only touch what its {m({ children: "main" })} was handed, and the command
          line decides what that is.
        </P>
        <Code code={EX_START_CAPS} />
        <Code lang="text" code={EX_START_GRANT} />
        <P>
          A refused capability <b>answers false; it does not trap</b>. So a program that never got a
          grant takes its own error path rather than dying, and you can write one that degrades
          instead of failing. Writing to standard output needs no grant;{" "}
          {m({ children: "--allow-read" })}, {m({ children: "--allow-write" })},{" "}
          {m({ children: "--allow-net" })}, {m({ children: "--allow-run" })} and{" "}
          {m({ children: "--allow-env" })} are the ones you will meet.
        </P>
      </Section>

      <Section id="project" kicker="more than one file" title="Making it a project">
        <P>
          A project is a directory with a {m({ children: "wac.json5" })} in it. An empty one is valid
          and is all you need for {m({ children: "@/" })}, which names the root of the project the{" "}
          <i>importing file</i> is in — so it does not change when you move the file. Dependencies
          are Git repositories mapped to a prefix:
        </P>
        <Code label="wac.json5" lang="ts" code={EX_START_PROJECT} />
        <P>
          {m({ children: "ref" })} is a branch or tag — what to resolve <i>when you ask</i>, which is
          what {m({ children: "wac update" })} does. It writes a lockfile, and nothing fetches
          behind your back.
        </P>
      </Section>

      <Section id="commands" kicker="the loop" title="Building, running and testing">
        <Code lang="text" code={EX_START_COMMANDS} />
        <P>
          <b>The manifest is inside the module</b>, in a {m({ children: "wac.manifest" })} custom
          section rather than a file beside it. That is what makes a built artefact one file you can
          hand to somebody: {m({ children: "wac hello.wasm" })} reads the grants out of the module and
          refuses what the module did not ask for, so there is nothing to keep in step or lose in
          transit.
        </P>
      </Section>

      <Section id="more" kicker="the reference" title="Every step, run in an empty directory">
        <P>
          <A href={GUIDE} external>docs/your-own-project.md</A> is the full version of this page and
          the thing to read next. Everything in it was run, in order, outside the repository — and
          where something does not work yet it says so and names the issue rather than being left
          out, which is the part a page like this one usually omits.
        </P>
      </Section>
    </Page>
  );
}
