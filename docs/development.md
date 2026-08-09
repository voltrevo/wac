# Development

Everything except the website is Deno and Rust; the website is the one npm subtree.

```sh
deno task test                    # the suite — seven to ten minutes
deno task test packages/json      # one subtree, same concurrency cap
deno task map --check             # MAP.md is generated; staleness is a failure
```

The suite runs in two lanes: a parallel pass capped at four workers, then the files that declare
`// test-lane: exclusive` run alone, because they want a real port or a real external binary. The cap
is measured rather than guessed — see the table in [`tools/runTests.ts`](../tools/runTests.ts).

## The website

```sh
cd site
npm ci
npm run dev                       # dev server
npm run build                     # production build
./node_modules/.bin/tsc -b        # the checker that agrees with the bundler
```

```sh
deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts
deno run -A site/tools/syncMap.ts # refresh the derived figures in site/src/data
```

`site/src` is a vite project whose extensionless imports Deno's resolver refuses, which is why those
two flags exist and why `site/` is excluded from the repo-wide Deno walks.

## Tests that need something installed

Some tests skip themselves rather than fail when a tool is absent, and **say so on standard error**,
because a silent skip reads as coverage.

- The live browser tests need Chromium:
  `mkdir -p ~/pw && cd ~/pw && npm install playwright && ./node_modules/.bin/playwright install chromium`.
  They also need `deno test -A` specifically — `deno task test` withholds `--allow-sys`, so under the
  gate they are the one ignored file.
- The differential suites need the real tools they compare against: `bash`, GNU coreutils, `grep`,
  OpenSSH, and a C `tor` for the two-way Tor tests.

## Before pushing

Work on the primary branch and push only complete changes. A rejected push means somebody got there
first: pull, merge, check the result still holds together, and push again. Never force-push — the
bare repos reject non-fast-forwards, so an attempt fails loudly rather than quietly discarding
somebody else's commits.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) before touching `compiler/`.
