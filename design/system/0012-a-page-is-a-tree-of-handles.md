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

Handlers are callbacks (operator, 2026-10-19). An element in a view carries closures, and a component is a
function whose first parameter is `Ui`, through which it keeps state:

```wac
struct Todo { i32 id; string text; bool done; }
struct App { (const Todo)[] items; i32 nextId; }

export async i32 main(Page page) {
  page.mount((Ui ui) => {
    auto app = ui.state(App([], 1));
    return <main>
      <NewTodo onadd={(string text) => { app.update((const App s) => added(s, text)); }}/>
      <ul>{app.get().items.map<Node>((const Todo t) =>
        <Row key={"\{t.id}"} todo={t} ontoggle={() => { app.update((const App s) => toggled(s, t.id)); }}/>)}</ul>
    </main>;
  });
  await page.closed();
  return 0;
}

Node NewTodo(Ui ui, fn<void(string)> onadd) {
  auto draft = ui.state("");
  return <input value={draft.get()} oninput={(Event e) => { draft.set(e.value); }}
                onkeydown={(Event e) => { if (e.key == "Enter") { onadd(draft.get()); draft.set(""); } }}/>;
}
```

- **The host renders at the end of every call into the program** — an event, a timer, a frame, an answer
  from `Sys`: it runs what is ready, then renders again **only the components that have to** (below). So a
  handler that changes state after an `await` is shown when it resumes, without any rule about handlers,
  and a task started by a handler is no different from one started anywhere else.
- **Handlers may be `async` and run concurrently**, as JavaScript's do. A handler that must not run twice
  says so with state — a `busy` flag, a disabled button — which the view shows anyway.
- **Closures are rebound on every render and that sends nothing.** The listeners are on the view's root,
  once per event kind, so a new closure replaces an old one in the program's own table.
- **The view owns its `Elem`'s children.** Nobody else writes there. `ref` names an element, and
  `afterRender` runs once the render that made it has been applied — to focus it, or to draw in a canvas
  the diff then leaves alone.
- **Lists match by `key` when one is given, and by position otherwise.**
- **One that runs on its own, a terminal, can instead be a task that owns an `Elem`.**
- **What the browser does with an event is still declared, not decided.** A view says it per element —
  `prevent="Tab ArrowUp"` beside an `onkeydown` — and the view passes it to `listen`; a form's `submit` is
  always prevented, as now.
- **An event on an element the program has already removed is dropped.** A late click cannot reach a
  handler for a row that is gone.

### Components are functions of `Ui`

A tag that names a function calls it, as now (spec ch23 `§wac-markup-tag-is-function`). **A function whose
first parameter is `Ui` is a component** (operator, 2026-10-19: "it would be nice to have elements with
state like react", and then hooks over struct components): its tag is not called but becomes a node that
the view matches against what it rendered at that place last time. Its other parameters are its
attributes. A function without `Ui` is a stateless piece, called afresh every render as now.

```wac
Node Row(Ui ui, const Todo todo, fn<void()> ontoggle) {
  auto editing = ui.state(false);
  auto draft = ui.state("");
  if (editing.get()) {
    return <li class="editing"><input value={draft.get()}
      oninput={(Event e) => { draft.set(e.value); }}
      onkeydown={(Event e) => { if (e.key == "Enter") { editing.set(false); } }}/></li>;
  }
  return <li class={todo.done ? "done" : ""} ondblclick={() => { draft.set(todo.text); editing.set(true); }}>
    <input type="checkbox" onchange={ontoggle}/> {todo.text}</li>;
}
```

- **`auto editing = ui.state(false)` is the idiom**, so the type is written once. `ui.state` answers a
  `State<T>`: `get()`, `set(x)`, and `update(f)`, which applies `f` to the current value — so two handlers
  that each `await` and then update cannot lose one another's change.
- **The same place, the same function and the same `key` is the same instance**, and its `Ui` — its slots —
  carries over. Anything else is a fresh instance.
- **A hook is found again by the order of the calls.** Nothing enforces that order (operator, 2026-10-19:
  interfere when a program is known to be wrong, not when it merely cannot be shown right). A component that
  calls `ui.state` inside an `if` gets the wrong slot and traps on the cast, or reads another hook's state;
  a compiler warning for a hook under a condition is a possibility, not a rule.
- **A helper that calls hooks is an ordinary function that takes `ui`** — the reason to have hooks at all,
  since stateful logic is then reused by calling it:

  ```wac
  string debounced(Ui ui, string value, i32 ms) {
    auto out = ui.state(value);
    ui.effect(value, () => ui.after(ms, () => { out.set(value); }));
    return out.get();
  }
  ```
- **`ui.memo(dep, f)`** answers `f()` again only when `dep` changed. **`ui.effect(dep, run)`** runs `run`
  after the render when `dep` changed; what `run` answers is its cleanup, called before the next run and
  when the component goes. A dependency is the same when it is equal by value for a number or a string and
  identical for a reference.
- **Timers come from `ui` and die with it.** `ui.after` and `ui.every` answer their cancel, and a removed
  component's timers never fire whether or not anything cancelled them — a component cannot leak one.
- **A closure holds the cell, not a copy of the value.** `draft.get()` in a handler that resumed after an
  `await` reads what the cell holds now, so React's stale-closure problem does not arise.
- **The tag lowers to a node carrying the attributes, a `draw` closure and an `adopt` closure**, which the
  prototype wrote by hand: `adopt` answers -1 unless the old instance came from the same function, and
  otherwise writes the new attributes and `draw` into it and answers what changed.
- `design/lang/0005` had struct components with a `render` method; an earlier draft of this note brought
  them back, with private fields as state and `mounted`/`unmounted` overrides. Hooks replaced them because
  stateful logic in a struct can only be shared by forwarding its lifecycle by hand, and in a function it is
  shared by a call.

### Rendering only what changed

Re-rendering the whole view every turn is not an optimisation to add later (operator, 2026-10-19): a
2000-row list cost a full view build and diff per keystroke, and the cost grows with the page rather than
with the change. Nothing tracks reads:

- **`set` marks the component that made the cell dirty.** A cell belongs to one component, so that one is
  what must render again.
- **A component renders again when it is dirty or its attributes changed** — by value for a number or a
  string, by identity for a reference. A parent rendering again does not render a child whose attributes
  are unchanged.
- **So application data held in a cell is best an immutable value, replaced by `update`.** A change makes a
  new value sharing every part it did not change, and the identity of those parts is what lets a child skip.
  Toggling one row of 2000 makes a new `Todo`, a new array holding the other 1999 unchanged, and a new `App`:
  the root and the list render, one row renders, and 1999 rows are skipped on one identity test each.
  Deep `const` makes the value's own fields unwritable, so changing it in place is refused by the compiler.
- **A derived attribute wants `memo`.** `items.filter(open)` computed in a render is a new array every time,
  so its child renders every time — correct, and slow; `ui.memo(items, () => …)` keeps the array until
  `items` changes.
- **A `State` passed as an attribute is compared by its version too.** It is the same cell after every
  `set`, so compared by identity a child showing it would be skipped and show the old value:

  ```wac
  Node Show(Ui ui, State<i32> n) { return <b>{n.get()}</b>; }

  page.mount((Ui ui) => {
    auto n = ui.state(0);
    return <div><Show n={n}/><button onclick={() => { n.set(n.get() + 1); }}>+1</button></div>;
  });
  ```

  A click marks the root, the root renders, `Show` gets the cell it already had — and by identity alone,
  `<b>` says 0 forever. The tag's `adopt` therefore records `n.version` and treats a moved version as a
  changed attribute.
- **Handlers are not compared.** A closure is new every render, so comparing them would render every child
  every time. A child whose only changed attributes are handlers is marked *stale* instead, and renders
  before an event is dispatched through it — so a handler that captured something that has since changed,
  an index say, is never the one that runs.
- **Dirty components render outermost first**, once per turn; one that its parent already rendered this
  turn is not rendered again. Effects run after.
- **What is not in a cell is not shown when it changes**: a mutable struct or a `Vec` in a cell, changed in
  place without `set`. A development build checks for it: after each turn it renders everything as well and
  reports any element where the two disagree, naming the component.

### What the prototype showed

A throwaway prototype, 2026-10-19, put both layers in wac over a fake document: a mirror of the tree,
the keyed diff, the turn, and a clock a test moves on. The patterns below were each written as an
application would write it and checked, and the checks that matter mutated to make sure they can fail.
The first eleven rows were written with struct components and full re-rendering, and carry over: each is
about callbacks and the diff, not about where state lives. The rest are hooks, in `.cache/explore/ui4.wac`
and `hooks_test.wac` (14 tests):

| pattern | how it reads |
|---|---|
| a counter | a local and a closure; closures capture by reference, so `n += 1` in a handler is `main`'s `n` |
| a list | typing into state, Enter adds, each row's button captures its own item; removing a middle row creates nothing and keeps the rows either side |
| async work | `async void load(...)` called from a handler; the view shows "loading…" and then the result, and a busy flag stops a second load |
| a confirm dialog | `if (await d.confirm("Delete?")) {...}` inside a handler; the dialog is state plus a `Ticket<bool>` its buttons settle; Escape bubbles to it |
| a drag | either three handlers and a flag, or one `async` function awaiting a queue that two handlers fill — both agree |
| a component | `Tabs` with its own `open`, used twice, each instance independent |
| focus | `afterRender(() => ref.focus())` from the handler that added the field |
| typing ahead of the program | a render for "a" arriving after the user typed "ab" is dropped by the document; once caught up, the program's value applies |
| animation | a loop of `await sleep(16)` started by one button and stopped by another flag |
| a row with its own state | a row put into editing and half-typed keeps its instance, its mode and its draft when a row is inserted above it |
| cost | building a 2000-row view — 8000 nodes, 4000 closures — takes 1.5 ms; the diff about as much again |
| what renders, 2000 rows | three keystrokes render the field three times and nothing else; ticking a row renders the root, the list, that row and the count; adding renders the root, the field, the list, the new row and the count — no existing row |
| a row's own state | double-click and typing render that row and nothing else |
| a stale handler | each row's remove handler captures its *position*; after row 0 goes, clicking "item 1" removes item 1, because its stale row renders before the click is dispatched |
| memo | a filtered list kept by `memo`: an unrelated change renders the root only, and the filter does not run; without `memo` the child renders every time |
| debounce, as a helper | `debounced(ui, value, 300)`: three keystrokes 100 ms apart show nothing at 299 ms after the last and the last at 300; the earlier timers were cancelled by the effect's cleanup |
| a timer and unmount | a clock ticking from `ui.every` shows 3 after 3 s; hidden, no timer can fire and nothing renders |
| an awaiting handler | a slow `+1` that awaits, and two quick ones meanwhile: 3, because `update` applies to the current value |
| a cell as an attribute | by identity the child shows 0 after two clicks; by version, 2 |
| per keystroke, 2000 rows | 0.42 ms (0.19 ms with read tracking): the prototype finds dirty components by walking the whole tree each turn; a list of them would not |
| mount, 2000 rows | 6 ms |
| per toggle, 2000 rows | 4.3 ms — the root and the list render and the diff matches 2000 keyed rows, which the prototype does by a linear search each, so quadratic; a keyed map makes it linear |

### What it found missing

- **Six compiler bugs**, each filed with a reproduction:
  - an `async` lambda inside an `async` function (lang 0380a) — blocks async handlers written inline in `main`;
  - a closure capturing a `for … in` variable (0381a) — the shape of every row's handler; `map` avoids it;
  - a lambda in a slot the positional walk does not type (0382a): an index assignment, a variant
    constructor's argument, and a markup attribute (0383a) — the last is where every handler is written;
  - `virtual void` does not parse (0384a);
  - `q is b ? 0 : 1` in a lambda emits invalid wasm (0385a) — the generated `adopt` compares attributes so.
- **Found with hooks, not yet filed:**
  - `is` between two `anyref`s is declined by the emitter, though the spec says `is` tests identity for any
    reference type;
  - `==` on a type parameter instantiated with an array reaches the emitter and is declined there, where a
    struct is refused by the checker with a message;
  - a generic method's type parameter is not inferred from a lambda's return type: `ui.memo(items, () => …)`
    needs `memo<const Todo, i32>`;
  - a struct literal of a generic type as an argument, `push(Cell { … })`, is "not something that can be
    called"; through a typed local it works;
  - `const Todo t = …` declares a constant binding of a `Todo`, so the element of a `(const Todo)[]` cannot be
    bound with a written type; `auto` works.
- **A generic "same"** for `memo` and `effect` dependencies: by value for numbers and strings, by identity
  otherwise. The prototype takes an array for `memo` and a string for `effect` because of the first two bugs
  above.
- **`Vec.map`** — `fold` is there; `map<U>` is the same method with a different body, and a list in a view
  is a `map`.
- **Building a modified copy is long-winded.** Every update of an immutable value is a named construction
  listing every field; `t with { done: true }` would say only what changes, and copy a defaulted field
  rather than reset it.
- **Cancellation.** A ticket cannot be cancelled, so the work under a cancelled timer or a removed component
  carries on. Fine for a timer; wasteful for a fetch.
- **A trap in a handler ends the page.** There is no way to catch one, so an application cannot show "that
  went wrong" and carry on. Worth deciding rather than discovering.
- **Page-level events.** A key pressed with nothing focused, a resize, the tab hidden: none reaches the
  view's root. They belong on `Page`.

## What the language needs

- **`Node` carries handlers**: `Element(string tag, Attr[] attrs, On[] on, Node[] kids)` with
  `On { string kind; fn<void(Ev)> run; }`, and JSX turning `onclick={…}` into one. No generics; `htmlOf`
  ignores them. `key` and `ref` are attributes the view reads and never sends.
- **Component tags**: a tag naming a function whose first parameter is `Ui` lowers to a node carrying its
  attributes, `draw` and `adopt`, as above, and `Node` gains a variant for it. `Ui` is `packages/web`'s, so
  the compiler knows the type by where it comes from, as it knows `Sys`.
- **`data-*` and `aria-*` on the named tags.** Quoted tags already take any attribute; the named ones take 39.
- **`{rows}` for a `Node[]` child**: a `toNode` for `Node[]`, answering a `Fragment`. `{s}` for a `string`
  already works.
- **Wanted, not blocking:** `with`, `Vec.map`, a generic `same`.
- The bugs above.

## The order of work

1. **Close the injection in today's `render`**, with the CSP in the build. Independent of the rest, and true
   of what ships now. (A failing case first: the four constructions above.)
2. **`Elem`**: the operations, the mirror, events per handle, batching, `Listen`. Port `counter` and `notes`.
3. **The language changes** above: handlers on `Node`, component tags, `data-*` and `aria-*`, `{rows}`,
   the bugs.
4. **`View`**: the diff, the turn, `key`, `ref`, `afterRender`, `Ui` and its hooks, rendering only what changed
   and the development build's check of it. `main(Page)` with `page.sys`. Port `templates/webapp`.
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
