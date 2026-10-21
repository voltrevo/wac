// What is left of the React site: the parts that compile and run code in the page.
//
// The website itself is written in wac and built ahead of time (`site/wac/build.wac`), as plain HTML.
// This app is built into `playground/` beside it and holds what a static page cannot do yet: the
// playground, which is an editor — a project of its own — and the two demos on the Run page that
// compile a program in your browser and run it, the maze and the bootstrap. `#/maze` and `#/bootstrap`
// open those; anything else is the playground, which is also what every old `#/playground` link wanted.

import { useEffect, useState, type ReactNode } from "react";
import Playground from "../Playground";
import Maze from "../editor/Maze";
import Bootstrap from "../editor/Bootstrap";
import { c, font, SITE } from "./tokens";

type Route = "playground" | "maze" | "bootstrap";

function parse(): Route {
  const first = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return first === "maze" || first === "bootstrap" ? first : "playground";
}

/** A demo on a page of its own: the way back to the site, and what it is. */
function Alone({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: c.bg, minHeight: "100vh", color: c.text, fontFamily: font.sans }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 24px 60px" }}>
        <div style={{ fontFamily: font.mono, fontSize: 13, display: "flex", gap: 18, marginBottom: 28 }}>
          <a href={`${SITE}run.html`} style={{ color: c.dim, textDecoration: "none" }}>← run it here</a>
          <a href="#/playground" style={{ color: c.accent, textDecoration: "none", marginLeft: "auto" }}>playground →</a>
        </div>
        <h1 style={{ fontFamily: font.mono, fontSize: 27, fontWeight: 600, margin: "0 0 24px" }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const handle = () => setRoute(parse());
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);
  switch (route) {
    case "maze": return <Alone title="A maze whose solution is a wac program"><Maze /></Alone>;
    case "bootstrap": return <Alone title="wacc compiling itself, in your browser"><Bootstrap /></Alone>;
    default: return <Playground />;
  }
}
