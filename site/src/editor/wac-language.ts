// CodeMirror highlighting for wac.
//
// **The vocabulary is a copy, and a test holds it to the spec.** It used to be imported from the
// TypeScript reference's lexer, on the reasoning that a copy had already drifted once — this
// file's keyword list was written before `enum` and `match` existed and never gained them, so the
// landing page's own enum example rendered them as ordinary identifiers.
//
// That reasoning was right and the import is no longer available: the reference is deleted, and
// wacc has no set to import. `keywordKind` in `packages/wacc/src/lex.wac` is a chain of packed
// integer comparisons with nothing to enumerate, and a browser bundle cannot read a `.md` file at
// runtime anyway.
//
// So the guard moves from "there is only one copy" to "the copies are checked against the
// definition", which is where it should probably have been: `spec/spec/grammar.md` prints the
// keywords, and that is what a reader is told.
// `site/tools/site.test.ts` compares this file against them, and
// `packages/wacc/test/wac/speckeywords_test.wac` compares wacc's lexer against the same fence — so
// the highlighter and the compiler agree by both agreeing with the document.

import {
  StreamLanguage,
  type StreamParser,
  LanguageSupport,
} from "@codemirror/language";
import { Tag } from "@lezer/highlight";


import { KEYWORDS } from "./wac-vocabulary.ts";

export const trapTag = Tag.define();


const TYPES = new Set(
  "i32 i64 f32 f64 bool i31ref anyref string void".split(" ")
);

const LITERALS = new Set(["true", "false", "null"]);

type Context =
  | "normal"
  | "afterType"      // just saw a type, next identifier might be a definition
  | "afterStruct"    // just saw `struct`/`enum`, next identifier is a type name
  | "afterImport"    // inside `import { ... }`
  | "params";        // inside `(` in function params

interface WacState {
  inString: boolean;
  context: Context;
  parenDepth: number;
}

function parser(): StreamParser<WacState> {
  const comment = "//";

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
          state.context = "afterType";
          return "typeName";
        }

        // Context-sensitive classification
        if (state.context === "afterStruct") {
          state.context = "normal";
          return "typeName";
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

        if (KEYWORDS.has(w) || w === "from") {
          if (w === "struct" || w === "enum") state.context = "afterStruct";
          if (w === "import") state.context = "afterImport";
          return "keyword";
        }

        // Struct name used as type (capitalized)
        if (w[0] >= "A" && w[0] <= "Z") {
          // If followed by identifier or `(` or `[`, likely a type
          if (stream.match(/^\s*[a-zA-Z_(?\[]/, false)) {
            state.context = "afterType";
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

const wacLanguage = StreamLanguage.define(parser());

export function wac(): LanguageSupport {
  return new LanguageSupport(wacLanguage);
}
