import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_URL || "/",
  build: {
    rollupOptions: {
      // Two sites from one build. `next/` is the rewrite, deployed beside the live one so it can
      // be looked at before it replaces anything — the alternative was a branch, and a branch that
      // lives for days is a merge nobody wants against a repo three agents are pushing to.
      input: {
        main: new URL("index.html", import.meta.url).pathname,
        next: new URL("next/index.html", import.meta.url).pathname,
      },
    },
  },
});
