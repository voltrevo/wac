# A web app in wac

A page written entirely in wac: `src/app.wac` is the application, and `wac task build` makes it one
`dist/index.html` that runs in any browser — open the file, or serve it with any static server.

    wac update          # fetch the `web` package this project depends on, once
    wac task build      # src/app.wac -> dist/index.html
    wac task serve      # http://localhost:8080
    wac task test       # the application, driven without a browser

## How a page works

```wac
import { ElementEvent, Node, Page, Ui, html.b, html.button, html.p } from "web";

Node Counter(Ui ui) {
  auto n = ui.state(0);
  return <p>Clicks: <b>{n.get()}</b> <button onclick={(ElementEvent e) => { n.update((i32 x) => x + 1); }}>+1</button></p>;
}

export async i32 main(Page page) {
  page.mount((Ui ui) => Counter(ui));
  return 0;
}
```

- **A page is components.** A component is a function whose first parameter is `Ui`: `ui.state` keeps a
  value from one render to the next, and setting it renders again the component that owns it — only
  that one, and the children it passes new attributes to. Handlers are closures that set state.
- **`main` takes the page and nothing else.** Files, if the build granted them, are `page.sys`; the page
  itself offers its title, the clock, timers, frames, files the user hands over, and a download.
- **Markup is built with JSX and every string is text**: there is no way to hand the browser a string as
  HTML, and the built page runs under a Content Security Policy that refuses script written into it.
- **Work that outlives a render starts in an effect** — `ui.every(ms, f)` for a timer, or an `async`
  function awaiting `page.nextFrame()` or `page.nextFile()` that sets state as things arrive. A canvas
  is named with `ref={r}` (`Ref r = ui.ref()`) and drawn from an effect with `r.element()!.pixels(w, h,
  rgba)`.

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
