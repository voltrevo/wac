// The specification, rendered: `#/spec` is the contents and `#/spec/<chapter>[/<heading>]` a chapter.
//
// Read from `spec/` as it is in the tree, at build time — nothing is generated or copied, so what this
// page shows is the spec of the commit that deployed it. Each chapter is its own chunk and is fetched
// when it is opened; the contents page needs only the README and the status files.
//
// Every ` ```wac ` fence is a program with its outcome written above it, so each one is shown with
// that outcome, with whether the compiler in the tree meets it — from `spec/_status/MET`, which the
// suite writes — and with a button that opens it in the playground.

import { useEffect, useState, type ReactNode } from "react";
import README from "../../../spec/README.md?raw";
import MET_TEXT from "../../../spec/_status/MET?raw";
import STATUS_TEXT from "../../../spec/_status/STATUS.md?raw";
import { CodeBlock, type Lang } from "../theme";
import { handOff, HOME } from "../editor/file-store";
import { BLOB, Facts, Page } from "./ui";
import { c, font, space } from "./tokens";
import {
  chaptersOf, exampleKey, filesOf, metOf, parseBlocks, parseInline, plain, routeOf, statusOf,
  type Block, type Chapter, type Fence, type Inline,
} from "./specModel";

const LOAD = import.meta.glob<string>(
  ["../../../spec/**/*.md", "!../../../spec/cases/**", "!../../../spec/_status/**", "!../../../spec/README.md"],
  { query: "?raw", import: "default" },
);

const CHAPTERS = chaptersOf(README);
const MET = metOf(MET_TEXT);
const STATUS = statusOf(STATUS_TEXT);

const loaderFor = (ch: Chapter) => LOAD[`../../../spec/${ch.path}`];

// ── Inline ──────────────────────────────────────────────────────────────────

function Inlines({ nodes, from }: { nodes: Inline[]; from: string }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text": return n.text;
      case "code":
        // A claim's tag is its address: `[§wac-const-var-7b4swc8]` links to itself.
        if (/^\[§[\w-]+\]$/.test(n.text)) {
          const tag = n.text.slice(2, -1);
          const self = CHAPTERS.find((ch) => ch.path === from);
          return (
            <a key={i} id={tag} href={`#/spec/${self?.slug ?? ""}/${tag}`} title="this claim's tag — every one names a test"
               style={{ fontFamily: font.mono, fontSize: 12, color: c.faint, textDecoration: "none", border: `1px solid ${c.line}`, borderRadius: 3, padding: "1px 6px", marginRight: 6, whiteSpace: "nowrap", scrollMarginTop: 110 }}>
              §{tag.replace(/^wac-/, "")}
            </a>
          );
        }
        return (
          <code key={i} style={{ fontFamily: font.mono, fontSize: "0.9em", color: c.text, background: c.panelHi, padding: "1px 5px", borderRadius: 3 }}>
            {n.text}
          </code>
        );
      case "strong": return <strong key={i} style={{ color: c.text, fontWeight: 600 }}><Inlines nodes={n.children} from={from} /></strong>;
      case "em": return <em key={i}><Inlines nodes={n.children} from={from} /></em>;
      case "link": {
        const r = routeOf(n.href, from, CHAPTERS, BLOB);
        return (
          <a key={i} href={r.href} {...(r.external ? { target: "_blank", rel: "noopener" } : {})}
             style={{ color: c.accent, textDecoration: "none", borderBottom: `1px solid ${c.accent}44` }}>
            <Inlines nodes={n.children} from={from} />
          </a>
        );
      }
    }
  });
}

const md = (text: string, from: string) => <Inlines nodes={parseInline(text)} from={from} />;

// ── Fences ──────────────────────────────────────────────────────────────────

function Chip({ children, color, title }: { children: ReactNode; color: string; title?: string }) {
  return (
    <span title={title} style={{ fontFamily: font.mono, fontSize: 11.5, color, border: `1px solid ${color}55`, borderRadius: 3, padding: "1px 7px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** `expect: answers f(1) = 2` → `answers f(1) = 2`; `expect (wac check): refused` → `wac check: refused`. */
const expectLabel = (e: string) => e.replace(/^expect\s*/, "").replace(/^\((.+?)\):\s*/, "$1: ").replace(/^:\s*/, "");

function langOf(lang: string): Lang {
  return lang === "wac" ? "wac" : lang === "ts" ? "ts" : "text";
}

function SpecFence({ fence, ch }: { fence: Fence; ch: Chapter }) {
  const counted = fence.ordinal !== null;
  const met = counted && MET.has(exampleKey(ch.path, fence.ordinal!));
  const files = counted ? filesOf(fence.code) : null;

  const run = () => {
    if (files === null) return;
    const dir = `${HOME}/spec/${ch.slug}-${fence.ordinal}`;
    const map: Record<string, string> = {};
    for (const f of files) map[`${dir}/${f.name}`] = f.text;
    const entry = files.find((f) => f.name === "main.wac") ?? files[0];
    handOff(map, `${dir}/${entry.name}`);
    window.location.hash = "#/playground";
  };

  return (
    <div style={{ marginBottom: space.block }}>
      {(counted || fence.lang !== "") && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center", marginBottom: 7 }}>
          <span style={{ fontFamily: font.mono, fontSize: 12, color: c.faint, marginRight: 2 }}>
            {counted ? `example ${fence.ordinal}` : fence.lang === "wac" ? "fragment" : fence.lang}
          </span>
          {fence.expects.map((e) => <Chip key={e} color={c.dim}>{expectLabel(e)}</Chip>)}
          {counted && (met
            ? <Chip color={c.accent} title="the compiler in this tree does what the example says — spec/_status/MET">met</Chip>
            : <Chip color={c.warm} title="the compiler in this tree does not yet do what the example says — spec/_status/STATUS.md">missed</Chip>)}
          {files !== null && (
            <button onClick={run} title="open this example in the playground"
                    style={{ marginLeft: "auto", fontFamily: font.mono, fontSize: 12, background: "none", color: c.accent, border: `1px solid ${c.accent}55`, borderRadius: 3, padding: "1px 9px", cursor: "pointer" }}>
              run ▸
            </button>
          )}
        </div>
      )}
      <div style={{ border: `1px solid ${met || !counted ? c.line : `${c.warm}66`}`, borderRadius: 6, overflow: "hidden" }}>
        <CodeBlock code={fence.code} lang={langOf(fence.lang)} />
      </div>
    </div>
  );
}

// ── Blocks ──────────────────────────────────────────────────────────────────

const prose = { color: c.body, fontSize: 16, lineHeight: 1.68, margin: `0 0 ${space.tight + 6}px` } as const;

function Blocks({ blocks, ch, base }: { blocks: Block[]; ch: Chapter | null; base: string }) {
  const from = ch?.path ?? "README.md";
  return blocks.map((b, i) => {
    switch (b.kind) {
      case "heading": {
        if (b.level === 1) return null;
        const style = b.level === 2
          ? { fontFamily: font.mono, fontSize: 23, fontWeight: 600, color: c.text, margin: `${space.block + 16}px 0 ${space.tight + 4}px`, lineHeight: 1.3, scrollMarginTop: 110 }
          : { fontFamily: font.mono, fontSize: 17.5, fontWeight: 600, color: c.text, margin: `${space.block}px 0 ${space.tight}px`, scrollMarginTop: 110 };
        const inner = <a href={`${base}/${b.id}`} style={{ color: "inherit", textDecoration: "none" }}>{md(b.text, from)}</a>;
        return b.level === 2 ? <h2 key={i} id={b.id} style={style}>{inner}</h2> : <h3 key={i} id={b.id} style={style}>{inner}</h3>;
      }
      case "para": return <p key={i} style={prose}>{md(b.text, from)}</p>;
      case "list": {
        const items = b.items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{md(it, from)}</li>);
        const style = { ...prose, paddingLeft: 22 };
        return b.ordered ? <ol key={i} style={style}>{items}</ol> : <ul key={i} style={style}>{items}</ul>;
      }
      case "table":
        return (
          <div key={i} style={{ border: `1px solid ${c.line}`, borderRadius: 6, overflowX: "auto", marginBottom: space.block }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
              <thead>
                <tr>
                  {b.head.map((h, j) => (
                    <th key={j} style={{ textAlign: b.align[j] ?? "left", padding: "8px 12px", background: c.panel, borderBottom: `1px solid ${c.line}`, color: c.faint, fontFamily: font.mono, fontSize: 11.5, fontWeight: 600 }}>
                      {md(h, from)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ padding: "8px 12px", borderBottom: `1px solid ${c.line}`, color: j === 0 ? c.text : c.body, textAlign: b.align[j] ?? "left", verticalAlign: "top", lineHeight: 1.5 }}>
                        {md(cell, from)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "fence": return <SpecFence key={i} fence={b.fence} ch={ch ?? README_CHAPTER} />;
    }
  });
}

/** The README as a chapter, for the one example its conventions section shows. */
const README_CHAPTER: Chapter = { slug: "readme", path: "README.md", num: "", title: "wac", part: "" };

// ── Pages ───────────────────────────────────────────────────────────────────

function statusLine(path: string): ReactNode {
  const s = STATUS.docs.get(path);
  if (s === undefined || s.examples === 0) return <span style={{ color: c.faint }}>no examples</span>;
  if (s.met === s.examples) return <span style={{ color: c.dim }}>{s.examples} {s.examples === 1 ? "example" : "examples"}, <span style={{ color: c.accent }}>all met</span></span>;
  return <span style={{ color: c.dim }}>{s.examples} examples, {s.met} met, <span style={{ color: c.warm }}>{s.examples - s.met} not yet</span></span>;
}

function Contents() {
  const README_BLOCKS = parseBlocks(README);
  const intro = README_BLOCKS.slice(0, README_BLOCKS.findIndex((b) => b.kind === "heading" && b.level === 2));
  const conv = README_BLOCKS.findIndex((b) => b.kind === "heading" && b.text === "Conventions");
  const parts = [...new Set(CHAPTERS.map((ch) => ch.part))];
  const t = STATUS.total;

  return (
    <Page current="spec" contents={false}>
      <div style={{ fontFamily: font.mono, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: c.faint, marginBottom: 10 }}>the specification</div>
      <h1 style={{ fontFamily: font.mono, fontSize: 32, fontWeight: 600, color: c.text, letterSpacing: "-0.02em", margin: `0 0 ${space.block}px` }}>
        wac, as it is defined
      </h1>
      <Blocks blocks={intro} ch={null} base="#/spec" />
      <Facts rows={[
        ["chapters", String(CHAPTERS.filter((ch) => /^\d+$/.test(ch.num)).length)],
        ["example programs", String(t.examples)],
        ["met by the compiler", String(t.met)],
      ]} />
      <p style={{ ...prose, fontSize: 14.5, color: c.dim }}>
        &ldquo;Met&rdquo; is measured, not claimed: the suite compiles every example against the
        compiler in the tree and writes the answer to{" "}
        <a href={`${BLOB}/spec/_status/STATUS.md`} target="_blank" rel="noopener" style={{ color: c.accent, textDecoration: "none" }}>spec/_status</a>,
        which this page reads at build time.{t.missed > 0 ? ` The ${t.missed === 1 ? "one it misses is" : `${t.missed} it misses are`} marked where ${t.missed === 1 ? "it sits" : "they sit"}.` : ""}
      </p>

      {parts.map((part) => (
        <div key={part} style={{ marginBottom: space.block + 6 }}>
          <h2 id={plain(part).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}
              style={{ fontFamily: font.mono, fontSize: 15, fontWeight: 600, color: c.faint, letterSpacing: "0.04em", margin: `0 0 10px`, scrollMarginTop: 110 }}>
            {part}
          </h2>
          <div style={{ border: `1px solid ${c.line}`, borderRadius: 6, overflow: "hidden" }}>
            {CHAPTERS.filter((ch) => ch.part === part).map((ch, i) => (
              <a key={ch.slug} href={`#/spec/${ch.slug}`}
                 style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "9px 14px", borderTop: i === 0 ? "none" : `1px solid ${c.line}`, textDecoration: "none", background: c.bg }}>
                <span style={{ fontFamily: font.mono, fontSize: 13, color: c.faint, width: 22, flexShrink: 0 }}>{ch.num}</span>
                <span style={{ color: c.text, fontSize: 15.5, flex: 1 }}>{ch.title}</span>
                <span style={{ fontFamily: font.mono, fontSize: 12 }}>{statusLine(ch.path)}</span>
              </a>
            ))}
          </div>
        </div>
      ))}

      {conv >= 0 && <Blocks blocks={README_BLOCKS.slice(conv)} ch={null} base="#/spec" />}
    </Page>
  );
}

function ChapterPage({ ch, anchor }: { ch: Chapter; anchor: string | null }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setText(null);
    setFailed(false);
    const load = loaderFor(ch);
    if (load === undefined) { setFailed(true); return; }
    load().then((t) => { if (live) setText(t); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [ch]);

  // The router scrolls before the chapter has arrived, so the chapter scrolls itself once it has.
  useEffect(() => {
    if (text === null) return;
    if (anchor === null) { window.scrollTo(0, 0); return; }
    const id = setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 60);
    return () => clearTimeout(id);
  }, [text, anchor]);

  const at = CHAPTERS.indexOf(ch);
  const prev = at > 0 ? CHAPTERS[at - 1] : null;
  const next = at + 1 < CHAPTERS.length ? CHAPTERS[at + 1] : null;
  const blocks = text === null ? [] : parseBlocks(text);
  const h1 = blocks.find((b) => b.kind === "heading" && b.level === 1);
  const heads = blocks.filter((b): b is Extract<Block, { kind: "heading" }> => b.kind === "heading" && b.level > 1);
  const base = `#/spec/${ch.slug}`;

  return (
    <Page current="spec" contents={false}>
      <div style={{ fontFamily: font.mono, fontSize: 12.5, color: c.faint, marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a href="#/spec" style={{ color: c.dim, textDecoration: "none" }}>spec</a>
        <span>/</span>
        <span>{ch.part}</span>
      </div>
      <h1 style={{ fontFamily: font.mono, fontSize: 30, fontWeight: 600, color: c.text, letterSpacing: "-0.02em", margin: `0 0 8px` }}>
        {h1 !== undefined && h1.kind === "heading" ? md(h1.text, ch.path) : `${ch.num} — ${ch.title}`}
      </h1>
      <div style={{ fontFamily: font.mono, fontSize: 12.5, marginBottom: space.block, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {statusLine(ch.path)}
        <a href={`${BLOB}/spec/${ch.path}`} target="_blank" rel="noopener" style={{ color: c.faint, textDecoration: "none" }}>source ↗</a>
      </div>

      {failed && <p style={prose}>This chapter could not be loaded.</p>}
      {text === null && !failed && <p style={{ ...prose, color: c.faint }}>loading…</p>}

      {heads.length >= 4 && (
        <nav aria-label="Contents" style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "12px 16px", marginBottom: space.block + 8 }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, columns: "2 230px", columnGap: 26 }}>
            {heads.map((h) => (
              <li key={h.id} style={{ breakInside: "avoid", marginBottom: 2 }}>
                <a href={`${base}/${h.id}`} style={{ color: h.level === 3 ? c.dim : c.text, fontSize: h.level === 3 ? 13 : 14, textDecoration: "none", paddingLeft: h.level === 3 ? 14 : 0, lineHeight: 1.6 }}>
                  {plain(h.text)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <Blocks blocks={blocks} ch={ch} base={base} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderTop: `1px solid ${c.line}`, marginTop: space.section, paddingTop: 18, fontFamily: font.mono, fontSize: 13.5 }}>
        {prev ? <a href={`#/spec/${prev.slug}`} style={{ color: c.dim, textDecoration: "none" }}>← {prev.num} {prev.title}</a> : <span />}
        {next ? <a href={`#/spec/${next.slug}`} style={{ color: c.dim, textDecoration: "none", textAlign: "right" }}>{next.num} {next.title} →</a> : <span />}
      </div>
    </Page>
  );
}

export default function Spec({ chapter, anchor }: { chapter: string | null; anchor: string | null }) {
  const ch = chapter === null ? undefined : CHAPTERS.find((x) => x.slug === chapter);
  if (ch === undefined) return <Contents />;
  return <ChapterPage ch={ch} anchor={anchor} />;
}
