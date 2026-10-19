# 0012 — a page is a tree of handles, and diffing is a library over it

- **Status:** proposal
- **Raised by:** agent-a, 2026-10-18, on the operator's direction: "there should be an underlying api that
  simply captures what we can do, and then we make diff-based rendering on top of that … I can see a need to
  be able to create a handle through which only one element (incl its events) is visible"
- **Spans:** `packages/web`, `core/html.wac` and the JSX attribute set, `packages/web/tools/build.wac`, every
  page in the repository

## The target

Two layers, the lower one complete without the upper:

1. **`Elem`, a handle to one element.** Holding it is the authority to change that element and everything
   under it, and to hear their events — nothing above it or beside it. `main` is handed one, the root. A
   child made through a handle comes back as a handle. Passing an `Elem` to a widget is a grant, as passing
   `Sys` is.
2. **`View`, diffing over one `Elem`.** `v.render(view(state))` turns the difference from the last render into
   `Elem` calls. It is an ordinary library: anything it does, an application could do by hand.

What it is **not**: a mirror of the browser's DOM. There is no `querySelector`, no `parentNode`, no
`innerHTML`, no way to name an element by a string the whole page shares, and no read that does not say it
waits.

## What the current model gets wrong

Measured or read, 2026-10-18, at 5133ae836:

- **Elements are named by page-global strings.** `desk.wac` builds `"scr\{w.id}"`, `"cmd\{w.id}"` and
  `"bar\{w.id}"`, and parses them back with `idOf(e.id, 3)`. Every page that has more than one of anything
  does a version of this.
- **Re-rendering throws away what the user is doing.** `render` is `innerHTML`, so `desk.wac`'s `redraw`
  reads every terminal's half-typed command with `getValue`, re-renders, and writes them back. A key typed
  between the read and the write is lost, and focus and caret go anyway.
- **"Everything is escaped" is not true.** A `Node` built by hand runs script through `render`:
  `Node.Element("img", [Attr("src", "x"), Attr("onerror", "…")], [])` becomes `<img src="x" onerror="…">`,
  and so does plain markup with a quoted tag, `<"img" src="x" onerror="…"/>`. A tag name is written unchecked, so `"img src=x onerror=… x"` is an element too. A JSX `href` may be
  `javascript:`. Only `<script>` is inert, and only because `innerHTML` never runs one — a `createElement`
  layer would.
- **The DOM is an ambient network capability.** `<img src="https://elsewhere/?secret">`, a CSS `url()` or a
  link sends data off the page. A page program has no `Sys` network grant and can still do this.
- **The named tags' attribute set is closed** — 39 names in `core/html.wac`, so `<div aria-label="…">` is
  refused. A quoted tag, `<"div" aria-label="…">`, takes any attribute, which is the same gap from the other
  side: nothing between "39 names" and "anything, `onerror` included".

## The lower layer: `Elem`

```wac
export async i32 main(Page page) {
  Elem root = page.root();
  Elem up = root.append("button");
  up.text("+1");
  Elem n = root.append("b");
  n.text("0");
  up.listen("click");
  i32 count = 0;
  while (true) {
    await up.next();
    count += 1;
    n.text("\{count}");
  }
}
```

| | |
|---|---|
| `append(tag)`, `insert(tag, before)` | a child element, as a new handle |
| `appendText(s)` → `TextNode` (`set(s)`) | a text child the program can change later |
| `text(s)` | replace everything under it with text |
| `attr(name, value?)`, `prop(name, value)` | an attribute (null removes it); a property, for `value`, `checked`, `selected` |
| `move(before)`, `remove()` | reorder within its parent; remove it, ending every handle under it |
| `listen(kind, Listen opts)` | deliver `kind` events from it and everything under it |
| `next()` → `Ticket<Event>` | its next event; `Event.target` is the handle it happened on |
| `focus()`, `scrollTo(…)`, `pixels(w, h, rgba)`, `pixelsIn(…)` | write-only, so nothing waits |
| `await value()`, `await rect()`, `await selection()` | the reads, each a round trip, so each is a ticket |

**`main` is `main(Page page)`, always** (operator, 2026-10-19). What the build granted hangs off the page as
`page.sys`, a `Sys` whose `Cli` refuses whatever was not granted — "not granted: build with `--grant read`".
The grants still decide everything; only the entry's signature stops varying with them. Until now a page
built with grants was `main(Page page, Sys sys)` (0011).

`Page` keeps what belongs to the page rather than to an element: `title`, `now`, `sleep`, `nextFrame`,
`painted`, files dropped or picked, `download`.

### Decisions, with their reasons

- **The program mints the handles.** A handle is a number the program chooses; the document records the
  element it made under it. So making and changing elements never waits — the benchmark's 15× is the cost
  of a read, and only reads pay it.
- **A handle lives as long as its element is in the tree.** `remove` ends it and every handle under it; a
  call on an ended handle traps saying which. The program keeps a mirror of the tree — parents and children,
  no attributes — which is what makes ending a subtree and checking scope possible. Without this, nothing
  tells the document when a handle can be forgotten, and the table only grows.
- **A handle reaches its subtree.** The holder of a parent made the child, and can already remove it; hearing
  its events adds nothing. What a handle cannot reach is above it or beside it. `Event.target` is a handle
  inside the listener's subtree, so it widens nothing.
- **What the document does with an event is declared up front.** In a worker the program learns of a keydown
  after the browser has acted on it, so `preventDefault` cannot be decided per event. `Listen` says it
  instead: `prevent`, and for keys the keys it applies to — a terminal claims `Tab` and arrows, not `Ctrl+C`.
  Only events listened for cross, and `pointermove` is coalesced, as now.
- **Policy is in wac; the browser enforces it again.** `attr` refuses `on*` names and names outside
  `[a-z][a-z0-9-]*`, refuses `javascript:` in URL attributes, and `append` refuses `script`, `iframe`,
  `object`, `embed`, `base` and `meta` — with an error naming the call, testable without a browser. And the
  build writes a Content Security Policy that allows only its own scripts by hash. Checked 2026-10-18 in
  Chromium from `file://`, in both modes: the page runs, and an injected `onerror`, a `javascript:` link, an
  injected `<script>` and an outside image are all refused.
- **Outside URLs are a grant.** The policy allows `data:` and `blob:` and nothing else off the page;
  `--grant net` (or a list of origins) widens `img-src`, `connect-src` and the rest. A page with no grant
  cannot send anything anywhere.
- **Calls are batched per turn.** Every call is a message today, about 1.6 µs extra each in a worker. The
  program side buffers until it next waits and sends one message; a diff that makes 500 changes costs one.
- **An input's value is the user's.** A `prop("value", …)` the program sends is dropped if the user has typed
  into that element since the last event the program had seen when it sent it — so a re-render that lags
  behind typing cannot undo a keystroke. `input` and `change` events carry the value, so `value()` is rarely
  needed.
- **The protocol is a list of operations, and its test double is the mirror.** Today a test hands `Page` a
  `Dom` of lambdas. Instead the program-side mirror can carry tags, attributes and text when asked, and a test
  asserts on the tree it holds — the same structure that checks scope in production.

## The upper layer: `View`

Handlers are callbacks (operator, 2026-10-19). An element in a view carries closures, and the closures
change the application's state directly:

```wac
observed struct Todos { string draft; List<Todo> items; … }

export async i32 main(Page page) {
  Todos s = Todos.empty();
  page.mount(() =>
    <div>
      <input value={s.draft} oninput={(Event e) => { s.draft = e.value; }}
             onkeydown={(Event e) => { if (e.key == "Enter") { s.add(); } }}/>
      <ul>{s.items.map<Node>((Todo t) =>
        <li key={"\{t.id}"}>{t.text} <button onclick={() => { s.drop(t); }}>×</button></li>)}</ul>
    </div>);
  await page.closed();
}
```

- **The host renders at the end of every call into the program** — an event, a timer, a frame, an answer
  from `Sys`: it runs what is ready, then renders again **only the components whose output may have
  changed** (below). So a handler that changes state after an `await` is shown when it resumes, without
  any rule about handlers, and a task started by a handler is no different from one started anywhere else.
- **Handlers may be `async` and run concurrently**, as JavaScript's do. A handler that must not run twice
  says so with state — a `busy` flag, a disabled button — which the view shows anyway.
- **Closures are rebound on every render and that sends nothing.** The listeners are on the view's root,
  once per event kind, so a new closure replaces an old one in the program's own table.
- **The view owns its `Elem`'s children.** Nobody else writes there. `ref` names an element, and
  `afterRender` runs once the render that made it has been applied — to focus it, or to draw in a canvas
  the diff then leaves alone.
- **Lists match by `key` when one is given, and by position otherwise.**
- **A stateful element is a `Component`** — below. One that runs on its own, a terminal, can instead be a
  task that owns an `Elem`.
- **What the browser does with an event is still declared, not decided.** A view says it per element —
  `prevent="Tab ArrowUp"` beside an `onkeydown` — and the view passes it to `listen`; a form's `submit` is
  always prevented, as now.
- **An event on an element the program has already removed is dropped.** A late click cannot reach a
  handler for a row that is gone.

### Components

A tag that names a function calls it, as now (spec ch23 `§wac-markup-tag-is-function`): that is a stateless
piece, and it is called afresh every render. **A tag that names a struct extending `Component` does not
call anything.** It makes a component node, and the view matches it against what it rendered at that place
last time (operator, 2026-10-19: "it would be nice to have elements with state like react").

```wac
struct Row : Component {
  Item item;                      // attributes: public fields, written by the tag every render
  fn<void()> onremove;
  private bool editing = false;   // state: private fields, kept across renders
  private string draft = "";

  override Node render(this) {
    if (this.editing) {
      return <li class="editing"><input value={this.draft}
        oninput={(Event e) => { this.draft = e.value; }}
        onkeydown={(Event e) => { if (e.key == "Enter") { this.item.text = this.draft; this.editing = false; } }}/></li>;
    }
    return <li ondblclick={() => { this.editing = true; this.draft = this.item.text; }}>
      {this.item.text} <button onclick={this.onremove}>×</button></li>;
  }
}

<ul>{items.map<Node>((Item it) => <Row key={"\{it.id}"} item={it} onremove={() => { drop(items, it); }}/>)}</ul>
```

- **The same place, the same type and the same `key` is the same instance.** Its attributes are rewritten
  from the new tag and its state carries over; anything else is a fresh instance with every field at its
  default.
- **Public fields are attributes and private fields are state**, which is a rule the language already has:
  named construction from outside a struct may leave a private field out and may not set one (spec ch12), so
  the private fields are exactly those a tag cannot reach. Every render writes *every* public field, so an
  optional attribute dropped from the tag goes back to its default rather than keeping last render's value.
- **The tag lowers to two lambdas**, which the prototype wrote by hand: `make`, `() => Row { item: it,
  onremove: f }`, and `adopt`, which answers false unless `old is Row` and otherwise writes the attributes
  into `old as! Row`. The view keeps the instance beside the element it rendered.
- **`mounted(Elem)` and `unmounted()`** are the lifecycle: a component that starts something — a timer, a
  task, a subscription — starts it in one and stops it in the other.
- **Struct fields rather than hooks.** A hook is state found by the order of calls in a function, stored
  untyped and read back by a cast; a field is typed and declared where a reader looks. Everything needed —
  subtypes, `virtual`, `is` and `as!`, field defaults, private fields — is already in the language.
- **Function tags stay.** A piece with no state is a function, called directly, with nothing kept.
- `design/lang/0005` had struct components with a `render` method, retired for tags that call. This brings
  structs back for a different reason: not to type the attributes, which functions already do, but to give
  an element an identity across renders.

### Rendering only what changed

Re-rendering the whole view every turn is not an optimisation to add later (operator, 2026-10-19): a
2000-row list cost a full view build and diff per keystroke, and the cost grows with the page rather than
with the change. So the view knows what each component read, and renders a component again only when it
has to.

- **State the view shows is observed.** A struct declared `observed` has a read barrier and a write
  barrier on its fields, emitted by the compiler: a read while a component renders records that component
  against that field of that object; a write marks every component recorded there as dirty. `Component`
  is observed, so a component's own state is. `List<T>` and `Map<K, V>` are observed collections, written
  in wac as observed structs over `Vec` and `Map`.
- **A local that a closure assigns is observed too.** Such a local is already a heap cell, because closures
  capture by reference; its reads and writes get the same barriers. So `i32 n = 0;` in `main`, shown in the
  view and changed by `onclick={() => { n += 1; }}`, renders what reads it — the counter that worked under
  full re-rendering still works.
- **"Who is reading" is a dynamically scoped slot, like the schedule target.** The language has no mutable
  module state, and the reader cannot be passed down: a read may be in any function the render calls. The
  schedule target is the precedent — one slot, in force for a block, seen through calls — and the view is
  the one user of the new one, setting it around each component's render.
- **A component renders again when something it read was written, or when its attributes changed** —
  by identity for a reference and by value otherwise. A parent rendering again does not render a child
  whose attributes are unchanged.
- **Handlers are not compared.** A closure is new every render, so comparing them would render every child
  every time. A child whose only changed attributes are handlers is marked *stale* instead, and renders
  before an event is dispatched through it — so a handler that captured something that has since changed,
  an index say, is never the one that runs.
- **Dirty components render outermost first**, once per turn; one that its parent already rendered this
  turn is not rendered again.
- **What is not observed is not shown when it changes**: a plain struct's field, or a `Vec`, written in a
  handler. That is the mistake this design invites, so a development build checks for it: after each turn
  it renders everything as well and reports any element where the two disagree, naming the component.

### What the prototype showed

A throwaway prototype, 2026-10-19, put both layers in wac over a fake document: a mirror of the tree,
the keyed diff, the turn, and a `Clock` a test moves on. Seventeen patterns, each written as an application
would write it and checked, and the eight checks that matter mutated to make sure they can fail. The tracking was written by hand —
each barrier a method call, the reader passed to each object — as the compiler would emit it:

| pattern | how it reads |
|---|---|
| a counter | a local and a closure; closures capture by reference, so `n += 1` in a handler is `main`'s `n` |
| a list | typing into state, Enter adds, each row's button captures its own item; removing a middle row creates nothing and keeps the rows either side |
| async work | `async void load(...)` called from a handler; the view shows "loading…" and then the result, and a busy flag stops a second load |
| debounce | a generation counter: `i32 mine = ++s.generation; await sleep(300); if (mine != s.generation) return;` |
| a confirm dialog | `if (await d.confirm("Delete?")) {...}` inside a handler; the dialog is state plus a `Ticket<bool>` its buttons settle; Escape bubbles to it |
| a drag | either three handlers and a flag, or one `async` function awaiting a queue that two handlers fill — both agree |
| a component | `Tabs` with its own `open`, used twice, each instance independent |
| focus | `afterRender(() => ref.focus())` from the handler that added the field |
| typing ahead of the program | a render for "a" arriving after the user typed "ab" is dropped by the document; once caught up, the program's value applies |
| animation | a loop of `await sleep(16)` started by one button and stopped by another flag |
| a late click | a click on a row whose neighbour was removed meanwhile removes the row the user saw; on a row that was itself removed, nothing |
| a row with its own state | a row put into editing and half-typed keeps its instance, its mode and its draft when a row is inserted above it; Enter saves it |
| a component that runs something | a ticking component starts its loop in `mounted` and its loop ends after `unmounted`; shown again, it starts from 0 |
| what renders, 2000 rows | three keystrokes render the field three times and nothing else; ticking a row renders that row and the count; adding renders the field, the list, the new row and the count — no existing row |
| a stale handler | each row's remove handler captures its *position*; after row 0 goes, clicking "item 1" removes item 1, because its stale row renders before the click is dispatched |
| per keystroke, 2000 rows | 0.19 ms with tracking; 11 ms rendering everything (the prototype's diff is quadratic in a list's length; a linear one would be nearer 3 ms) |
| cost | building a 2000-row view — 8000 nodes, 4000 closures — takes 1.5 ms; the diff about as much again |

### What it found missing

- **Six compiler bugs**, each filed with a reproduction:
  - an `async` lambda inside an `async` function (lang 0380a) — blocks async handlers written inline in `main`;
  - a closure capturing a `for … in` variable (0381a) — the shape of every row's handler; `map` avoids it;
  - a lambda in a slot the positional walk does not type (0382a): an index assignment, a variant
    constructor's argument, and a markup attribute (0383a) — the last is where every handler is written;
  - `virtual void` does not parse (0384a) — the lifecycle hooks are `virtual void`;
  - `q is b ? 0 : 1` in a lambda emits invalid wasm (0385a) — the generated `adopt` compares attributes so.
- **`Vec.map`** — `fold` is there; `map<U>` is the same method with a different body, and a list in a view
  is a `map`.
- **Cancellation.** A ticket cannot be cancelled, so debounce and "the user navigated away" are generation
  counters, and the work underneath carries on. Fine for a timer; wasteful for a fetch.
- **A trap in a handler ends the page.** There is no way to catch one, so an application cannot show "that
  went wrong" and carry on. Worth deciding rather than discovering.
- **Page-level events.** A key pressed with nothing focused, a resize, the tab hidden: none reaches the
  view's root. They belong on `Page`.

## What the language needs

- **`Node` carries handlers**: `Element(string tag, Attr[] attrs, On[] on, Node[] kids)` with
  `On { string kind; fn<void(Ev)> run; }`, and JSX turning `onclick={…}` into one. No generics; `htmlOf`
  ignores them. `key` and `ref` are attributes the view reads and never sends.
- **`Component` tags**: a tag naming a `Component` subtype lowers to `make` and `adopt` as above, and
  `Node` gains a variant carrying them.
- **Observation**: `observed struct`, its barriers, the barriers on a local a closure assigns, and the
  dynamically scoped reader slot. `List<T>` and `Map<K, V>` over them, in core.
- **`data-*` and `aria-*` on the named tags.** Quoted tags already take any attribute; the named ones take 39.
- **`{rows}` for a `Node[]` child**: a `toNode` for `Node[]`, answering a `Fragment`. `{s}` for a `string`
  already works.
- The six bugs above, and `Vec.map`.

## The order of work

1. **Close the injection in today's `render`**, with the CSP in the build. Independent of the rest, and true
   of what ships now. (A failing case first: the four constructions above.)
2. **`Elem`**: the operations, the mirror, events per handle, batching, `Listen`. Port `counter` and `notes`.
3. **The language changes** above: handlers on `Node`, `Component` tags, observation, `data-*` and
   `aria-*`, `{rows}`, the six bugs, `Vec.map`.
4. **`View`**: the diff, the turn, `key`, `ref`, `afterRender`, components, rendering only what changed and
   the development build's check of it. `main(Page)` with `page.sys`. Port `templates/webapp`.
5. **The desktop**, with windows as tasks owning `Elem`s; then the terminal, then every other page.
6. **Delete** `render`-as-`innerHTML`, `setText`, `setValue`, `setStyle`, `renderInto`, `getValue` and
   `page.on`. `htmlOf` stays, for a page written out as a file.

## State of play

| step | state |
|---|---|
| 1 | not started |
| 2 | not started |
| 3 | not started |
| 4 | not started |
| 5 | not started |
| 6 | not started |
