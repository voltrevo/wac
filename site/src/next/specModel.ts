// The specification, read as data: chapters, blocks and fences out of `spec/**/*.md`.
//
// No React and no Vite in here, so `site/tools/site.test.ts` can import it under Deno and hold it to
// the same files the page renders. That matters most for one rule: **which fence is example N**.
// `spec/_status/MET` names examples as `spec/<doc>#<ordinal>`, counted the way
// `packages/wacc/test/wac/specexamples.wac` counts them — every ` ```wac ` fence that is not a
// `// fragment`, from 1, per document. A page that counted differently would put "met" on the wrong
// program, and look right doing it.
//
// The markdown is the subset the spec is written in, and deliberately no more: headings to `###`,
// paragraphs, `-` and numbered lists, pipe tables, fences, and inline code, emphasis and links. A
// construct outside that renders as a paragraph of its own text, which is visible, rather than being
// dropped, which is not.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

export type Fence = {
  lang: string;
  code: string;
  /** The line of the opening fence in the markdown file, 1-based. */
  line: number;
  /** The example's number in its document, or null for a fragment and for anything not ` ```wac `. */
  ordinal: number | null;
  /** Its `// expect` lines, as written after the `//`. */
  expects: string[];
};

export type Block =
  | { kind: "heading"; level: number; text: string; id: string }
  | { kind: "para"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; head: string[]; align: ("left" | "right" | "center")[]; rows: string[][] }
  | { kind: "fence"; fence: Fence };

/** GitHub's heading anchors, which is what the spec's own `#links` were written against. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** A heading's text with its inline markup stripped, as the anchor and the contents list want it. */
export function plain(text: string): string {
  return text.replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

function cells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|") && !r.endsWith("\\|")) r = r.slice(0, -1);
  // A `|` inside backticks is code, not a column — the operator tables are full of them.
  const out: string[] = [];
  let cur = "";
  let tick = 0;
  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    if (ch === "`") {
      let n = 0;
      while (r[i + n] === "`") n++;
      cur += r.slice(i, i + n);
      tick = tick === 0 ? n : tick === n ? 0 : tick;
      i += n - 1;
      continue;
    }
    if (ch === "\\" && r[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "|" && tick === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const isRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

/** One document, as blocks. Heading ids are made unique the way GitHub makes them. */
export function parseBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  const used = new Map<string, number>();
  let ordinal = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === "") { i++; continue; }

    if (t.startsWith("```")) {
      const lang = t.slice(3).trim();
      const open = i;
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "```") j++;
      const body = lines.slice(open + 1, j);
      const fragment = body.length > 0 && body[0].trim().startsWith("// fragment");
      const counted = lang === "wac" && !fragment;
      if (counted) ordinal++;
      const expects: string[] = [];
      for (const b of body) {
        const bt = b.trim();
        if (!bt.startsWith("// expect")) break;
        expects.push(bt.slice(3));
      }
      blocks.push({ kind: "fence", fence: { lang, code: body.join("\n"), line: open + 1, ordinal: counted ? ordinal : null, expects } });
      i = j + 1;
      continue;
    }

    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const text = h[2].trim();
      let id = slugify(plain(text));
      const n = used.get(id);
      used.set(id, (n ?? 0) + 1);
      if (n !== undefined) id = `${id}-${n}`;
      blocks.push({ kind: "heading", level: h[1].length, text, id });
      i++;
      continue;
    }

    if (t.startsWith("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(t);
      const align = cells(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" as const : c.endsWith(":") ? "right" as const : "left" as const);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) { rows.push(cells(lines[j])); j++; }
      blocks.push({ kind: "table", head, align, rows });
      i = j;
      continue;
    }

    const bullet = /^[-*]\s+/;
    const numbered = /^\d+\.\s+/;
    if (bullet.test(t) || numbered.test(t)) {
      const ordered = numbered.test(t);
      const marker = ordered ? numbered : bullet;
      const items: string[] = [];
      let j = i;
      while (j < lines.length) {
        const lt = lines[j].trim();
        if (marker.test(lt)) { items.push(lt.replace(marker, "")); j++; continue; }
        // A continuation line: indented, not blank, not a new block.
        if (lt !== "" && /^\s+/.test(lines[j]) && items.length > 0) { items[items.length - 1] += " " + lt; j++; continue; }
        break;
      }
      blocks.push({ kind: "list", ordered, items });
      i = j;
      continue;
    }

    // A paragraph runs to the next blank line or the next thing that starts a block.
    const para: string[] = [t];
    let j = i + 1;
    while (j < lines.length) {
      const lt = lines[j].trim();
      if (lt === "" || lt.startsWith("```") || /^#{1,3}\s/.test(lt) || /^[-*]\s+/.test(lt) || /^\d+\.\s+/.test(lt)) break;
      if (lt.startsWith("|") && j + 1 < lines.length && isRule(lines[j + 1])) break;
      para.push(lt);
      j++;
    }
    blocks.push({ kind: "para", text: para.join(" ") });
    i = j;
  }
  return blocks;
}

/** Inline markup: code spans first, since nothing inside one is markup. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf !== "") { out.push({ kind: "text", text: buf }); buf = ""; } };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "`") {
      let n = 0;
      while (text[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const end = text.indexOf(fence, i + n);
      if (end > 0) {
        flush();
        let code = text.slice(i + n, end);
        // CommonMark: one space either side is padding, so `` ` `` can show a backtick.
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
        out.push({ kind: "code", text: code });
        i = end + n;
        continue;
      }
    }
    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: "strong", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && text[i + 1] !== " " && text[i + 1] !== ch &&
        (i === 0 || /[\s(—"']/.test(text[i - 1]))) {
      const end = text.indexOf(ch, i + 1);
      if (end > i + 1 && text[end - 1] !== " " && (end + 1 >= text.length || /[\s.,;:)!?—"']/.test(text[end + 1]))) {
        flush();
        out.push({ kind: "em", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      // Find the matching `]`, allowing a code span with brackets inside the link text.
      let depth = 0;
      let k = i;
      let inCode = false;
      for (; k < text.length; k++) {
        if (text[k] === "`") inCode = !inCode;
        if (inCode) continue;
        if (text[k] === "[") depth++;
        else if (text[k] === "]") { depth--; if (depth === 0) break; }
      }
      if (k < text.length && text[k + 1] === "(") {
        const close = text.indexOf(")", k + 2);
        const href = close > 0 ? text.slice(k + 2, close) : "";
        if (close > 0 && !/\s/.test(href)) {
          flush();
          out.push({ kind: "link", href, children: parseInline(text.slice(i + 1, k)) });
          i = close + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ── The table of contents, read from the spec's own README ────────────────────

export type Chapter = {
  /** The file's name without `.md`, which is also its route: `#/spec/17-const`. */
  slug: string;
  /** Relative to `spec/`: `2-types/17-const.md`. */
  path: string;
  /** `17`, or `A` for an appendix. */
  num: string;
  title: string;
  part: string;
};

/**
 * The reading order, from `spec/README.md`'s list rather than typed here.
 *
 * A hand-kept list of 53 chapters is a list that goes stale the first time one is added or renamed,
 * and the README's list is the one a person reading the repository follows.
 */
export function chaptersOf(readme: string): Chapter[] {
  const out: Chapter[] = [];
  let part = "";
  for (const line of readme.split("\n")) {
    const p = line.match(/^\*\*(.+)\*\*\s*$/);
    if (p) { part = p[1]; continue; }
    const m = line.match(/^- (\w+) \[(.+)\]\(([^)]+\.md)\)\s*$/);
    if (m) {
      out.push({ num: m[1], title: plain(m[2]), path: m[3], slug: m[3].replace(/^.*\//, "").replace(/\.md$/, ""), part });
    }
  }
  return out;
}

/** `spec/_status/MET`: one met example per line. */
export function metOf(text: string): Set<string> {
  return new Set(text.split("\n").map((l) => l.trim()).filter((l) => l !== ""));
}

export type DocStatus = { examples: number; met: number; missed: number; unsupported: number };

/** `spec/_status/STATUS.md`'s table, by document path relative to `spec/`. */
export function statusOf(text: string): { total: DocStatus; docs: Map<string, DocStatus> } {
  const docs = new Map<string, DocStatus>();
  const total: DocStatus = { examples: 0, met: 0, missed: 0, unsupported: 0 };
  for (const line of text.split("\n")) {
    const m = line.match(/^\| spec\/(\S+\.md) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/);
    if (!m) continue;
    const s = { examples: +m[2], met: +m[3], missed: +m[4], unsupported: +m[5] };
    docs.set(m[1], s);
    total.examples += s.examples; total.met += s.met; total.missed += s.missed; total.unsupported += s.unsupported;
  }
  return { total, docs };
}

/** The key `MET` uses for example `ordinal` of a document at `path` (relative to `spec/`). */
export const exampleKey = (path: string, ordinal: number) => `spec/${path}#${ordinal}`;

/** A fence's files, split at its `// ---- name.wac ----` marks; one unnamed file is `main.wac`. */
export function filesOf(code: string): { name: string; text: string }[] | null {
  const lines = code.split("\n");
  const files: { name: string; lines: string[] }[] = [];
  for (const l of lines) {
    const m = l.match(/^\/\/ ---- (\S+) ----\s*$/);
    if (m) {
      // A dependency's file is laid out by the probe, not by the fence; the playground has no packages.
      if (m[1].includes("<")) return null;
      files.push({ name: m[1], lines: [] });
      continue;
    }
    if (files.length === 0) files.push({ name: "main.wac", lines: [] });
    files[files.length - 1].lines.push(l);
  }
  return files.map((f) => ({ name: f.name, text: f.lines.join("\n").replace(/^\n+/, "") + "\n" }));
}

/**
 * Where a link in a document at `from` (relative to `spec/`) goes on this site.
 *
 * Another chapter becomes its route, a heading becomes the route plus its anchor, and anything else
 * under `spec/` — `tour.wac`, `cases/` — goes to the file on GitHub, since this site does not
 * render it.
 */
export function routeOf(href: string, from: string, chapters: Chapter[], blob: string): { href: string; external: boolean } {
  if (/^[a-z]+:/.test(href)) return { href, external: true };
  const [path, anchor] = href.split("#");
  const self = chapters.find((c) => c.path === from);
  if (path === "") return { href: `#/spec/${self?.slug ?? ""}${anchor ? `/${anchor}` : ""}`, external: false };
  const parts = from.split("/").slice(0, -1);
  for (const seg of path.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  const target = parts.join("/");
  if (target === "README.md") return { href: "#/spec", external: false };
  const ch = chapters.find((c) => c.path === target);
  if (ch) return { href: `#/spec/${ch.slug}${anchor ? `/${anchor}` : ""}`, external: false };
  // A directory is a tree on GitHub, not a blob.
  const base = path.endsWith("/") ? blob.replace("/blob/", "/tree/") : blob;
  return { href: `${base}/spec/${target}${anchor ? `#${anchor}` : ""}`, external: true };
}
