import {
  StreamLanguage,
  type StreamParser,
  LanguageSupport,
} from "@codemirror/language";
import { Tag } from "@lezer/highlight";

export const trapTag = Tag.define();

const KEYWORDS = new Set(
  "import from export struct const override if else while for do switch case default break continue return trap true false null is not as void fn this".split(" ")
);
const TYPES = new Set(
  "i32 i64 f32 f64 bool i31ref anyref string".split(" ")
);

type Context =
  | "normal"
  | "afterType"      // just saw a type, next identifier might be a definition
  | "afterStruct"    // just saw `struct`, next identifier is a type name
  | "afterImport"    // inside `import { ... }`
  | "params";        // inside `(` in function params

interface WacState {
  inString: boolean;
  context: Context;
  parenDepth: number;
}

const wacStreamParser: StreamParser<WacState> = {
  tokenTable: {
    trap: trapTag,
  },

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

    // Line comments
    if (stream.match("//")) {
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

    // Hex integers
    if (stream.match(/^0x[0-9a-fA-F]+/)) return "number";

    // Float literals
    if (stream.match(/^[0-9]+\.[0-9]*/)) return "number";

    // Decimal integers
    if (stream.match(/^[0-9]+/)) return "number";

    // Identifiers and keywords
    if (stream.match(/^[a-zA-Z_]\w*/)) {
      const w = stream.current();

      // as!/as~/as@ operators
      if (w === "as") {
        if (stream.eat("!") || stream.eat("~") || stream.eat("@")) return "operator";
        return "keyword";
      }

      if (w === "trap") return "trap";
      if (TYPES.has(w)) {
        state.context = "afterType";
        return "typeName";
      }
      if (w === "true" || w === "false") return "bool";

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

      if (KEYWORDS.has(w)) {
        if (w === "struct") state.context = "afterStruct";
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
      stream.match("++") || stream.match("--")
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

const wacLanguage = StreamLanguage.define(wacStreamParser);

export function wac(): LanguageSupport {
  return new LanguageSupport(wacLanguage);
}
