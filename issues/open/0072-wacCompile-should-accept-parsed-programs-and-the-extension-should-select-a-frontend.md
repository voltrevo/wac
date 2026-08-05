# 0072 — `wacCompile` should accept parsed programs, and the extension should select a frontend

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-05
- **Kind:** missing feature
- **Symptom:** not implemented

Two changes, one small and one smaller, both from wac now having a second frontend
(`tools/wapy.ts` and `tools/wapyRead.ts` — a Python-flavoured surface that parses into the same
AST).

## 1. Nothing enforces the `.wac` extension

`wacx` uses it only to derive an output name:

```ts
// atoms/wac/wacx.ts:84
return path.endsWith(".wac") ? path.slice(0, -4) : path;
```

Any extension compiles. That was harmless with one frontend. It is not harmless now, because
**the extension is what selects the frontend** — so `foo.txt` or `foo.wapyy` would be silently
treated as wac and produce a parse error somewhere confusing rather than a clear one at the
point of the mistake.

Expected: an unrecognised extension is refused, naming the ones that are recognised.

## 2. `wacCompile` cannot be given a `Program`

Phases 1 and 2 lex and parse inline:

```ts
for (const [path, src] of files) {
  const { tokens, errors: lexErrs } = wacLex(src);
  const { program, errors: parseErrs } = wacParse(tokens, path);
  programs.set(path, program);
}
```

Everything after works from `Map<string, Program>` and does not care where a program came from.
So a caller with a program already in hand — anyone with a second frontend — has no way to
supply it, and has to reach past `wacCompile` and run phases 3 to 5 itself. That is what
`tools/wapyLoad.ts` does today, and it duplicates the phase order, which will drift.

Suggested shape, in rough order of preference:

```ts
// A: a frontend per file, chosen by the caller.
wacCompile(files, entry, { parse: (path, src) => ({ program, errors }) })

// B: an overload taking programs directly.
wacCompileProgram(programs: Map<string, Program>, entry, options)
```

**A is better**, because it keeps one entry point and puts the extension switch in the compiler
where a frontend selector belongs — `wacx` would default it to "`.wapy` uses the wapy frontend,
anything else must be `.wac`", and item 1 falls out of the same change.

## The change, concretely

Small enough to be worth spelling out, since the two halves land together.

**`wacCompile`** gains one option, defaulting to today's behaviour:

```ts
export type WacCompileOptions = {
  // …existing…
  /** Turn a file into a program. Defaults to wac's own lexer and parser. */
  parse?: (path: string, src: string) => { program: Program; errors: ParseError[] };
};
```

and phases 1 and 2 route through it:

```ts
const parse = options.parse ?? ((path, src) => {
  const { tokens, errors: lexErrs } = wacLex(src);
  const p = wacParse(tokens, path);
  return { program: p.program, errors: [...lexErrs.map(e => ({ ...e, file: path })), ...p.errors] };
});

for (const [path, src] of files) {
  const { program, errors } = parse(path, src);
  for (const e of errors) diagnostics.push({ span: 1, ...e, phase: "parse", severity: "error" });
  programs.set(path, program);
}
```

Nothing else in the file changes. Note the default keeps lex errors reported as `phase: "parse"`
rather than `"lex"`, which is a small regression in diagnostic labelling — worth either
accepting or giving the hook a two-stage shape instead.

**`wacx`** picks the frontend by extension and refuses anything else:

```ts
const FRONTENDS: Record<string, (p: string, s: string) => ParseOut> = {
  ".wac":  wacFrontend,
  ".wapy": parseWapy,
};

function frontendFor(path: string) {
  const ext = path.slice(path.lastIndexOf("."));
  const f = FRONTENDS[ext];
  if (!f) throw new UsageError(
    `${path}: unknown extension ${ext} — expected one of ${Object.keys(FRONTENDS).join(", ")}`);
  return f;
}
```

`readGraph` keeps returning sources; `wacCompile` gets `{ parse: (p, s) => frontendFor(p)(p, s) }`.
Import discovery already lexes, so it needs the frontend too — or, more simply, it can read the
imports off the parsed program, which is what `tools/wapyLoad.ts` does and is one line shorter.

That is the whole thing. After it, `wacx run foo.wapy` works, `deno task app` works, wac-mono's
harness works, and `tools/wapyLoad.ts` loses its fifteen lines of phase orchestration.

## Why positions are not part of this

Worth saying, because the obvious version of this feature is a source map and that would be the
wrong thing. `wapyRead` emits a `Token[]` carrying the positions from the `.wapy` file, so the
AST is already in the author's coordinates and every diagnostic is correct with no translation
anywhere. A source map would only be needed by a frontend that went through text and threw the
positions away — an earlier draft of this did exactly that, and the map it needed was the
symptom.

So the request is only for the seam, not for anything to be carried through it.

## Notes

The frontend and the round trip are in `tools/`, and nothing in `atoms/wac/` was touched.
`deno test -A tools/wapyRoundTrip.test.ts` checks that wac → wapy → AST is identical to
wac → AST across all 155 files of wac-mono; `tools/wapyLoad.test.ts` covers mixed graphs in
both directions.
