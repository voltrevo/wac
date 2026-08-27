// A prompt for sx.
//
// This exists because it is the thing a ladder of interpreters gets for free and a ladder of
// compilers cannot have at all. sx is 1,457 hand-written instructions and it can hold a
// conversation; wac is 37,573 lines and cannot, because a compiler's only way to tell you what an
// expression does is to build a module and run it.
//
// **The host prints, sx computes.** sx has no printer and does not need one: the object layout is
// four words and written down at the top of `boot/l1.l0`, so the reader on this side can walk the
// heap and render a pair as `(1 2 3)` rather than as the number 66347. That division is worth
// keeping — a printer inside sx would be a hundred instructions in the rung that is hardest to
// write, spent on something the outside can do by reading.

import { assemble } from "./assemble.ts";

const root = new URL("..", import.meta.url).pathname;

const TAG_PAIR = 0, TAG_SYM = 1, TAG_NIL = 2, TAG_PRIM = 3, TAG_CLOSURE = 4, TAG_STR = 5;

export class Sx {
  private constructor(
    private readonly inst: WebAssembly.Instance,
    private readonly memory: WebAssembly.Memory,
  ) {}

  static async create(): Promise<Sx> {
    const src = await Deno.readTextFile(`${root}boot/l1.l0`);
    const mod = await WebAssembly.compile(assemble(src).buffer as ArrayBuffer);
    const inst = await WebAssembly.instantiate(mod, {});
    return new Sx(inst, inst.exports.memory as WebAssembly.Memory);
  }

  /** A fresh view every time: `$alloc` grows the memory, and growing detaches the old buffer. */
  private get mem(): DataView {
    return new DataView(this.memory.buffer);
  }

  eval(source: string): number {
    const AT = 8192;
    const bytes = new TextEncoder().encode(source);
    const u8 = new Uint8Array(this.memory.buffer);
    u8.set(bytes, AT);
    u8[AT + bytes.length] = 0;
    return (this.inst.exports.eval_at as (at: number) => number)(AT);
  }

  private word(addr: number): number {
    return this.mem.getInt32(addr, true);
  }

  private tag(v: number): number {
    return this.word(v - 1);
  }

  private symbolText(v: number): string {
    const at = v - 1;
    const len = this.word(at + 8);
    const bytes = new Uint8Array(this.memory.buffer, at + 12, len);
    return new TextDecoder().decode(bytes);
  }

  /** Render a value the way it was written, which is what a prompt owes you. */
  show(v: number, depth = 0): string {
    if ((v & 1) === 0) return String(v >> 1);
    if (depth > 24) return "…";
    switch (this.tag(v)) {
      case TAG_NIL:
        return "()";
      case TAG_SYM:
        return this.symbolText(v);
      // A string shares the symbol layout, so the same reader does both — the quotes are the only
      // way a prompt can show which it was.
      case TAG_STR:
        return JSON.stringify(this.symbolText(v));
      case TAG_PRIM:
        return `#<primitive ${this.word(v - 1 + 4)}>`;
      case TAG_CLOSURE: {
        const params = this.word(v - 1 + 4);
        return `#<fn ${this.show(params, depth + 1)}>`;
      }
      case TAG_PAIR: {
        const parts: string[] = [];
        let cur = v;
        // An improper tail prints as a dotted pair, because a printer that quietly drops one is
        // lying about the structure — and `cons` can build one.
        while ((cur & 1) === 1 && this.tag(cur) === TAG_PAIR) {
          parts.push(this.show(this.word(cur - 1 + 4), depth + 1));
          cur = this.word(cur - 1 + 8);
          if (parts.length > 512) return `(${parts.join(" ")} …)`;
        }
        const tail = (cur & 1) === 1 && this.tag(cur) === TAG_NIL
          ? ""
          : ` . ${this.show(cur, depth + 1)}`;
        return `(${parts.join(" ")}${tail})`;
      }
      default:
        return `#<tag ${this.tag(v)}>`;
    }
  }
}

// ---------------------------------------------------------------- the loop

/** Balanced? A prompt should wait for the rest rather than evaluate half of a form. */
function open(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ";") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
  }
  return depth;
}

/** Lines from stdin. `prompt()` would be shorter and needs a TTY, so a piped session — which is how
 * this is tested — would read nothing and exit looking like it worked. */
async function* lines(): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of Deno.stdin.readable) {
    buffered += decoder.decode(chunk, { stream: true });
    let at: number;
    while ((at = buffered.indexOf("\n")) >= 0) {
      yield buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
    }
  }
  if (buffered !== "") yield buffered;
}

const out = (s: string) => Deno.stdout.writeSync(new TextEncoder().encode(s));

if (import.meta.main) {
  const sx = await Sx.create();
  console.log("sx — 1,457 hand-written instructions. ^D to leave.");
  console.log('try: (def fact (fn (n) (if (< n 2) 1 (* n (fact (- n 1))))))  then  (fact 10)');

  let pending = "";
  out("sx> ");
  for await (const line of lines()) {
    pending = pending === "" ? line : `${pending}\n${line}`;
    if (open(pending) > 0) { out("  … "); continue; }
    if (pending.trim() === "") { pending = ""; out("sx> "); continue; }
    try {
      console.log(sx.show(sx.eval(pending)));
    } catch (e) {
      // A trap is all sx has: `unreachable` is what it does for an unbound name, a bad argument
      // count and an unknown primitive alike. Saying which of those it was is the diagnostic the
      // root has never had, and this is where it would be missed first.
      console.log(`! trapped — ${(e as Error).message.split("\n")[0]}`);
    }
    pending = "";
    out("sx> ");
  }
  out("\n");
}
