// Routing, in the hash, because GitHub Pages serves static files and a path route would need a
// 404 fallback to work at all.
//
// `#/language/surfaces` is a route and an anchor: the first segment picks the page, the second is
// an element to scroll to once it exists. Two hashes in one URL is not a thing, so a section link
// that crosses a page boundary has to be spelled this way.

import { useState, useEffect } from "react";
import Landing from "./Landing";
import Language from "./Language";
import BuiltPage from "./BuiltPage";
import ShowcasePage from "./ShowcasePage";
import Roadmap from "./Roadmap";
import Playground from "./Playground";
import type { Route } from "./chrome";

const ROUTES: Record<string, Route> = {
  "": "home",
  language: "language",
  built: "built",
  showcase: "showcase",
  roadmap: "roadmap",
  playground: "playground",
};

function parse(): { route: Route; anchor: string | null } {
  const [first, second] = window.location.hash.replace(/^#\/?/, "").split("/");
  return { route: ROUTES[first] ?? "home", anchor: second || null };
}

export default function App() {
  const [{ route, anchor }, setLocation] = useState(parse);

  useEffect(() => {
    const handle = () => setLocation(parse());
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);

  // A page starts at the top unless the URL named a section. Without this, moving between pages
  // keeps the previous scroll position, which reads as the new page being broken.
  useEffect(() => {
    if (anchor === null) {
      window.scrollTo(0, 0);
      return;
    }
    // The element belongs to the page that is rendering now, so the lookup waits a frame.
    const id = requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [route, anchor]);

  switch (route) {
    case "playground": return <Playground />;
    case "language":   return <Language />;
    case "built":      return <BuiltPage />;
    case "showcase":   return <ShowcasePage />;
    case "roadmap":    return <Roadmap />;
    default:           return <Landing />;
  }
}
