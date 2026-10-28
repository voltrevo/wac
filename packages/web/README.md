# web — a page, as a wac program sees it

`export async i32 main(Page page)` is a web page. It runs in a worker, so a program that computes for a
while never freezes the tab — or, built with `--in-page`, on the page's own thread. There is no shared
memory and nothing the server has to send, so a built page is one `index.html` that works from a
`file://` URL or any static server.

**A page is a view of components** (`design/system/0012`). A component is a function whose first
parameter is `Ui`; `ui.state` gives it state that lasts between renders, setting that state renders again
the component that owns it, and handlers are closures:

```wac
import { ElementEvent, Node, Page, Ui, html.b, html.button, html.p } from "web";

Node Counter(Ui ui, string label) {
  auto n = ui.state(0);
  return <p>{label}: <b>{"\{n.get()}"}</b> <button onclick={(ElementEvent e) => { n.set(n.get() + 1); }}>+1</button></p>;
}

export async i32 main(Page page) {
  page.mount((Ui ui) => <Counter label="Clicks"/>);
  return 0;
}
```

A project outside this repository starts from [`templates/webapp/`](../../templates/webapp/), which
depends on this package by git and builds with nothing but `wac`.

## Components and hooks — `view.wac`

| | |
|---|---|
| `page.mount((Ui ui) => …)` | render a root into the page, and keep it rendered |
| `Node F(Ui ui, …)` | a component: its tag `<F a={…}/>` is matched against last render's instance in that place, not called |
| `auto s = ui.state(init)` | a `State<T>`: `get()`, `set(v)`, and `update(f)`, which applies `f` to the value as it is now |
| `ui.memo(dep, f)`, `ui.effect(dep, run)` | a value computed again when `dep` changes; work run after the render when it does, its answer the cleanup |
| `ui.after(ms, f)`, `ui.every(ms, f)` | timers that end with the component, each answering its cancel |
| `Ref r = ui.ref()`, `ref={r}` | a name for an element the component draws: `r.element()` is its handle once the render that made it is applied — in an effect, or a handler |
| `key={…}` | which instance or element a node is, among its siblings |
| `onclick={(ElementEvent e) => …}` and the other `on…` attributes | handlers; `prevent="Tab ArrowUp"` beside one says which defaults the document prevents, and `prevent="Ctrl+s"` prevents a key only with exactly those modifiers held |

**Only what changed renders.** A `set` marks the component that made the cell; a child whose attributes
are unchanged — compared by the snapshots the compiler gives each component tag (`design/lang/0017`) —
is skipped, and renders again before an event reaches it, so a handler never runs with a stale capture.
Hooks are found by the order of the calls, which nothing checks: call them unconditionally.

`TestDoc` is a document of records for tests: hand a page `doc.dom()`, `doc.attach(page)`, and fire events
at what the view drew. `test/wac/view_test.wac` and `templates/webapp/test` use it.

## The handle layer — `element.wac`

`page.root()` is an `Element`: the authority over that element and everything under it, and the only way
to reach it. `append(tag)`, `appendText(s)`, `text(s)`, `attr(name, value)`, `prop(name, value)`,
`move(before)`, `remove()`, `focus()`, `on(kind, Listen, handler)` or `listen(kind, Listen)` and
`await next()`, and `await value()`. The view is built on it; a program may use it directly for a corner
of the page — `page.mountIn(element, draw)` puts a view in one. `attr` refuses `on…` names and
`javascript:` URLs, and `append` refuses the elements that run or load something on their own.

## What belongs to the page

| | |
|---|---|
| `title(t)`, `log(line)` | the document's title, and a line for the console |
| `now()` | milliseconds, from a clock that only goes forward |
| `await sleep(ms)`, `await nextFrame()`, `await painted()` | time: answering `now()` when they settle |
| `await nextFile()` | the next file the user picks with an `<input type="file">` or drops on the page — one per file for a folder, picked with `webkitdirectory` or dropped, named by its path inside it |
| `download(name, bytes)` | offer bytes to the user as a file |
| `sys` | what the build granted — see below |

A component starts work that outlives a render from an effect: a timer with `ui.every`, a loop awaiting
`page.nextFrame()` or `page.nextFile()` that sets state as things arrive. A canvas is named with a ref
and drawn from an effect with `pixels(w, h, rgba)` or `pixelsIn(x, y, w, h, rgba)`, and a handler's event
carries `x` and `y` in the pixels of the element that listened — a canvas's backing store's.

**Several things at once is `Ticket.any`**, for a task that owns an element rather than a view — a
terminal reading keys while a command runs:

```wac
Ticket<ElementEvent> key = screen.next();
Ticket<f64> frame = page.nextFrame();
while (true) {
  await Ticket.any(key, frame);
  if (frame.settled()) { step(); frame = page.nextFrame(); }
  if (key.settled()) { handle(key.value()); key = screen.next(); }
}
```

**Everything is text.** A string reaches the page as a text node, and `htmlOf`, which writes a tree out
as HTML, escapes every one — there is no call that hands the browser a string as markup. A `<style>`'s
text is CSS rather than HTML and goes out as written, with `<` escaped so nothing can close the element.
And the handle layer's policy holds in `htmlOf` too: an `on…` attribute, a `javascript:` URL, a name
outside `[a-z][a-z0-9-]*` or an element that runs on its own traps, naming `htmlOf`.

## Files, and the rest of `Sys`

`main` is always `main(Page page)`, and what the build granted is `page.sys` — the same `Sys` a program
on a command line gets, with the browser's Origin Private File System as its disk. `await
page.sys.readFile(path)` and `await page.sys.writeFile(path, bytes)` work as they do anywhere once the
page is built with `--grant read,write`; without one they are refused, saying which grant was missing,
and so is `sys.cli`, which is no way around the grants. The clock, randomness and output need none. [`packages/platform/example/notes.wac`](../platform/example/notes.wac)
keeps a note that survives a reload.

A page built with `--spawn <export>` can start copies of itself: `sys.procs().spawnSelf(args, …)` runs
`export async i32 <export>(Sys sys)` in a worker of its own, with those arguments, its input fed by the
parent, its output and errors read back on handles, and — when asked — its files reached through the
parent's. That is how a shell's pipeline stages are processes in a page.
[`packages/platform/example/procs.wac`](../platform/example/procs.wac) is the smallest one: a page that
starts a copy of itself, streams text into it and reads it back upper-cased.

**And any page can start a module it holds** (design/system/0015): `sys.procs().spawn(wasm, args, …)` with a
module `wac build` wrote — read from the page's disk, say — runs it in a worker of its own, the same way, so a
shell on a page runs a program from its disk as it does anywhere else. The worker drives the module from the
`wac.manifest` section it carries and serves its requests as it serves the page's; a page cannot wait, so an
`async` program hands control back at each wait and is run on when the answer arrives, and one whose `main` is not
`async` stops at its first wait for the browser. A file that is not a wac module is refused at `spawn`. Such a
module holds what it was handed and no more, and can itself `load` a module and call it by name — so the `wac`
command, run that way, can `check`, `build`, `run` and `test`.
[`packages/platform/example/spawnpage.wac`](../platform/example/spawnpage.wac) runs
[`spawnchild.wac`](../platform/example/spawnchild.wac), built, from its storage. Not yet: a page opened from
`file://` cannot start workers from its worker at all, which decision 3 of that design is for.

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
        <entry.wac> <out-dir> [--in-page] [--dev] [--grant read,write] [--spawn <export>] [--title <t>] [--page <spec>] [--wac <binary>]

`packages/web/tools/build.wac` writes three files: `page.wac`, a wrapper exporting `PageHost` — the one thing the
browser's side holds, with the page in a private field and a method for each call the host makes;
`page.js`, that wrapper through `wac bindgen --script`; and `index.html`, which holds both with the
host. The host is two halves that talk by messages: the program's half makes a `Dom` whose every
call is a message, and the document's half applies each message and sends back events, frames,
files and values. By default the program's half runs in a worker started from the page's own text;
`--in-page` joins the two halves directly on the page's thread. Neither half makes a decision;
everything a page does is in `src/page.wac`. Because the page is private, none of its interior
crosses into JavaScript: the glue is two classes, `PageHost` and `Dom`.

**`--dev` is a development build**: after every turn each view renders everything again and logs, to the
console, each place the page does not show what a component renders — which happens only when a render
read something changed without a `set`, a `Vec` in a cell pushed to in place.

**The page carries a Content Security Policy.** The one script it runs as written is a fixed loader,
allowed by its hash, which starts the rest from `blob:` URLs; nothing is loaded from anywhere else — no
outside image, style sheet or font — and an inline handler or a script element written into the
document by any route does not run. A test driving a built page waits with `waitInPage` from
`harness/buildPage.ts`, since Playwright's string `waitForFunction` is an `eval` the policy refuses.

The output directory has to be inside the directory the build runs in, since the wrapper is written
there and imports the program.

`--page` names the module the wrapper imports `Page` from: `web` by default, which is how a project
that depends on this package spells it, and `./packages/web` from this repository's root.

## Where it is used

`packages/platform/example/{counter,life,pixels,ripple,notes,procs}.wac`,
`packages/box/example/{hash,term,desk,rasterterm}.wac`,
`packages/git/example/gitpage.wac`, `packages/wacc/example/waccpage.wac` and
`packages/raster/example/rasterdesk.wac` — outside this package, because a page's wrapper imports its
program from outside it, and this package is a project of its own.

The shell and the desktop are `packages/web` pages built `--grant read,write --spawn applet`: every
applet a process, every file in the Origin Private File System, and the command a task the page keeps
reading the keyboard beside — so `^C` stops it. `packages/box/example/rasterterm.wac` is the same
shell drawn on a canvas.
