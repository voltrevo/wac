// Things you can run in this tab, right now.
//
// The old site had these three demos in a subsection near the bottom of a long page, and the first
// draft of this rewrite dropped them entirely — which was the worst call in it. A reader who
// believes nothing else on this site can type into a shell that *is* the wac program, in their own
// browser, and find out. That is the strongest evidence here and it belongs on its own page.
//
// Sizes are fetched at run time from `demos.json`, written beside the pages by `site/tools/syncDemos.ts`
// when CI builds them. So the number beside a demo is that build's, and a checkout
// without them shows the links and no number rather than a stale one.

import { useEffect, useState } from "react";
import InlineDemo from "../editor/InlineDemo";
import Bootstrap from "../editor/Bootstrap";
import Maze from "../editor/Maze";
import { EX_ENUM } from "../snippets";
import { TOTALS } from "../data/built";
import { BLOB, A, Caveat, Code, Lead, m, P, Page, Section, Table } from "./ui";
import { ASSETS, c, font, space } from "./tokens";



const DEMOS: { file: string; title: string; what: string; src: string; key: string }[] = [
  {
    file: `${ASSETS}shell.html`,
    key: "shell",
    title: "A shell, in a tab",
    src: `${BLOB}/packages/box/example/term.wac`,
    what:
      `packages/sh with a keyboard in front of it, and all ${TOTALS.applets} packages/box applets as commands — sort, sha256sum, gzip, cut, diff, shuf — with pipelines, loops, variables, history, and redirection into a filesystem that survives a reload.`,
  },
  {
    file: `${ASSETS}desk.html`,
    key: "desk",
    title: "A desktop, in a tab",
    src: `${BLOB}/packages/box/example/desk.wac`,
    what:
      "design/0001's eighth and last step: a window manager written in wac, over the same system the " +
      "shell above runs on. A window is markup rather than pixels — a terminal drawn on a canvas " +
      "would mean reimplementing text layout, selection and the caret to get something worse than the " +
      "browser already has. Each window and each terminal is a component, so typing renders one " +
      "terminal and dragging moves one frame. Type `cd /home/wac` in the terminal and the files window " +
      "follows it.",
  },
  {
    file: `${ASSETS}hash.html`,
    key: "hash",
    title: "Hash and compress, as you type",
    src: `${BLOB}/packages/box/example/hash.wac`,
    what:
      "SHA-256 and DEFLATE keeping up with your keystrokes — or with a file you drop on the page, which comes back compressed as a .gz your own gunzip will open.",
  },
  {
    file: `${ASSETS}pixels.html`,
    key: "pixels",
    title: "A Mandelbrot set, recomputed on every zoom",
    src: `${BLOB}/packages/platform/example/pixels.wac`,
    what:
      "Pixels computed in wac and blitted to a canvas, with the escape count under the pointer and a dropped file handed straight back.",
  },
  {
    file: `${ASSETS}ripple.html`,
    key: "ripple",
    title: "A ripple tank",
    src: `${BLOB}/packages/platform/example/ripple.wac`,
    what:
      "Click the water. The wave equation over 200x150 cells, in fixed-point integers so every " +
      "machine gets the same frame — waves reflect off the walls with their phase inverted and " +
      "interfere with each other, because that is what the equation does rather than something drawn " +
      "to look like it. It proves nothing and says so; the millisecond counter is the only real claim.",
  },
  {
    file: `${ASSETS}life.html`,
    key: "life",
    title: "Life, from a file you drop",
    src: `${BLOB}/packages/platform/example/life.wac`,
    what:
      "Conway's rule over 128x96 cells, seeded from any file you give it — one bit per cell. The " +
      "interesting part is how unalike the results are: a structured file settles into gliders and " +
      "blocks within twenty generations, and a compressed one churns for hundreds, because a .zip is " +
      "the closest thing on your disk to random soup.",
  },
  {
    file: `${ASSETS}gitpack.html`,
    key: "gitpack",
    title: "A packfile, opened in a tab",
    src: `${BLOB}/packages/git/example/gitpage.wac`,
    what:
      "Drop `.git/objects/pack/pack-*.pack` from any repository on your machine. The index is thrown " +
      "away in a pack, so packages/git rebuilds it — every object header, every zlib stream, every delta " +
      "resolved against what came before — and then reads commits and trees out of it. There is no " +
      "network here and none is needed: a page cannot open a socket, which is why the half that needs " +
      "one is missing and the harder half is not.",
  },
  {
    file: `${ASSETS}wacc.html`,
    key: "wacc",
    title: "The self-hosted compiler, in a tab",
    src: `${BLOB}/packages/wacc/example/waccpage.wac`,
    what:
      "The playground below runs the *reference* compiler, which is TypeScript. This one runs wacc: " +
      "the compiler written in wac, compiled to WebAssembly, doing the compiling itself. It also " +
      "reads the import section back out of what it just emitted, which is the one claim this whole " +
      "system rests on: a module that takes no function parameter has no import section at all. " +
      "Three buttons show the rule — none, one, and two exports sharing a signature, which still " +
      "import a single dispatcher because it is per signature rather than per parameter.",
  },
];

/** The built size of each demo, or nothing if this checkout has not built them. */
function useSizes(): Record<string, string> {
  const [sizes, setSizes] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    fetch(`${ASSETS}demos.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((v) => { if (live) setSizes(v as Record<string, string>); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return sizes;
}

export default function Run() {
  const sizes = useSizes();
  return (
    <Page current="run">
      <Section id="top" kicker="run it here" title={`${DEMOS.length} whole applications, in this browser`}>
        <P>
          These are not snippets and not a sandbox pretending to be one. Each is a complete wac
          program, compiled to wasm and built into one HTML file. <Lead>Each file is exactly what
          its builder produces, copied unmodified</Lead> — the same builder a project of your own
          uses, so what you open here is the artifact you would build yourself.
        </P>
        <div style={{ display: "grid", gap: 14, marginBottom: space.block }}>
          {DEMOS.map(({ file, title, what, src, key }) => (
            <a
              key={file}
              href={file}
              style={{ display: "block", border: `1px solid ${c.line}`, borderRadius: 6, padding: "16px 18px", textDecoration: "none", background: c.panel }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 7, flexWrap: "wrap" }}>
                <span style={{ fontFamily: font.mono, fontSize: 16, color: c.accent }}>{title} →</span>
                {sizes[key] !== undefined && (
                  <span style={{ fontFamily: font.mono, fontSize: 12, color: c.faint }}>{sizes[key]}</span>
                )}
              </div>
              <div style={{ color: c.dim, fontSize: 14.5, lineHeight: 1.55 }}>{what}</div>
              <div style={{ fontFamily: font.mono, fontSize: 12, color: c.faint, marginTop: 8 }}>
                source: {src.replace(`${BLOB}/`, "")}
              </div>
            </a>
          ))}
        </div>
        <P>
          The shell is the one to try first, and the thing to notice is that nothing about it is a
          demonstration build. It is {m({ children: "packages/sh" })} — the shell that agrees with
          GNU bash on {TOTALS.corpus} differential scripts — with a terminal in front of it, and the commands
          are the same {TOTALS.applets} applets that run on a command line. Type {m({ children: "seq 1 20 | grep 7 | wc -l" })}.
        </P>
      </Section>

      <Section id="how" kicker="what makes it possible" title="An await, a page, and processes as workers">
        <P>
          These are {m({ children: "packages/web" })} pages: {m({ children: "main(Page page)" })}, an{" "}
          {m({ children: "async" })} function in a worker. It changes the document with plain calls
          and waits for the next click, frame or file with {m({ children: "await" })}, and each wait
          hands control back until something arrives. State is ordinary locals, the program reads
          top to bottom, a long computation never freezes the tab, and the page needs nothing from
          the server that serves it.
        </P>
        <P>
          The shell and the desktop are the same kind of page, handed a{" "}
          {m({ children: "Sys" })} as well: files in the browser&rsquo;s own storage, read with the
          same {m({ children: "await" })} a command-line program uses. Each command they run is a
          copy of the page started as a process — a worker of its own, streaming to the next stage
          of the pipeline by messages and asking the shell for files the same way. Nothing shares
          memory, so nothing needs the cross-origin-isolation headers static hosting cannot send.
        </P>
      </Section>

      <Section id="maze" kicker="a puzzle, not a demo" title="Write a program that gets the robot out">
        <P>
          The maze arrives as an argument, so you cannot hardcode a route you have not been shown —
          you have to write something that reads it. Your {m({ children: "solve" })} is compiled here,
          run in a worker with a deadline, and the route it returns is <em>replayed against the maze</em>
          before the robot moves: a step into a wall fails with the step that did it, rather than
          quietly ending somewhere plausible.
        </P>
        <Maze />
        <Caveat title="what it is checking">
          Not that the last square is the goal — a robot that walked through a wall to get there would
          pass that. Every step is validated, which is what makes an off-by-one in your bounds check
          show up as <em>step 7 walked into a wall</em> instead of a silent success.
        </Caveat>
      </Section>

      <Section id="bootstrap" kicker="the one that needs running" title="wacc compiling itself, here">
        <P>
          <Lead>A compiler that reproduces itself is what a bootstrap means, and nothing short of
          running it can show that.</Lead> A ladder of five rungs runs here in the page — the lowest
          is hand-written wasm assembly text, and each one compiles the next — until wac-L5 compiles
          wacc&rsquo;s own <A href={`${BLOB}/packages/wacc/src`}>sources</A> into stage A. A compiles
          them into B. B compiles them into C. If wacc is a compiler that reproduces itself, B and C
          are the same bytes.
        </P>
        <P>
          <Lead>No compiler written in another language takes part in any of it.</Lead> This used to
          start from a TypeScript reference compiler bundled into the page; that compiler was deleted
          on 2026-08-28 and the ladder is the whole story now, which is the stronger claim anyway.
        </P>
        <P>
          It runs on your machine, in this tab, and takes a second or two. The suite settles the same
          claim in{" "}
          <A href={`${BLOB}/packages/wacc/test/wac/selfhost_test.wac`}>selfhost_test.wac</A>, and{" "}
          <A href={`${BLOB}/bootstrap.sh`}>bootstrap.sh</A> refuses to install a build that never
          settles — this is that argument with the reader holding the evidence instead of being told
          it.
        </P>
        <Bootstrap />
        <Caveat title="what the page has to fetch, and why">
          The page fetches wacc&rsquo;s sources and one small glue file, because{" "}
          {m({ children: "wacBindgen" })} emits TypeScript with a wasm binary baked into it — and
          stage B&rsquo;s bytes do not exist until stage A has run.{" "}
          <A href={`${BLOB}/tools/syncBootstrap.ts`}>tools/syncBootstrap.ts</A> generates that glue
          once with the binary replaced by a placeholder and transpiles it, so the page can substitute
          each stage&rsquo;s own bytes. One glue serves every stage because every stage has the same
          interface.
        </Caveat>
      </Section>

      <Section id="playground" kicker="or write your own" title="The compiler, in the page">
        <P>
          The playground compiles entirely client-side — no server, nothing to install, and no
          upload of what you type. Everything on this site that has a Run button uses the same
          pipeline the command line uses.
        </P>
        <InlineDemo initialCode={EX_ENUM} />
        <div style={{ height: space.block }} />
        <P>
          <A href="#/playground">The full playground</A>, with a file tree, several files at once,
          and the examples — including one that imports {m({ children: "core" })}, and one written
          in the indentation surface.
        </P>
      </Section>
    </Page>
  );
}
