# web — a page, as a wac program sees it

`export async i32 main(Page page)` is a web page. It runs on the page's own thread as an `async`
function: it changes the document with plain calls, and waits for what happens later with `await`.
There is no worker, no shared memory and nothing the server has to send, so a built page is one
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
| `setText`, `setValue`, `setStyle`, `getValue`, `title`, `log` | the targeted changes that would otherwise mean re-rendering |
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

## Testing a page without a browser

`Page.create(dom)` takes a `Dom` — a struct of functions — and the host's three calls, `deliver`,
`timerFired` and `fileArrived`, are ordinary exports. A test hands the program a `Dom` of lambdas that
record what it did, and makes the calls a browser would. [`test/wac/page_test.wac`](test/wac/page_test.wac)
does that for every order in which things can arrive.

## Building one

    wac run --allow-read --allow-write --allow-run packages/web/tools/build.wac \
        <entry.wac> <out-dir> [--title <t>] [--page <spec>] [--wac <binary>]

`tools/build.wac` writes three files: `page.wac`, a wrapper exporting the calls the host makes;
`page.js`, that wrapper through `wac bindgen --js`; and `index.html`, both in one `<script>` with
the host — the few lines of JavaScript that turn the document into a `Dom` and forward events,
timers and files. The host makes no decisions; everything a page does is in `src/page.wac`.

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
