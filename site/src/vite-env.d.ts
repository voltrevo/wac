/// <reference types="vite/client" />
//
// `import.meta.env.BASE_URL` is Vite's, and without this reference TypeScript does not know
// `import.meta` has an `env` at all. Added when `src/next/tokens.ts` started reading the base so
// that a page's links to the demo pages are right wherever the site is served from.
