// The frame every page shares: the glow, the top navigation, and the footer.
//
// The site was one page a dozen screens tall, with a contents list two screens down that most
// readers never reached. It is five pages now, and the thing that makes that work rather than
// merely shorter is that the navigation is the same object on every one of them — a reader always
// knows what else there is and which of it they are looking at.

import type { ReactNode } from "react";
import { GITHUB, MONO, s } from "./theme";

export type Route = "home" | "language" | "built" | "showcase" | "roadmap" | "playground";

/** Every page in the order a first-time reader should meet them. */
export const PAGES: { route: Route; href: string; label: string; blurb: string }[] = [
  { route: "language", href: "#/language", label: "the language", blurb: "How it reads, two surfaces, and what WebAssembly is missing" },
  { route: "built", href: "#/built", label: "what is built", blurb: "32 packages, no TypeScript in any of them, and applications with no ambient authority" },
  { route: "showcase", href: "#/showcase", label: "three hard things", blurb: "A shell that agrees with bash, Tor at both ends, and Ethereum checked rather than trusted" },
  { route: "roadmap", href: "#/roadmap", label: "where this is going", blurb: "A self-contained system, a host with no JavaScript, and packages" },
];

/** The purple wash behind the top of every page. */
export function Glow() {
  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 500,
        background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(192,132,252,0.12) 0%, transparent 100%)",
        pointerEvents: "none", zIndex: 0,
      }}
    />
  );
}

export function Nav({ current }: { current: Route }) {
  return (
    <nav
      aria-label="Pages"
      style={{
        display: "flex", gap: 20, flexWrap: "wrap", alignItems: "baseline",
        padding: "14px 0 12px", marginBottom: 40,
        borderBottom: "1px solid #2e2e3e", fontSize: 14,
      }}
    >
      <a
        href="#/"
        style={{
          fontFamily: "ui-monospace, 'Cascadia Code', monospace",
          fontSize: 18, fontWeight: 700, color: "#a855f7", textDecoration: "none", marginRight: 4,
        }}
      >
        wac
      </a>
      {PAGES.map(({ href, label, route }) => (
        <a
          key={href}
          href={href}
          aria-current={route === current ? "page" : undefined}
          style={{
            color: route === current ? "#e2e8f0" : "#9ca3af",
            textDecoration: "none",
            borderBottom: route === current ? "1px solid #2dd4bf" : "1px solid transparent",
            paddingBottom: 2,
          }}
        >
          {label}
        </a>
      ))}
      <a href="#/playground" style={{ marginLeft: "auto", color: "#2dd4bf", textDecoration: "none" }}>
        playground →
      </a>
    </nav>
  );
}

export function Footer() {
  return (
    <div
      style={{
        borderTop: "1px solid #2e2e3e", marginTop: 8, paddingTop: 24,
        display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13, color: "#6b7280",
      }}
    >
      <a href="#/playground" style={{ color: "#9ca3af", textDecoration: "none" }}>Playground</a>
      <a href={`${GITHUB}/tree/master/spec`} target="_blank" rel="noopener" style={{ color: "#9ca3af", textDecoration: "none" }}>Language Spec</a>
      <a href={GITHUB} target="_blank" rel="noopener" style={{ color: "#9ca3af", textDecoration: "none" }}>GitHub</a>
      <a href={MONO} target="_blank" rel="noopener" style={{ color: "#9ca3af", textDecoration: "none" }}>wac-mono</a>
      <span style={{ marginLeft: "auto", color: "#4a4a5a" }}>
        Snippets are real source from those repositories, abridged only by removing lines.
      </span>
    </div>
  );
}

/** A page: the glow, the navigation, the content, the footer. */
export function Page({ current, children }: { current: Route; children: ReactNode }) {
  return (
    <div style={s.page}>
      <Glow />
      <Nav current={current} />
      {children}
      <Footer />
    </div>
  );
}
