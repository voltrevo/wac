# A web app in wac

A page written entirely in wac: `src/app.wac` is the application, and `wac task build` makes it one
`dist/index.html` that runs in any browser — open the file, or serve it with any static server.

    wac update          # fetch the `web` package this project depends on, once
    wac task build      # src/app.wac -> dist/index.html
    wac task serve      # http://localhost:8080
    wac task test       # the application, driven without a browser

## How a page works

```wac
import { Event, Page, html.b, html.button, html.p } from "web";

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

- **`main` takes the page and nothing else.** It has no filesystem, no network and no clock but the
  page's: what a page program can do is what `Page` offers.
- **It changes the document with plain calls** — `render(node)`, `renderInto(id, node)`,
  `setText`, `setValue`, `setStyle`, `title` — which happen at once. Markup is built with JSX and
  everything is escaped: there is no way to hand the browser a string as HTML.
- **It waits with `await`** — for the next event, `await page.nextEvent()`; for a file the user
  picks or drops, `await page.nextFile()`; for time, `await page.sleep(ms)` or `await page.nextFrame()`.
  Each wait hands control back to the browser, so state is ordinary locals and the program reads top
  to bottom. To wait for whichever of several comes first, `await Ticket.any(a, b)` and then ask each
  `a.settled()`.
- **`page.on(selector, kind)`** says which events to deliver: `click`, `input`, `change`, `keydown`
  (with the key as the value), `submit`, and the pointer events, whose `x` and `y` are in the
  element's own pixels.
- **A canvas is a buffer**: `drawPixels(id, w, h, rgba)` fills one, and `download(name, bytes)`
  hands bytes back to the user as a file.

The whole of `Page` is in the `web` package's
[README](https://github.com/voltrevo/wac/blob/master/packages/web/README.md).

## What is in this directory

| | |
|---|---|
| `wac.json5` | the two packages this project uses: `web`, the page, and `webbuild`, the builder |
| `tasks.json5` | `build`, `serve` and `test` |
| `build.wac` | runs the builder from this project, so `web` resolves through `wac.json5` |
| `src/app.wac` | the application |
| `test/app_test.wac` | the application driven without a browser |

The build writes three files into `dist/`: `page.wac`, the wrapper the browser calls into; `page.js`,
the module with the program inside it; and `index.html`, which is both in one file.
