// Things you can run in this tab, right now.
//
// The old site had these three demos in a subsection near the bottom of a long page, and the first
// draft of this rewrite dropped them entirely — which was the worst call in it. A reader who
// believes nothing else on this site can type into a shell that *is* the wac program, in their own
// browser, and find out. That is the strongest evidence here and it belongs on its own page.
//
// Sizes are fetched at run time from `demos.json`, written beside the pages by `tools/syncDemos.ts`
// when CI builds them. So the number beside a demo is that build's, and a checkout
// without them shows the links and no number rather than a stale one.

import { useEffect, useState } from "react";
import InlineDemo from "../editor/InlineDemo";
import { EX_ENUM } from "../snippets";
import { TOTALS } from "../data/built";
import { BLOB, A, Code, Lead, m, P, Page, Section, Table } from "./ui";
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
      <Section id="top" kicker="run it here" title="Three whole applications, in this browser">
        <P>
          These are not snippets and not a sandbox pretending to be one. Each is a complete wac
          program, compiled to wasm, running on a worker, talking to a capability world on the
          page&rsquo;s own thread. <Lead>Each file is exactly what{" "}
          {m({ children: "deno task app:build --target browser" })} produces, copied
          unmodified</Lead> — what you open here is the artifact you would build yourself.
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

      <Section id="how" kicker="what makes it possible" title="A worker, a page, and a shared buffer">
        <P>
          A wac program expects to make a call and get an answer. The host&rsquo;s answers are
          asynchronous, and a browser cannot block the page&rsquo;s thread. So the program runs on a
          worker and parks on {m({ children: "Atomics.wait" })} against a{" "}
          {m({ children: "SharedArrayBuffer" })} while the page does the work and writes the reply
          back — asynchronous work, called synchronously, with none of the colouring that usually
          spreads through everything that touches it.
        </P>
        <P>
          That is also why this site registers a service worker: a{" "}
          {m({ children: "SharedArrayBuffer" })} needs cross-origin isolation headers, and static
          hosting cannot set them, so the page re-serves itself with the headers it needs and
          reloads once. It is the reason a demo works here at all rather than a detail of the demo.
        </P>
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
