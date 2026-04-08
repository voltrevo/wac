import { useState, useEffect } from "react";
import Landing from "./Landing";
import Playground from "./Playground";

function getRoute(): "landing" | "playground" {
  return window.location.hash === "#/playground" ? "playground" : "landing";
}

export default function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const handle = () => setRoute(getRoute());
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);

  return route === "playground" ? <Playground /> : <Landing />;
}
