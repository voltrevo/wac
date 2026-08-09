// The pieces every page of the rewrite is built from.
//
// Deliberately few. A site that is arguing from evidence wants a small number of shapes used
// consistently — a section, a table of facts, a code frame, a caveat — because the reader learns
// what each one means once and then reads the content instead of the furniture.

import { useEffect, useState, type ReactNode } from "react";
import { CodeBlock, type Lang } from "../theme";
import { c, font, COLUMN, space } from "./tokens";

export const GITHUB = "https://github.com/voltrevo/wac";
/** A directory in the repository, and a file in it. The language and the packages were two
 *  repositories until 2026-08-09; every link on this site pointed into whichever one it meant. */
export const TREE = `${GITHUB}/tree/master`;
export const BLOB = `${GITHUB}/blob/master`;

export type Route = "home" | "language" | "run" | "stack" | "checked" | "roadmap" | "playground";

export const PAGES: { route: Route; href: string; label: string }[] = [
  { route: "language", href: "#/language", label: "the language" },
  { route: "run", href: "#/run", label: "run it here" },
  { route: "stack", href: "#/stack", label: "the stack" },
  { route: "checked", href: "#/checked", label: "how it is checked" },
  { route: "roadmap", href: "#/roadmap", label: "where this is going" },
];

// ── Text primitives ─────────────────────────────────────────────────────────

/** Inline code. */
export function m({ children }: { children: ReactNode }) {
  return (
    <code style={{ fontFamily: font.mono, fontSize: "0.92em", color: c.text, background: c.panelHi, padding: "1px 5px", borderRadius: 3 }}>
      {children}
    </code>
  );
}

/** A value the reader is meant to weigh: a count, a rate, a size. */
export function n({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: font.mono, color: c.accent, fontVariantNumeric: "tabular-nums" }}>{children}</span>;
}

export function A({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      style={{ color: c.accent, textDecoration: "none", borderBottom: `1px solid ${c.accent}44` }}
    >
      {children}
    </a>
  );
}

export function P({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <p style={{ color: c.body, fontSize: 17, lineHeight: 1.68, margin: `0 0 ${space.block}px`, maxWidth: wide ? "none" : "72ch" }}>
      {children}
    </p>
  );
}

/** A phrase the page would be worse without. Used sparingly, or it stops meaning anything. */
export function Lead({ children }: { children: ReactNode }) {
  return <strong style={{ color: c.text, fontWeight: 600 }}>{children}</strong>;
}

// ── Structure ───────────────────────────────────────────────────────────────

export function Section({ id, title, kicker, children }: { id: string; title?: string; kicker?: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: space.section }}>
      {kicker !== undefined && (
        <div style={{ fontFamily: font.mono, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: c.faint, marginBottom: 10 }}>
          {kicker}
        </div>
      )}
      {title !== undefined && (
        <h2 id={id} style={{ fontFamily: font.mono, fontSize: 27, fontWeight: 600, color: c.text, letterSpacing: "-0.02em", margin: `0 0 ${space.block}px`, lineHeight: 1.25, scrollMarginTop: 72 }}>
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function Sub({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: space.section - 24 }}>
      <h3 id={id} style={{ fontFamily: font.mono, fontSize: 19, fontWeight: 600, color: c.text, margin: `0 0 14px`, scrollMarginTop: 72 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

/** A labelled code frame. The label says where the code is from, which is the point. */
export function Code({ label, code, lang = "wac" }: { label?: string; code: string; lang?: Lang }) {
  return (
    <div style={{ marginBottom: space.block }}>
      {label !== undefined && (
        <div style={{ fontFamily: font.mono, fontSize: 12, color: c.faint, marginBottom: 6 }}>{label}</div>
      )}
      <div style={{ border: `1px solid ${c.line}`, borderRadius: 6, overflow: "hidden" }}>
        <CodeBlock code={code} lang={lang} />
      </div>
    </div>
  );
}

/** Two code frames side by side, stacking on a narrow screen. */
export function Pair({ left, right, leftLabel, rightLabel, leftLang = "wac", rightLang = "wac" }: {
  left: string; right: string; leftLabel: string; rightLabel: string; leftLang?: Lang; rightLang?: Lang;
}) {
  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", marginBottom: space.block }}>
      <Code label={leftLabel} code={left} lang={leftLang} />
      <Code label={rightLabel} code={right} lang={rightLang} />
    </div>
  );
}

/** A row of facts. Monospace values, because they are meant to be compared rather than read. */
export function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: c.line, border: `1px solid ${c.line}`, borderRadius: 6, overflow: "hidden", marginBottom: space.block }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ background: c.panel, padding: "13px 15px" }}>
          <div style={{ fontFamily: font.mono, fontSize: 26, color: c.text, fontVariantNumeric: "tabular-nums", lineHeight: 1.1, marginBottom: 5 }}>{value}</div>
          <div style={{ fontFamily: font.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: c.faint }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

/** A table. `head` is optional; a two-column table of claim and evidence usually needs none. */
export function Table({ head, rows, align }: { head?: string[]; rows: ReactNode[][]; align?: ("left" | "right")[] }) {
  return (
    <div style={{ border: `1px solid ${c.line}`, borderRadius: 6, overflowX: "auto", marginBottom: space.block }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
        {head !== undefined && (
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={h} style={{ textAlign: align?.[i] ?? "left", padding: "9px 14px", background: c.panel, borderBottom: `1px solid ${c.line}`, color: c.faint, fontFamily: font.mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "9px 14px", borderBottom: `1px solid ${c.line}`, color: j === 0 ? c.text : c.body, textAlign: align?.[j] ?? "left", verticalAlign: "top", lineHeight: 1.5 }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Something the reader must not miss, and which limits a claim made near it. */
export function Caveat({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ borderLeft: `2px solid ${c.warm}`, background: `${c.warm}0d`, padding: "14px 18px", borderRadius: "0 4px 4px 0", marginBottom: space.block }}>
      <div style={{ fontFamily: font.mono, fontSize: 13, color: c.warm, marginBottom: 6 }}>{title}</div>
      <div style={{ color: c.body, fontSize: 15, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

// ── Chrome ──────────────────────────────────────────────────────────────────

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span style={{ fontFamily: font.mono, fontSize: size, fontWeight: 700, color: c.text, letterSpacing: "-0.03em" }}>
      wac<span style={{ color: c.accent }}>_</span>
    </span>
  );
}

function Nav({ current }: { current: Route }) {
  return (
    <nav
      aria-label="Pages"
      style={{
        position: "sticky", top: 0, zIndex: 10, background: `${c.bg}f2`, backdropFilter: "blur(8px)",
        borderBottom: `1px solid ${c.line}`, marginBottom: 56,
      }}
    >
      {/* Three parts, and only the middle one is allowed to wrap.
          The row used to be one wrapping flex line with `margin-left: auto` on the playground
          link, which fits on a wide window and comes apart on a narrower one: the link is the
          item that overflows, so it drops to a second line and the auto margin parks it alone at
          the far right, reading as a mistake rather than as a second row. Here the links are
          their own wrapping group and take the slack, so the wordmark and the playground link
          stay on the first line at any width and the labels flow underneath.

          The clamps are what keep it to one line in the first place, and are `clamp` rather than
          a media query because this site has no stylesheet — an inline style would win over one
          anyway. Measured: it now holds a single line down to a 640px window, against 783px. */}
      <div style={{ maxWidth: COLUMN, margin: "0 auto", padding: "13px clamp(14px, 2.4vw, 24px)", display: "flex", gap: "clamp(11px, 2.1vw, 22px)", alignItems: "baseline", fontSize: "clamp(12.5px, 1.6vw, 14px)", fontFamily: font.mono }}>
        <a href="#/" style={{ textDecoration: "none", flexShrink: 0 }}><Wordmark size={19} /></a>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "clamp(11px, 2.1vw, 22px)", alignItems: "baseline", flex: "1 1 auto", minWidth: 0 }}>
          {PAGES.map(({ href, label, route }) => (
            <a key={href} href={href} aria-current={route === current ? "page" : undefined}
               style={{ color: route === current ? c.text : c.dim, textDecoration: "none", borderBottom: `1px solid ${route === current ? c.accent : "transparent"}`, paddingBottom: 3 }}>
              {label}
            </a>
          ))}
        </div>
        <a href="#/playground" style={{ color: c.accent, textDecoration: "none", flexShrink: 0 }}>playground →</a>
      </div>
    </nav>
  );
}

/**
 * The page's own headings, read out of the rendered page rather than written beside it.
 *
 * Carried over from the site this replaces, and for the reason that made it worth writing there: a
 * hand-kept list of sections type-checks, renders, and silently stops matching the first time
 * somebody adds one.
 */
function Contents({ route }: { route: Route }) {
  const [items, setItems] = useState<{ id: string; label: string; sub: boolean }[]>([]);
  useEffect(() => {
    setItems([...document.querySelectorAll<HTMLElement>("main h2[id], main h3[id]")].map((h) => ({
      id: h.id, label: (h.textContent ?? "").trim(), sub: h.tagName === "H3",
    })));
  }, [route]);
  if (items.length < 5) return null;
  return (
    <nav aria-label="Contents" style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "14px 18px", marginBottom: space.section }}>
      <div style={{ fontFamily: font.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: c.faint, marginBottom: 9 }}>On this page</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, columns: "2 230px", columnGap: 30 }}>
        {items.map(({ id, label, sub }) => (
          <li key={id} style={{ breakInside: "avoid", marginBottom: 3 }}>
            <a href={`#/${route}/${id}`} style={{ color: sub ? c.dim : c.text, fontSize: sub ? 13 : 14, textDecoration: "none", paddingLeft: sub ? 15 : 0, lineHeight: 1.65, fontFamily: sub ? font.sans : font.mono }}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${c.line}`, marginTop: space.section, padding: "26px 0 60px", display: "flex", gap: 22, flexWrap: "wrap", fontSize: 13, color: c.faint, fontFamily: font.mono }}>
      <a href="#/playground" style={{ color: c.dim, textDecoration: "none" }}>playground</a>
      <a href={`${TREE}/spec`} target="_blank" rel="noopener" style={{ color: c.dim, textDecoration: "none" }}>spec</a>
      <a href={GITHUB} target="_blank" rel="noopener" style={{ color: c.dim, textDecoration: "none" }}>source</a>
      <a href={`${TREE}/packages`} target="_blank" rel="noopener" style={{ color: c.dim, textDecoration: "none" }}>packages</a>
      <span style={{ marginLeft: "auto", maxWidth: "48ch", lineHeight: 1.6 }}>
        Every snippet is real source from those repositories, abridged only by removing lines.
      </span>
    </footer>
  );
}

export function Page({ current, children, contents = true }: { current: Route; children: ReactNode; contents?: boolean }) {
  return (
    <div style={{ background: c.bg, minHeight: "100vh", color: c.text, fontFamily: font.sans, WebkitFontSmoothing: "antialiased" }}>
      <Nav current={current} />
      <div style={{ maxWidth: COLUMN, margin: "0 auto", padding: "0 24px" }}>
        <main>
          {contents && <Contents route={current} />}
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}
