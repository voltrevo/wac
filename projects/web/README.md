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

A project of your own starts from [`template/`](template/), which depends on this package by git
(`https://github.com/voltrevo/wac-web.git`) and builds with nothing but `wac`.

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
| `onclick={(ElementEvent e) => …}` and the other `on…` attributes | handlers; `prevent="Tab ArrowUp"` beside one says which defaults the document prevents, and `prevent="Ctrl+s"` prevents a key only with exactly those modifiers held; `prevent="* capture"` keeps each pointer pressed down on the element the element's until it lifts, and a pointer event's `pointer` says which — so two fingers are followed apart, and one slid off a button still lets go of it (`onpointercancel` when the browser takes a touch away) |
| `e.at`; `onwheel`'s `e.value`; `element.on("resize", …)` | when an event happened, by `page.now()`'s clock — `page.now() - e.at` is how long it took to arrive; how far a wheel turned, in pixels down; an element's size on screen in device pixels, in `e.x` and `e.y`, as it changes |
| `onscroll`'s `e.value`; `element.prop("scrollTop", …)` | where a scroller is now, in CSS pixels down; and putting it somewhere — so a list taken off the page and drawn again is scrolled where it was |

**Only what changed renders.** A `set` marks the component that made the cell; a child whose attributes
are unchanged — compared by the snapshots the compiler gives each component tag (`design/lang/0017`) —
is skipped, and renders again before an event reaches it, so a handler never runs with a stale capture.
Hooks are found by the order of the calls, which nothing checks: call them unconditionally.

`TestDoc` is a document of records for tests: `doc.page()` is a page over it, and events fired at what the
view drew run the program on and render. `test/wac/view_test.wac` and `template/test` use it.

## The handle layer — `element.wac`

`page.root()` is an `Element`: the authority over that element and everything under it, and the only way
to reach it. `append(tag)`, `appendText(s)`, `text(s)`, `attr(name, value)`, `prop(name, value)`,
`move(before)`, `remove()`, `focus()`, `fullScreen(on)`, `on(kind, Listen, handler)` or `listen(kind, Listen)` and
`await next()`, and `await value()`. The view is built on it; a program may use it directly for a corner
of the page — `page.mountIn(element, draw)` puts a view in one. `attr` refuses `on…` names and
`javascript:` URLs, and `append` refuses the elements that run or load something on their own. `fullScreen(true)`
asks for the element to fill the screen — the browser's full screen, which a browser allows only just after a tap or a
key, or, where there is none (an iPhone's browser), the window — and `fullscreenchange` says what happened, `"1"` or
`""`, the person leaving it with Back or Escape included.

## What belongs to the page

| | |
|---|---|
| `title(t)`, `log(line)` | the document's title, and a line for the console |
| `now()` | milliseconds, from a clock that only goes forward |
| `await sleep(ms)`, `await nextFrame()`, `await painted()` | time: answering `now()` when they settle |
| `await nextFile()` | the next file the user picks with an `<input type="file">` or drops on the page — one per file for a folder, picked with `webkitdirectory` or dropped, named by its path inside it |
| `download(name, bytes)` | offer bytes to the user as a file |
| `visible()`, `onVisible(f)` | whether the reader can see the page — false with its tab in the background, the screen off or the page being left — and each change of it: where a clock stops and what is unsaved is saved |
| `zoneAt(ms)` | how many minutes the reader's local time is ahead of UTC at a moment, milliseconds since the epoch — what saying which day it is where they are takes, which the clock alone cannot |
| `location()`, `onLocation(f)`, `go(where, push)` | where the reader is — the address's `#` part — each change of it, and a new place: added to the browser's history, so Back returns from it, or in place of this one |
| `back()` | the browser's Back: to the place before this one, the history left as it was — what an app's own back button wants |
| `zoneName()` | the reader's time zone by name, `Europe/Paris` — as the browser's own `Intl` names it, which may be an older alias (`Asia/Calcutta`) |
| `await stored(key)`, `store(key, value)`, `unstore(key)` | the page's small store: the browser's `localStorage` for its origin, so what a page written in JavaScript stored there is read here too |
| `sound(samples, rate)`, `soundStereo(left, right, rate)` → `Sound`; `.play(volume)`, `.loop(volume)`, `.playAt(volume, loop, at, offset)`, `.playAfter(voice, volume)` → `Voice`; `.forget()`; `.stop()`, `.fade(volume, ms)` | sound the program made — samples from -1 to 1, one channel or two — sent once and played as often as it likes, now or at a moment by `now()`'s clock — voices started for one moment start together, to the sample — and faded smoothly; heard once the program has resumed the audio. **Sound made as it is heard** is a sound per chunk, each played after the last (`playAfter`): it starts where that one ends, by the audio's own clock, so the joins have no gap, and each is forgotten once played (`forget`) so the page does not keep them all (`example/stream.wac`) |
| `resumeAudio()` → `Ticket<Result<string, string>>`; `audioState()` → `Ticket<string>` | the browser's `AudioContext.resume()` and `.state` — `suspended`, `running`, `interrupted`, `closed`. **Nothing resumes the audio on its own**: a browser lets it start only from something the person has just done, so a program calls `resumeAudio` from that handler, and again when the page is seen after being hidden (`visible`). A sound asked for while the audio is held plays when it resumes only if it was asked for just before (400 ms); a loop plays whenever it runs |
| `sys` | what the build granted — see below |

A component starts work that outlives a render from an effect: a timer with `ui.every`, a loop awaiting
`page.nextFrame()` or `page.nextFile()` that sets state as things arrive. A canvas is named with a ref
and drawn from an effect with `pixels(w, h, rgba)` or `pixelsIn(x, y, w, h, rgba)`, and a handler's event
carries `x` and `y` in the pixels of the element that listened — a canvas's backing store's. **A canvas is drawn in
the program's own worker** where it can be: the first time it is drawn, the document hands it over
(`transferControlToOffscreen`), and from then on each frame is drawn where it was made, with nothing sent to the
document — or, in a window of a desktop, through the desktop's worker on the way, which a child's surface is passed
down past. A page on the page's own thread, or a test's, draws the usual way.

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

**SVG is drawn with quoted tags** — `<"svg" width="120" height="60"><"line" x1="10%" … /></"svg">` — and the
document makes an `svg` and everything inside one in SVG's namespace, where it draws. Attribute names are held to
`[a-z][a-z0-9-]*` there as everywhere, so a drawing is laid out in percentages of its box rather than with a
`viewBox`.

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
and so is `sys.cli`, which is no way around the grants. The clock, randomness and output need none. wac's
`packages/platform/example/notes.wac` keeps a note that survives a reload.

A page built with `--spawn <export>` can start copies of itself: `sys.procs().spawnSelf(args, …)` starts its
module again in a worker of its own — where there is no document, so it runs `export async i32 <export>(Sys sys)`
instead — with those arguments, its input fed by the
parent, its output and errors read back on handles, and — when asked — its files reached through the
parent's. That is how a shell's pipeline stages are processes in a page.
wac's `packages/platform/example/procs.wac` is the smallest one: a page that
starts a copy of itself, streams text into it and reads it back upper-cased.

**And any page can start a module it holds** (design/system/0015): `sys.procs().spawn(wasm, args, …)` with a
module `wac build` wrote — read from the page's disk, say — runs it in a worker of its own, the same way, so a
shell on a page runs a program from its disk as it does anywhere else. The worker drives the module from the
`wac.manifest` section it carries and serves its requests as it serves the page's; a page cannot wait, so an
`async` program hands control back at each wait and is run on when the answer arrives, and one whose `main` is not
`async` stops at its first wait for the browser. A file that is not a wac module is refused at `spawn`. Such a
module holds what it was handed and no more, and can itself `load` a module and call it by name — so the `wac`
command, run that way, can `check`, `build`, `run` and `test`.
[`example/spawnpage.wac`](example/spawnpage.wac) runs
[`spawnchild.wac`](example/spawnchild.wac), built, from its storage. A page's own program can `load`
a module too.

**The page's own thread starts every program**, for whichever worker asks — the page's program, a copy, a module,
or anything those start — and hands the two ends of a `MessageChannel` to parent and child, which then talk
directly. That is because a page opened from `file://` may not start a worker from a worker, while its own thread
may; so processes, and stopping one with `^C`, work from a file as they do over `http://`.

Nothing waits for the browser: each call that reaches it returns a ticket at once, and the browser
calls back when the work is done. So a host ticket is `await`ed — `await cli.readFile(p).ticket()` —
and `.wait()` on one that has not arrived traps saying so, where on a command line it would block.

## A page is a capability — `wac.page`

**Everything a page does is a request to the program's host** ([`src/line.wac`](src/line.wac)). The program
finds the page by name — `Page.open(sys)` asks its host for `wac.page` in a version `^1` allows — and is
answered with a range of request numbers, one per operation. Changes to the document never wait: they are
held and sent together, one request a turn (`PAGE_BATCH`), and before anything the program asks, so a read sees
what was made before it. Everything that comes back is an answer to a request the program made — the next event,
the next frame, the next file handed over, an element's value, the next change of location. The clock
and timers are `std`'s, which every host answers itself.

So **whoever answers draws**: a standalone page's host into the document, a desktop into one of its windows, a
test into records. The program cannot tell which, and one with no page — run from a command line — is told so
by `Page.open` rather than handed one that draws nowhere. A host written in wac answers with what `line.wac`
exports: `PAGE_*` for the operations, `pair`, `quad` and `eventAnswer` for the fields.

**A page served into an element of another page** — `PageServer` (`src/serve.wac`), a desktop's window — should be
served into that element's shadow root, `element.shadow()`: its stylesheets then apply in that element and
nowhere else, in neither direction, so the page around it cannot restyle what it draws, nor it the page around
it. The page's own stylesheet names its variables on `:host` as well as `:root`, which matches nothing there. When the
element is gone — the window closed — `server.close()` answers what the page waits for "closed", and the page's
`page.closed()` settles: a program with several windows forgets that one. **Full screen is never the served page's to take**: its
`element.fullScreen(on)` asks the server, which asks whoever set `server.whenFullScreen(ask)` and refuses without
one, and what was decided reaches the page's `fullscreenchange` listeners by `server.fullScreened(on)` — so a desktop
decides when a window fills the screen, and keeps the way out of it its own. `server.heardAt` is when the page last
heard the person press, click or type — known before the page is told — so that whoever decides can give full screen
only to a page asking just after.

## The site a page came from — `wac.site`

`Site.of(sys)` is the site the page was served from — `site.address` where, to give someone to open it — and `site.get(path)` a GET of a path under the page's folder —
the browser's cache doing the caching, nothing copied anywhere. `siteFiles(site)` is the site as files, read-only:
a read is a GET, and a listing or a size comes from the site's `index.json`, which its build writes with

    wac run --allow-read --allow-write tools/index.wac <site-dir>

after everything else is in place — or, from the site's own build, with `indexSite(files, out, siteDir)`, which
`webbuild` exports beside `buildPage`. A page opened from a file has no site, and `Site.of` says so. The page's policy
allows its own origin to be read for this (`connect-src 'self'`), and nothing else.

## The server it came from — `wac.origin`

`Origin.of(sys)` is the origin the page was served from — `origin.address`, `https://app.example` — to talk to:
`await origin.request(method, path, headers, body)` answers a `Reply` (`status`, `header(name)`, `body`, `text()`), whatever
its status, and `await origin.open(path)` an `OriginSocket`, a WebSocket to the same origin: `send(text)`, `await next()`
— `Message.Text`, `Binary` or `Closed(code, reason)`, in the order the server sent them whether or not the program was
waiting — and `close()`. A path, never a URL: the host resolves it against the origin and refuses it if it lands anywhere
else, so a page reaches what its policy (`connect-src 'self'`) already allows and nothing more. It is for an app whose
API is beside its page, as most are; `wac.site`, a GET of a file under the page's folder, is narrower and stays its own.
A page opened from a file has no origin. The browser's host answers in the program's own worker (`fetch`, `WebSocket`),
so nothing goes by the document.

`TestDoc.serving(server)` serves it in a test: `server` answers each request — method, path, fields one a line, body —
each socket opened is in `doc.sockets` with what the program sent on it, `doc.onSend` hears each message as it is sent,
and `socketSay` and `socketClose` are the server's side. Answers come in a turn of their own, as a browser's do.

## A GPU — `wac.gpu`

The browser's host also answers `wac.gpu` with `navigator.gpu`: WebGPU's compute half in five verbs — make a buffer,
write it, run a WGSL program over buffers, read one back, free one — numbered by the program as elements are, and
held and sent a batch at a time as `wac.page`'s changes are. Only a read waits, and what the GPU reports going wrong is
answered as the next read's fault. The client, and the tensor library built on it, is
[wac-tensor](https://git.voltrevo.com/wac-tensor.git)'s `src/gpu/line.wac`; this package holds only the host, in
`programSide`. A browser without WebGPU answers the lookup with why.

## Testing a page without a browser

`TestDoc` is such a host: `doc.page()` is a page over it, every request the program makes lands in its
records and in `doc.said` — each change as it is made, or, from `TestDoc.batched()`, together at the end of the
turn as a browser's host has them — and every answer is the test's to give — `fire` and `event` for events, `advance`
for the clock and the sleeps it wakes, `paint` for frames, `answerValue`, `hand` and `go`.
[`test/wac/page_test.wac`](test/wac/page_test.wac) does that for every order in which things can arrive.

## Building one

    wac run --allow-read --allow-write --allow-run tools/build.wac \
        <entry.wac> <out-dir> [--module-only | --draw | --wrap] [--in-page] [--dev] [--edge] [--module-file] [--site-url <url>] [--app <icon.png> [--app-color <#rgb>]] [--grant read,write] [--spawn <export>] [--title <t>] [--page <spec>] [--wac <binary>]

`tools/build.wac` writes three files: `page.wac`, **the page's program as a module** — a `main(Sys sys)` that
opens the page its host provides, runs your `main(Page page)`, and renders each time a view has something to
render — then `page.wasm`, that module as `wac build` makes it, and `index.html`, which holds the module and the
host. A host with no page — a copy started by `spawnSelf`, or a command line — runs `--spawn`'s export instead,
or says it has no page. So the same `page.wasm` runs in this page, from a command line, or in a desktop's window.

The host is two halves that talk by messages. The program's half drives the module from its manifest, as it
drives every module a page starts, and answers `wac.page` over the requests every program makes: each change the
program asks for becomes a message, and each event, frame, file and value the document sends back answers the
request waiting for it. The document's half applies each message. By default the program's half runs in a
worker started from the page's own text; `--in-page` joins the two halves directly on the page's thread. Neither
half makes a decision; everything a page does is in `src/`, and what it was not granted is refused naming the
`--grant` that would allow it.

**`--edge` draws to the screen's edges**: under a phone's notch and home bar too (`viewport-fit=cover`), for a page
that keeps its content clear of them with `env(safe-area-inset-…)`. Every page is made smaller by an on-screen
keyboard rather than covered by it (`interactive-widget=resizes-content`), where the browser offers the choice.

**A page that exports its first frames gets them in its HTML**, so the reader sees the page before the module has
arrived. The export is the opt-in, from the entry file itself:

```wac
export Frame[] prerendered() {
  return [Frame.at(390, 844, "(max-width: 699.98px)"), Frame.at(1280, 800, "")];
}
```

Each `Frame` is a window's size and a CSS media query, `""` for any. The build draws each one by running the page's
own module with no page (`--frames`, `--frame <k>`, `drawFrames`): the program is handed a document of records
(`Prerender`, `src/prerender.wac`) whose window is that size, and what its first batch drew is written out. The first
frame is what `main` draws in its first turn, so a program that draws its layout from `page.size()` — the window's size
when the page opened, which the host says before that turn — draws each frame's layout, and in the browser the same one.
One frame for any window goes in `#app` as it is; several are each wrapped, after a stylesheet that shows the first
whose query matches, so the browser picks one before any script runs, and the host keeps that one by the same rule.
Make the queries from the same constants as the program's own rule, and the two cannot disagree.

**In the browser the host adopts the frame**: each element carries its handle (`data-wac-h`) and each text node follows
a comment naming its, and for each handle the program's first batch makes, the node already there is kept — moved only if
it is somewhere else, an attribute set only if it differs — and once the batch is applied whatever it did not make or
keep is removed, with the marks. A node kept is the node the reader may already have focused, typed into or scrolled.
What the reader does before the program listens — clicks, keys, edits — is kept by a small script after `#app`
(`earlyScript`, allowed by its hash) and handed to the program's listeners once the first batch has put them there,
without dispatching it again; a field typed into early keeps what was typed. A frame in the browser that differs from the
build's is mended rather than wrong, and said on the console: `wac: hydrated — 8 kept, 1 made, 1 removed, 2 changed`. A shadow root
and a canvas's pixels are not markup, and are drawn when the module runs.

The export is found by reading the entry file, not by compiling it — the program is compiled once, as the page's
module, which must name `prerendered` only if it is there — so it must be declared in the entry file. The module that
draws the frames is the one that is shipped, and it carries the drawing: about 30 KB more for a page that exports
frames, nothing for one that does not. Building in steps, `--draw` runs the built module to write `<out>/first.html`,
between building `page.wasm` and `--wrap`, which reads it.

**`--module-file` puts the module beside the page** rather than in it: `page.wasm`, which `index.html` fetches as
`page.wasm?v=<version>` — the version a hash of its bytes (`versionOf`), so a browser with an older one cached fetches
the one this page was built with. `index.html` is then its first frames and its host: for wac-desktop, 259 KB where it
was 1.5 MB, the megabyte of module downloaded once and cached. Pages that share a module share that download. What the
document says before the module has arrived — that it is seen, a click on the first frame — is held for the program and
given to it when it starts. A page opened from a `file://` URL cannot fetch its module, so a page built this way is for
serving; without the flag a page is still one file that works from anywhere.

**A site of pages, one program**: a `Frame.on("/docs/a/", w, h, query)` is the page at that path, and the build writes
each path's frames as a page of its own, `<out>/docs/a/index.html` — what a link to it loads, before any script, and
what a search engine reads. `page.path()` is where the reader is on the site, from its root however deep the site is
served — `/docs/a/` on `https://example.org/wac/docs/a/` — known before the first turn, so the program draws that page
from its first frame. `page.title(…)` and `page.describe(…)` in that turn are the page's `<title>` and description.
`page.routeLinks()` has a click on a link to a page of the site go there without loading again: the address changes,
`onPath` hears the path, and Back and Forward are heard the same way; `page.navigate(path, push)` goes there from code.
`hrefTo(from, to)` writes a link that works from any page of the site. With `--module-file` every page fetches the one
`page.wasm` at the site's root, so a reader downloads it once. `--site-url <url>` gives each page its canonical address
and writes `sitemap.xml`. `example/routes.wac` is a site of three pages; `test/routes_live.test.ts` follows it.

**`--app <icon.png>` makes it an app to install**: beside `index.html` the build writes a manifest — the page's
title as its name, standing alone (`display: standalone`), `--app-color` its bar — the icon, square and at least
512 pixels, which is also a phone's home-screen icon, and a service worker, `sw.js`. The service worker answers from
the network first and keeps a copy of each of the site's files as it arrives, answering from the copy only when the
network cannot: an installed app opens offline, and online it is never older than the site. The page's policy
allows its own manifest, icon and worker (`'self'`), and nothing more. Served over http only — a page opened from a
file has no origin to install from.

**`--dev` is a development build**: after every turn each view renders everything again and logs, to the
console, each place the page does not show what a component renders — which happens only when a render
read something changed without a `set`, a `Vec` in a cell pushed to in place.

**The page carries a Content Security Policy.** The one script it runs as written is a fixed loader,
allowed by its hash, which starts the rest from `blob:` URLs; nothing is loaded from anywhere else — no
outside image, style sheet or font — and an inline handler or a script element written into the
document by any route does not run. A test driving a built page waits with `waitInPage` from
`test/harness.ts`, since Playwright's string `waitForFunction` is an `eval` the policy refuses.

The output directory has to be inside the directory the build runs in, since the page's module is written
there and imports the program.

`--page` names the module the page's module imports `Page` from: `web` by default, which is how a project
that depends on this package spells it, and `./src/page.wac` from this repository's root.

**Where nothing may start a process, it is three steps of its own.** The build runs `wac build` as a command, and a
sealed builder cannot: so `--module-only` writes `page.wac` and stops, the builder compiles it however it compiles
(`wac build <out-dir>/page.wac -o <out-dir>/page`), and `--wrap`, given the same arguments, wraps the `page.wasm` that
made into `index.html` (and an app's files). Neither half needs `--allow-run`, and the page is byte for byte the one
the whole build writes into the same directory. From wac, they are `writePageModule` and `wrapBuiltPage`, beside
`buildPage`.

## Where it is used

In wac: `packages/platform/example/{counter,life,pixels,ripple,notes,procs}.wac`,
`packages/box/example/{hash,term,desk,rasterterm}.wac`, `packages/git/example/gitpage.wac`,
`packages/wacc/example/waccpage.wac`, `packages/raster/example/rasterdesk.wac` and the site, which import
this package by git. Outside it: `wac-desktop`.

The shell and the desktop are pages built `--grant read,write --spawn applet`: every applet a process,
every file in the Origin Private File System, and the command a task the page keeps reading the keyboard
beside — so `^C` stops it. wac's `packages/box/example/rasterterm.wac` is the same shell drawn on a canvas.

## Testing

    wac check . && wac test test/wac                 the package, with no browser — about a second
    deno test -A --unstable-net --no-check test/     the template outside the repository, and pages in Chromium
    tools/push.sh                                    all of it, then push

`$WAC` names the `wac` the Deno tests run, and the one on `PATH` otherwise. The browser tests skip, loudly,
with no Chromium in `~/.cache/ms-playwright`.
