// The visual language of the rewrite.
//
// The old site was a purple gradient over near-black with everything in boxes — a shape that says
// "landing page" to exactly the reader this one is written for, who has seen a hundred of them
// fronting nothing. This is a spec sheet instead: near-black, hairlines rather than panels, one
// accent, monospace for anything that is a fact, and enough space that a claim has room to be read.
//
// Nothing here is a component. Components are in `ui.tsx`; this is the vocabulary they share, so a
// colour or a step in the type scale is decided once.

export const c = {
  /** Page background. Blue-black rather than grey-black; it makes the teal read as deliberate. */
  bg: "#0a0b0e",
  /** A raised surface: a table row band, a code frame, a card. */
  panel: "#101319",
  /** A second step up, for something that has to separate from a panel. */
  panelHi: "#151922",
  /** Hairlines. Everything is separated by one of these rather than by a box. */
  line: "#1f242e",
  lineBright: "#2b3240",

  text: "#e8eaed",
  /** Body prose. Deliberately not white: the page is long and white is loud. */
  body: "#b8c0cc",
  dim: "#8b95a5",
  faint: "#5e6878",

  /** The one accent. Links, live values, the wordmark's cursor. */
  accent: "#5eead4",
  accentDim: "#2dd4bf",
  /** Second accent, for warnings and for a number that has to be looked at. */
  warm: "#f5b544",
  /** Something is wrong / not done. */
  cool: "#7aa2f7",
};

export const font = {
  /** Prose. The system stack, because a webfont is a request and this page makes none. */
  sans:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  /** Code, numbers, headings, labels — anything that is a fact rather than a sentence. */
  mono: 'ui-monospace, "Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
};

/**
 * The single column everything sits in: prose, tables, code, all the same width.
 *
 * The first cut gave prose a 68ch measure inside a 940px page, which left every paragraph ending
 * 130px short of every table beside it. At that size the difference does not read as a considered
 * measure, it reads as a layout bug. One width, and the page is a column.
 */
export const COLUMN = 820;

export const space = {
  section: 72,
  block: 28,
  tight: 12,
};

/**
 * Where the built demo pages live, as a URL prefix.
 *
 * They are written beside the site rather than into it — `site/tools/syncDemos.ts` puts them at the
 * deploy root — so a page has to name them by path, and the paths were written `../shell.html`
 * from a site served at `/next/`. Correct from there and wrong from anywhere else, which is a
 * thing no build, typecheck or screenshot can see: it only shows up as a dead iframe on the
 * deployed page, and the iframe is the shell.
 *
 * `import.meta.env.BASE_URL` is what Vite was configured with, which CI sets to the repository
 * name because this deploys to a project page. So this is right at `/`, at `/wac/`, and at
 * `/wac/next/` alike, and stays right when the site moves.
 */
export const ASSETS: string = import.meta.env.BASE_URL;
