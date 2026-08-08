import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_URL || "/",
  build: {
    rollupOptions: {
      // One site, and a stub where it used to be built. `next/` was the rewrite, deployed beside
      // the live one so it could be looked at before it replaced anything; it is the site now, and
      // what is left at that path is a redirect, because the URL was shared while it was staging.
      input: {
        main: new URL("index.html", import.meta.url).pathname,
        moved: new URL("next/index.html", import.meta.url).pathname,
      },
    },
  },
});
