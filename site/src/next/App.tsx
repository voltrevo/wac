// Routing for the staging site. Same shape as the live one — the hash carries the page and,
// after a slash, a heading to scroll to — because two hashes in one URL is not a thing.

import { useEffect, useState } from "react";
import Home from "./Home";
import Language from "./Language";
import Stack from "./Stack";
import Run from "./Run";
import Checked from "./Checked";
import Roadmap from "./Roadmap";
import Playground from "../Playground";
import type { Route } from "./ui";

const ROUTES: Record<string, Route> = { "": "home", language: "language", run: "run", stack: "stack", checked: "checked", roadmap: "roadmap", playground: "playground" };

/**
 * Where the site this replaces sent people, for links written before it did.
 *
 * `#/built` was the package inventory and `#/showcase` the case studies, and both of those are
 * `#/stack` now. Without these an old link resolves to nothing and lands on the front page —
 * silently, because an unknown route falls back rather than failing, which is the shape this
 * repo's own route test exists to catch one layer up. A reader who followed a link about Tor and
 * arrived at a heading about a language cannot tell that anything went wrong.
 */
const MOVED: Record<string, Route> = { built: "stack", showcase: "stack" };

function parse(): { route: Route; anchor: string | null } {
  const [first, second] = window.location.hash.replace(/^#\/?/, "").split("/");
  return { route: ROUTES[first] ?? MOVED[first] ?? "home", anchor: second || null };
}

export default function App() {
  const [{ route, anchor }, setLocation] = useState(parse);

  useEffect(() => {
    const handle = () => setLocation(parse());
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);

  useEffect(() => {
    if (anchor === null) { window.scrollTo(0, 0); return; }
    const id = requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(id);
  }, [route, anchor]);

  switch (route) {
    case "language": return <Language />;
    case "run":      return <Run />;
    case "stack":    return <Stack />;
    case "checked":  return <Checked />;
    case "roadmap":  return <Roadmap />;
    // The playground is a tool rather than a page, and is carried over as it is — sending a reader
    // to the other site to use it would be a stranger seam than its styling being a step behind.
    case "playground": return <Playground />;
    default:         return <Home />;
  }
}
