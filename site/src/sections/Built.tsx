// What has been built in wac, and the idea that made applications possible.
//
// Merged in from the wac-showcase page. Its argument is the one this site was missing: a language
// is persuasive because of what people finish in it, and there are two dozen packages and no
// TypeScript in any of their `src/`.
//
// The table's numbers come from `src/data/built.ts`, generated from wac-mono's own generated
// MAP.md — see `tools/syncMap.ts`. Nothing here is typed in by hand, because a hand-typed
// inventory of two dozen packages is wrong within the week.

import { useEffect, useState } from "react";
import { BUILT, TOTALS } from "../data/built";
import { CodeBlock, fn_, MONO, s, tp } from "../theme";

/** Where a demo's source and build instructions live, for the links beside each one. */
const MONO_SRC = "https://github.com/voltrevo/wac-mono/blob/master/packages";

/**
 * How big each demo turned out, fetched rather than compiled in.
 *
 * The demos are build output from another repository — `tools/syncDemos.ts` builds them into
 * `public/`, and CI runs it — so their sizes are not knowable when this file is compiled. Written
 * beside them as `demos.json` and read at runtime, which means the numbers are always the numbers of
 * the pages actually being served, and a checkout without them simply shows no number.
 */
function useDemoSizes(): Record<string, string> {
  const [sizes, setSizes] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    fetch("demos.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((v) => { if (live) setSizes(v as Record<string, string>); })
      .catch(() => {});   // no demos built here; the links are still right
    return () => { live = false; };
  }, []);
  return sizes;
}

/** Rounded, because this repo's Pages build cannot check them. See `src/data/built.ts`. */
function about(n: number): string {
  if (n >= 10000) return `~${Math.round(n / 1000)}k`;
  if (n >= 200) return `~${Math.round(n / 100) * 100}`;
  return String(n);
}

const WC = `import { Cli, Core, FileResult } from "../src/platform.wac";

export i32 main(Core core, Cli cli) {
  u8[] data = u8[0]();
  string label = "";
  if (cli.argCount().wait() < 1) {
    data = cli.readStdin().wait();
  } else {
    label = cli.arg(0).wait();
    FileResult f = cli.readFile(label).wait();
    if (!f.ok) {
      core.warn("wc: " + label + ": " + f.error);
      return 1;
    }
    data = f.bytes;
  }

  Counts c = count(data);
  core.log(itoa(c.lines) + " " + itoa(c.words) + " " + itoa(c.bytes));
  return 0;
}`;

const SHEBANG = `#!/usr/bin/env -S deno run                    # no capabilities
#!/usr/bin/env -S deno run --allow-read       # built with --allow-read`;

export default function Built() {
  const sizes = useDemoSizes();
  return (
    <>
      <div style={s.section} id="built">
        <h2 style={s.h2}>What has been built in it</h2>
        <p style={s.p}>
          The argument for a language is what people finish in it.{" "}
          <a href={MONO} target="_blank" rel="noopener" style={{ color: "#60a5fa" }}>wac-mono</a>{" "}
          is {TOTALS.packages} packages in dependency order — nothing imports anything above it —
          totalling {about(TOTALS.lines)} lines of wac and {about(TOTALS.tests)} tests, with{" "}
          <strong style={{ color: "#e2e8f0" }}>no TypeScript in any package's {tp("src/")}</strong>.
          Each was written because the layer under it needed something.
        </p>

        <div style={{ border: "1px solid #2e2e3e", borderRadius: 6, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                {["package", "what it is", "lines", "tests"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i > 1 ? "right" : "left",
                      padding: "8px 12px",
                      color: "#6b7280",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontSize: 11,
                      background: "#181825",
                      borderBottom: "1px solid #2e2e3e",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BUILT.map((p) => (
                <tr key={p.name}>
                  <td
                    style={{
                      padding: "7px 12px",
                      fontFamily: "monospace",
                      color: "#2dd4bf",
                      borderBottom: "1px solid #1e1e2e",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <a
                      href={`${MONO}/tree/master/packages/${p.name}`}
                      target="_blank"
                      rel="noopener"
                      style={{ color: "inherit", textDecoration: "none", borderBottom: "1px dotted #2dd4bf66" }}
                    >
                      {p.name}
                    </a>
                  </td>
                  <td style={{ padding: "7px 12px", color: "#9ca3af", borderBottom: "1px solid #1e1e2e" }}>
                    {p.what}
                  </td>
                  {[p.lines, p.tests].map((n, i) => (
                    <td
                      key={i}
                      style={{
                        padding: "7px 12px",
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontVariantNumeric: "tabular-nums",
                        color: "#6b7280",
                        borderBottom: "1px solid #1e1e2e",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {n.toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...s.codeLabel, marginTop: 8 }}>
          from wac-mono's generated map · {TOTALS.programs} command-line programs and{" "}
          {TOTALS.pages} browser pages built from them
        </div>
      </div>

      <div style={s.section} id="capabilities">
        <h2 style={s.h2}>Capabilities, because imports name files</h2>
        <p style={s.p}>
          wac's {kwImport} reads another {tp(".wac")} file and does nothing else. There is no{" "}
          {tp("extern")}, no declaration form, no way to write down the name of a function that
          lives outside the program — so the only host code a module can call is a value someone
          handed it.
        </p>
        <p style={s.p}>
          A module that takes no {tp("fn[…]")} parameter therefore has{" "}
          <strong style={{ color: "#e2e8f0" }}>no wasm imports at all</strong> — not "none that it
          uses", none in the binary. That is checkable by reading the import section, and there is
          a test that reads it.
        </p>
        <p style={s.p}>
          Take it seriously and a whole program is a function that takes the world as parameters.
          Here is an entire application; there is no TypeScript in its directory.
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>platform/example/wc.wac · a complete program</div>
          <CodeBlock code={WC} lang="wac" />
        </div>
        <p style={s.p}>
          Behind that {fn_("readFile")}{tp(".wait()")} the host is doing{" "}
          {tp("await Deno.readFile")} on another thread while this one is parked. Asynchronous
          work, called synchronously, with none of the colouring that usually spreads through
          everything that reaches it.
        </p>

        <h3 style={s.h3}>A filesystem is a value, not the machine</h3>
        <p style={s.p}>
          The newest package takes that one step further. Every filesystem capability a program had
          was the <em>host&rsquo;s</em>, so an SSH session got the real disk of whatever ran the
          daemon and a browser terminal got the tab&rsquo;s storage. {tp("packages/fs")} is a
          filesystem that belongs to the program instead — {tp("Fs.inMemory(now)")} holds nothing but
          what you put in it, {tp("Fs.onHost(cli, now)")} reaches the real one <em>by asking</em>,
          and a mount table resolves by longest prefix so the two compose.
        </p>
        <p style={s.p}>
          It is one concrete type with the branch written by hand, not an interface with two
          implementations, and the reason is a language constraint worth knowing: dispatch is static,
          so a base-typed {tp("Fs")} would always run the base&rsquo;s bodies — and a funcref cannot
          capture a filesystem, because there are no closures. The test is the interesting part
          though: <strong style={{ color: "#e2e8f0" }}>the same script of operations runs against
          memory and against Deno, and the transcripts must match</strong>. Whatever the real thing
          does to a sequence of writes, listings, renames and removals is what a filesystem <em>is</em>;
          a memory version that disagrees is wrong even when its own tests pass.
        </p>

        <h3 style={s.h3}>Granted at build, not at run</h3>
        <p style={s.p}>
          The built program takes no permission flags of its own and every argument goes to the
          application. Whoever packages it decides what it may do; whoever runs it cannot widen
          that. The shebang is exactly the grants, so the answer is readable with{" "}
          {tp("head -1")}:
        </p>
        <div style={{ marginBottom: 16 }}>
          <div style={s.codeLabel}>the first line of the artifact</div>
          <CodeBlock code={SHEBANG} lang="ts" />
        </div>
        <h3 style={s.h3} id="demos">Run one in this browser</h3>
        <p style={s.p}>
          These are whole applications, not snippets: a wac program on a worker, talking to a
          capability world on the page's own thread. Each file is exactly what{" "}
          {tp("deno task app:build --target browser")} produces, copied unmodified — what you can
          open here is the artifact you would build yourself.
        </p>
        <div
          style={{
            display: "grid",
            gap: 1,
            background: "#2e2e3e",
            border: "1px solid #2e2e3e",
            borderRadius: 6,
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          {[
            {
              href: "shell.html",
              name: "a shell",
              source: `${MONO_SRC}/box/example/README.md#termwac`,
              what:
                "packages/sh with a keyboard in front of it, and all sixty packages/box applets as commands — sort, sha256sum, gzip, cut, diff, shuf — with pipelines, loops, variables, history, and redirection into a filesystem that survives a reload",
            },
            {
              href: "hash.html",
              name: "hash and compress",
              source: `${MONO_SRC}/box/example/README.md#hashwac`,
              what:
                "SHA-256 and DEFLATE keeping up with your typing — or with a file you drop on the page, which comes back compressed as a .gz your own gunzip will open",
            },
            {
              href: "pixels.html",
              name: "pixels",
              source: `${MONO_SRC}/platform/example/README.md#pixelswac`,
              what:
                "a Mandelbrot set recomputed on every click — it recentres where you point — with the escape count under the cursor, and the frame you are looking at downloadable as a PPM",
            },
          ].map((d) => (
            <div key={d.href} style={{ background: "#181825", padding: "12px 14px" }}>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <a
                  href={d.href}
                  style={{
                    fontFamily: "monospace",
                    color: "#2dd4bf",
                    fontSize: 14,
                    textDecoration: "none",
                  }}
                >
                  {d.name}
                  {sizes[d.href] === undefined
                    ? null
                    : <span style={{ color: "#4a4a5a" }}>{" · " + sizes[d.href]}</span>}
                </a>
                <a
                  href={d.source}
                  target="_blank"
                  rel="noopener"
                  style={{ color: "#6b7280", fontSize: 12, whiteSpace: "nowrap" }}
                >
                  source &amp; how to build it ↗
                </a>
              </div>
              <a href={d.href} style={{ color: "#9ca3af", fontSize: 14, textDecoration: "none" }}>
                {d.what}
              </a>
            </div>
          ))}
        </div>
        <p style={s.p}>
          They need {tp("SharedArrayBuffer")}, because the program parks on {tp("Atomics.wait")}{" "}
          while the page answers its calls — and that needs two response headers GitHub Pages
          cannot set. So this site registers{" "}
          <a
            href="https://github.com/gzuidhof/coi-serviceworker"
            target="_blank"
            rel="noopener"
            style={{ color: "#60a5fa" }}
          >
            a service worker
          </a>{" "}
          that re-serves itself with them. Worth knowing rather than hiding: the first visit
          reloads once while that takes effect, and a browser with service workers disabled gets a
          page that says what is missing instead of failing silently.
        </p>

        <p style={{ ...s.p, marginBottom: 0 }}>
          A spawned child gets the grants its parent chose, intersected with what the parent
          itself has — so a program can hand out one capability and can never hand out one it
          lacks. The same wac also runs in a browser tab, where the capabilities it is given
          reach the page and the Origin Private File System instead of a disk.
        </p>
      </div>
    </>
  );
}

const kwImport = <span style={{ ...s.inline, color: "#c084fc" }}>import</span>;
