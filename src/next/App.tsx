// Routing for the staging site. Same shape as the live one — the hash carries the page and,
// after a slash, a heading to scroll to — because two hashes in one URL is not a thing.

import { useEffect, useState } from "react";
import Home from "./Home";
import Language from "./Language";
import Stack from "./Stack";
import Roadmap from "./Roadmap";
import type { Route } from "./ui";

const ROUTES: Record<string, Route> = { "": "home", language: "language", stack: "stack", roadmap: "roadmap" };

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

  useEffect(() => {
    if (anchor === null) { window.scrollTo(0, 0); return; }
    const id = requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(id);
  }, [route, anchor]);

  switch (route) {
    case "language": return <Language />;
    case "stack":    return <Stack />;
    case "roadmap":  return <Roadmap />;
    default:         return <Home />;
  }
}
