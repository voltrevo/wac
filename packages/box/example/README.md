# box examples — browser pages

Whole applications, not snippets. Each is one `.wac` file with no TypeScript beside it: a
[`packages/web`](../../web/README.md) page, which is a wac program in a worker of its own that awaits
the browser rather than waiting for it. If you followed a link here from a page on the website, the
file you can build below is byte for byte the file you were looking at.

They live here rather than in `packages/platform/example/` because of which way the imports
point. These reach for `sh`, `crypto` and `gzip`; platform is the package all of those sit on top
of, and a platform example that reached up into a leaf would invert the layering for the sake of a
demonstration.

## Building them

You need this repository and its `wac` command (`./bootstrap.sh`). Nothing else — no bundler, no
`npm install`.

```sh
wac run --allow-read --allow-write --allow-run packages/web/tools/build.wac \
    packages/box/example/hash.wac .cache/hash --page ./packages/web
```

That writes `.cache/hash/index.html`, a single self-contained file: the wasm is embedded and it
fetches nothing. Serve it from anywhere — it needs no particular headers, because nothing in it
shares memory. Not from `file://`, which gives a page no origin to start a worker under.

## hash.wac

SHA-256 and DEFLATE keeping up with your typing. Type in the box, or drop a file anywhere on the
page, and it reports the byte count, the code-point count when they differ, the digest, the
compressed size as a percentage, and how long both took.

```sh
wac run --allow-read --allow-write --allow-run packages/web/tools/build.wac \
    packages/box/example/hash.wac .cache/hash --page ./packages/web
```

No grants: it reads no files and opens no sockets, so the built page has no capability to do
either. A file gets in only because you handed it over — `nextFile` returns what the user chose,
and there is deliberately no way for the program to *ask* for a file (a browser only opens a
dialog during a real user gesture, and by the time a request has crossed to the worker and back
that gesture is over — a capability that works when tested by hand and fails in the field is worse
than none).

`download the .gz` hands the compressed bytes back through `offerDownload`. It is a real gzip
container, header and trailer and CRC, so your own `gunzip` will open it — which is the only reason
the byte count above it is worth trusting.

Both algorithms come from packages written for a command line and neither was changed for a
browser: `packages/crypto/src/sha256.wac` and `packages/gzip/src/gzip.wac`. The same `sha256` runs
in `box sha256sum`.

## term.wac

`packages/sh` with a keyboard in front of it: quoting, parameter expansion, command substitution,
arithmetic, pipelines, redirection, `&&`/`||`, `if`/`while`/`for`/`case`, functions, subshells,
globbing, the built-ins including `cd`, `pwd`, `ls`, `mkdir` and `rm` — and all 65 applets from
this package. Up and Down walk a 64-entry history; `clear` empties the screen.

It opens on a session rather than on an empty prompt: three commands run through the same
`runScript` the keyboard reaches, before the loop starts. That is for the page that embeds it — a
terminal showing output it produced a second ago says something a terminal showing a help banner
does not. The website prints the same three lines where the frame cannot load, and
`packages/box/test/wac/frontpage_test.wac` fails if the two lists drift apart or if the shell stops answering what
either of them claims.

```sh
wac run --allow-read --allow-write --allow-run packages/web/tools/build.wac \
    packages/box/example/term.wac .cache/term --page ./packages/web --grant read,write --spawn applet
```

`--grant read,write` is why it has a filesystem at all: the page's `main` is handed a `Sys` whose files
are the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
rather than a disk, so what you write survives a reload and is visible to nothing outside the tab.

Nothing in `packages/sh` was changed for the browser, and every applet in this package is a command
you can type there:

```
ls | sort -r                      seq 1 100 | shuf | sort -n | head -3
echo wac | sha256sum              gzip < f | base64 | head -2
printf 'a,b,c\n' | cut -f2 -d,    diff old new
```

`--spawn applet` is what makes each of those a process. A copy of the page started by `spawnSelf` runs
`applet`, so `sort` is this same program again with `sort` as its first argument, in a worker of its
own with its own grants and working directory, streaming to the next stage by messages; a stage that
reads a file asks the shell over a channel. Pipeline stages therefore run at once, and `yes | head -1`
terminates the way it does in bash.

The command runs as a task while the page goes on reading the keyboard, so output appears as it
arrives and `^C` ends what is running — `$?` is 130 and the prompt comes back, as at an ssh prompt.

## desk.wac

A window manager over the same system: terminals and file listings in windows you can drag, raise and
close, all on one filesystem, so `cd` and a write in one terminal show in the files windows. Every
terminal runs its commands at once and `^C` stops only its own. Built the same way as `term.wac`:

```sh
wac run --allow-read --allow-write --allow-run packages/web/tools/build.wac \
    packages/box/example/desk.wac .cache/desk --page ./packages/web --grant read,write --spawn applet
```

## The rest of `box`

These are the browser pages. `box` itself is a single executable with 65 applets in
`../src/applets/` — see [`../README.md`](../README.md).
