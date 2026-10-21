import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// **The playground, not the site.** The website is written in wac and built ahead of time into
// `dist/` (`site/wac/build.wac`); this app is what still needs React — the playground and the two demos
// that compile code in the page — and it is built into `dist/playground/` beside the site's pages.
// `BASE_URL` is the deploy's own path, which CI sets to the repository name for a project page.
export default defineConfig({
  plugins: [react()],
  base: (process.env.BASE_URL || "/") + "playground/",
  build: { outDir: "dist/playground", emptyOutDir: true },
  // `bootstrap/js/` is outside this directory; the dev server refuses files outside its root unless
  // told the repository is fair game.
  server: { fs: { allow: [".."] } },
});
