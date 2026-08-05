// CodeMirror highlighting for both of wac's surfaces.
//
// The vocabulary is imported from the compiler rather than copied. A copy had already drifted:
// this file's keyword list was written before `enum` and `match` existed and never gained them,
// so the landing page's own enum example rendered them as ordinary identifiers. `KEYWORDS` and
// `SPELLINGS` are the sets the lexers actually use, so that cannot happen again.
//
// Both surfaces share one tokeniser. They differ in three things — comment marker, block
// structure, and how a declaration opens — and everything else about them is the same language,
// which is the point being made on the page.

import {
  StreamLanguage,
  type StreamParser,
  LanguageSupport,
} from "@codemirror/language";
import { Tag } from "@lezer/highlight";
import { KEYWORDS } from "../../atoms/wac/wacLex.ts";
import { SPELLINGS } from "../../atoms/wac/wapyLex.ts";

export const trapTag = Tag.define();

const TYPES = new Set(
  "i32 i64 f32 f64 bool i31ref anyref string void".split(" ")
);

/** wapy's structural words. Not reserved by the language — see `spec/spec/wapy.md`. */
const WAPY_WORDS = new Set("def class elif pass from in range scope".split(" "));

/** The literals, whichever surface spells them. `True` and `None` are wapy's. */
const LITERALS = new Set(["true", "false", "null", "True", "False", "None"]);

type Context =
  | "normal"
  | "afterType"      // just saw a type, next identifier might be a definition
  | "afterStruct"    // just saw `struct`/`class`, next identifier is a type name
  | "afterDef"       // just saw wapy's `def`, next identifier is a function name
  | "afterImport"    // inside `import { ... }`
  | "params";        // inside `(` in function params

interface WacState {
  inString: boolean;
  context: Context;
  parenDepth: number;
}

function parserFor(surface: "wac" | "wapy"): StreamParser<WacState> {
  const comment = surface === "wac" ? "//" : "#";

  return {
    tokenTable: { trap: trapTag },

    startState(): WacState {
      return { inString: false, context: "normal", parenDepth: 0 };
    },

    token(stream, state): string | null {
      // Resume string
      if (state.inString) {
        while (!stream.eol()) {
          if (stream.next() === '"') {
            state.inString = false;
            return "string";
          }
        }
        return "string";
      }

      if (stream.eatSpace()) return null;

      if (stream.match(comment)) {
        stream.skipToEnd();
        return "comment";
      }

      // Strings
      if (stream.peek() === '"') {
        stream.next();
        while (!stream.eol()) {
          const ch = stream.next();
          if (ch === "\\") {
            stream.next();
          } else if (ch === '"') {
            return "string";
          }
        }
        state.inString = true;
        return "string";
      }

      // Hex before decimal: `0xEDB88320` is one token, not `0` and an identifier.
      if (stream.match(/^0x[0-9a-fA-F_]+/)) return "number";
      if (stream.match(/^[0-9][0-9_]*\.[0-9_]*/)) return "number";
      if (stream.match(/^[0-9][0-9_]*/)) return "number";

      // `@export` and friends: wapy's decorators, one token so the sigil is not punctuation.
      if (surface === "wapy" && stream.match(/^@[a-zA-Z_]\w*/)) return "keyword";

      // Identifiers and keywords
      if (stream.match(/^[a-zA-Z_]\w*/)) {
        const w = stream.current();

        // as!/as~/as@ operators
        if (w === "as") {
          if (stream.eat("!") || stream.eat("~") || stream.eat("@")) return "operator";
          return "keyword";
        }

        if (w === "trap") return "trap";
        if (LITERALS.has(w)) return "bool";
        if (TYPES.has(w)) {
          // In wapy a type follows a `:` or `->` and never introduces a declaration.
          if (surface === "wac") state.context = "afterType";
          return "typeName";
        }

        // Context-sensitive classification
        if (state.context === "afterStruct" || state.context === "afterDef") {
          const wasDef = state.context === "afterDef";
          state.context = "normal";
          return wasDef ? "definition(function)" : "typeName";
        }
        if (state.context === "afterType") {
          state.context = "normal";
          // Could be a variable decl or function decl — check for `(`
          if (stream.match(/^\s*\(/, false)) {
            return "definition(function)";
          }
          return "definition(variable)";
        }
        if (state.context === "afterImport") {
          return "definition(variable)";
        }

        // wapy respells five operators and literals as words; `and` is a `&&`.
        if (surface === "wapy" && SPELLINGS.has(w)) return "operator";

        if (surface === "wapy" && WAPY_WORDS.has(w)) {
          if (w === "class") state.context = "afterStruct";
          if (w === "def") state.context = "afterDef";
          return "keyword";
        }

        if (KEYWORDS.has(w) || w === "from") {
          if (w === "struct" || w === "enum") state.context = "afterStruct";
          if (w === "import") state.context = "afterImport";
          return "keyword";
        }

        // Struct name used as type (capitalized)
        if (w[0] >= "A" && w[0] <= "Z") {
          // If followed by identifier or `(` or `[`, likely a type
          if (stream.match(/^\s*[a-zA-Z_(?\[]/, false)) {
            if (surface === "wac") state.context = "afterType";
            return "typeName";
          }
          // If followed by `.`, likely a static call
          if (stream.match(/^\s*\./, false)) {
            return "typeName";
          }
        }

        // Look ahead for `(` — function call
        if (stream.match(/^\s*\(/, false)) {
          return "function(variable)";
        }

        return "variableName";
      }

      const ch = stream.peek();

      // Multi-char operators
      if (stream.match("<<=") || stream.match(">>=")) return "operator";
      if (
        stream.match("==") || stream.match("!=") ||
        stream.match("<=") || stream.match(">=") ||
        stream.match("&&") || stream.match("||") ||
        stream.match("<<") || stream.match(">>") ||
        stream.match("+=") || stream.match("-=") ||
        stream.match("*=") || stream.match("/=") ||
        stream.match("%=") || stream.match("&=") ||
        stream.match("|=") || stream.match("^=") ||
        stream.match("++") || stream.match("--") ||
        stream.match("->")
      ) {
        return "operator";
      }

      // Single-char operators
      if (ch && "+-*/%=<>!~&|^?".includes(ch)) {
        stream.next();
        return "operator";
      }

      // Punctuation with context tracking
      if (ch && "(){}[];,:.@".includes(ch)) {
        stream.next();
        if (ch === "{") {
          if (state.context !== "afterImport") state.context = "normal";
        } else if (ch === "}") {
          if (state.context === "afterImport") state.context = "normal";
        } else if (ch === "(") {
          if (state.context === "afterType") {
            state.context = "params";
            state.parenDepth = 1;
          } else if (state.context === "params") {
            state.parenDepth++;
          }
        } else if (ch === ")") {
          if (state.context === "params") {
            state.parenDepth--;
            if (state.parenDepth <= 0) state.context = "normal";
          }
        }
        return "punctuation";
      }

      stream.next();
      return null;
    },
  };
}

const wacLanguage = StreamLanguage.define(parserFor("wac"));
const wapyLanguage = StreamLanguage.define(parserFor("wapy"));

export function wac(): LanguageSupport {
  return new LanguageSupport(wacLanguage);
}

export function wapy(): LanguageSupport {
  return new LanguageSupport(wapyLanguage);
}
