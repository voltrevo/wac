// A single-file build of the staging site, for previewing it where only one HTML file can go.
// Not part of the site's own build: no code splitting, everything inlined, no service worker.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "/tmp/claude-1001/-home-claude/ab916927-a096-47c1-9566-e8c482646b97/scratchpad/artifact",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: "next/artifact.html",
      output: { inlineDynamicImports: true, entryFileNames: "b.js", assetFileNames: "a[extname]" },
    },
  },
});
