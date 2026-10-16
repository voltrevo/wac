# web — a page, as a wac program sees it

`export async i32 main(Page page)` is a web page. It is an `async` function: it changes the document
with plain calls, and waits for what happens later with `await`. It runs in a worker, so a program
that computes for a while never freezes the tab — or, built with `--in-page`, on the page's own
thread. There is no shared memory and nothing the server has to send, so a built page is one
`index.html` that works from a `file://` URL or any static server.

```wac
import { Event, Page } from "web";
import { html.b, html.button, html.p } from "core";

export async i32 main(Page page) {
  page.render(<p>Clicks: <b id="n">0</b> <button id="up">+1</button></p>);
  page.on("button", "click");
  i32 n = 0;
  while (true) {
    Event e = await page.nextEvent();
    if (e.id == "up") { n += 1; page.setText("n", "\{n}"); }
  }
}
```

A project outside this repository starts from [`templates/webapp/`](../../templates/webapp/), which
depends on this package by git and builds with nothing but `wac`.

## What a page can do

| | |
|---|---|
| `render(node)`, `renderInto(id, node)` | replace the page, or one element's contents, with JSX — escaped, always |
| `setText`, `setValue`, `setStyle`, `title`, `log` | the targeted changes that would otherwise mean re-rendering |
| `await getValue(id)` | an input's value — waited for, because a program in a worker cannot read the document |
| `drawPixels(id, w, h, rgba)`, `drawPixelsIn(id, x, y, w, h, rgba)` | fill a `<canvas>` from a buffer, or part of one |
| `download(name, bytes)` | offer bytes to the user as a file |
| `now()` | milliseconds, from a clock that only goes forward |
| `on(selector, kind)` | deliver `kind` events on elements matching `selector`, delegated so they survive `render` |
| `await nextEvent()` | the next event: `kind`, `id`, `value` (an input's value, or the key), `x`, `y` (in the element's own pixels) |
| `await nextFile()` | the next file the user picks with an `<input type="file">` or drops on the page |
| `await sleep(ms)`, `await nextFrame()`, `await painted()` | time: answering `now()` when they settle |

**Several things at once is `Ticket.any`.** An animation waits for whichever comes first and then
asks each ticket whether it settled:

```wac
Ticket<Event> ev = page.nextEvent();
Ticket<f64> frame = page.nextFrame();
while (true) {
  await Ticket.any(ev, frame);
  if (frame.settled()) { step(); draw(page); frame = page.nextFrame(); }
  if (ev.settled()) { handle(ev.value()); ev = page.nextEvent(); }
}
```

**Everything is escaped.** `render` takes a `Node`, which JSX builds, and serialises it with every
string as text — there is no call that hands the browser a string as markup. A `<style>`'s text is
CSS rather than HTML and goes out as written, with `<` escaped so nothing can close the element.

## Files, and the rest of `Sys`

A page built with `--grant read,write` is handed a `Sys` beside its `Page` —
`export async i32 main(Page page, Sys sys)` — the same `Sys` a program on a command line gets, with
the browser's Origin Private File System as its disk. `await sys.readFile(path)` and
`await sys.writeFile(path, bytes)` work as they do anywhere; what the page was not granted, its `Cli`
refuses too, so `sys.cli` is no way around the grants. [`packages/platform/example/notes.wac`](../platform/example/notes.wac)
keeps a note that survives a reload.

Nothing waits for the browser: each call that reaches it returns a ticket at once, and the browser
calls back when the work is done. So a host ticket is `await`ed — `await cli.readFile(p).ticket()` —
and `.wait()` on one that has not arrived traps saying so, where on a command line it would block.

## Testing a page without a browser

`Page.create(dom)` takes a `Dom` — a struct of functions — and the host's three calls, `deliver`,
`timerFired`, `fileArrived` and `valueArrived`, are ordinary exports. A page's `Sys` is the same: a
`World` built from a `System` of lambdas, answered by hand with `answered` —
[`test/wac/system_test.wac`](test/wac/system_test.wac). A test hands the program a `Dom` of lambdas that
record what it did, and makes the calls a browser would. [`test/wac/page_test.wac`](test/wac/page_test.wac)
does that for every order in which things can arrive.

## Building one

    wac run --allow-read --allow-write --allow-run packages/web/tools/build.wac \
        <entry.wac> <out-dir> [--in-page] [--grant read,write] [--title <t>] [--page <spec>] [--wac <binary>]

`packages/web/tools/build.wac` writes three files: `page.wac`, a wrapper exporting `Host` — the one thing the
browser's side holds, with the page in a private field and a method for each call the host makes;
`page.js`, that wrapper through `wac bindgen --script`; and `index.html`, which holds both with the
host. The host is two halves that talk by messages: the program's half makes a `Dom` whose every
call is a message, and the document's half applies each message and sends back events, frames,
files and values. By default the program's half runs in a worker started from the page's own text;
`--in-page` joins the two halves directly on the page's thread. Neither half makes a decision;
everything a page does is in `src/page.wac`. Because the page is private, none of its interior
crosses into JavaScript: the glue is two classes, `Host` and `Dom`.

The output directory has to be inside the directory the build runs in, since the wrapper is written
there and imports the program.

`--page` names the module the wrapper imports `Page` from: `web` by default, which is how a project
that depends on this package spells it, and `./packages/web` from this repository's root.

## Where it is used

`packages/platform/example/{counter,life,pixels,ripple}.wac`, `packages/box/example/hash.wac`,
`packages/git/example/gitpage.wac`, `packages/wacc/example/waccpage.wac` and
`packages/raster/example/rasterdesk.wac` — outside this package, because a page's wrapper imports its
program from outside it, and this package is a project of its own.

The shell and the desktop (`packages/box/example/{term,desk,rasterterm}.wac`) are not, yet: they run
`packages/sh` against a filesystem and spawn programs, which is `Cli` — and a page has no `Cli`. They
stay on `packages/platform`'s worker host until that has an answer.
