// AST node types for the wac language. Type exports only — no value exports.

// ---- Types ----

export type WacType =
  | { tag: "i32" } | { tag: "i64" } | { tag: "f32" } | { tag: "f64" }
  | { tag: "bool" } | { tag: "void" } | { tag: "string" }
  | { tag: "i8" } | { tag: "i16" }       // packed array elements only
  | { tag: "named"; name: string }         // struct or imported type
  | { tag: "array"; elem: WacType }
  | { tag: "nullable"; inner: WacType }
  | { tag: "funcref"; ret: WacType; params: WacType[] }
  | { tag: "anyref" }
  | { tag: "i31ref" };

// ---- Top-level declarations ----

export type Program = {
  imports: ImportDecl[];
  structs: StructDecl[];
  funcs: FuncDecl[];
};

export type ImportDecl = {
  items: ImportItem[];
  from: string;   // file path (raw string value)
  line: number;
  col: number;
};

export type ImportItem = {
  name: string;    // original exported name
  as: string;      // local alias (same as name if no 'as')
  line: number;
  col: number;
};

export type StructDecl = {
  name: string;
  isConst: boolean;       // all fields immutable
  parent?: string;        // extends this struct
  fields: FieldDecl[];
  methods: MethodDecl[];
  line: number;
  col: number;
};

export type FieldDecl = {
  name: string;
  type: WacType;
  isConst: boolean;
  line: number;
  col: number;
};

export type MethodDecl = {
  name: string;
  returnType: WacType;
  thisParam?: "mutable" | "const";  // undefined = static method
  params: Param[];
  body: Block;
  isOverride: boolean;
  line: number;
  col: number;
};

export type FuncDecl = {
  name: string;
  returnType: WacType;
  params: Param[];
  body: Block;
  isExport: boolean;
  line: number;
  col: number;
};

export type Param = {
  name: string;
  type: WacType;
  line: number;
  col: number;
};

// ---- Statements ----

export type Block = { stmts: Stmt[]; line: number; col: number };

export type Stmt =
  | { tag: "var";      isConst: boolean; type: WacType; name: string; init: Expr; line: number; col: number }
  | { tag: "assign";   lval: LVal; rhs: Expr; line: number; col: number }
  | { tag: "compound"; lval: LVal; op: CompoundOp; rhs: Expr; line: number; col: number }
  | { tag: "incr";     lval: LVal; op: "++" | "--"; line: number; col: number }
  | { tag: "if";       cond: Expr; then: Block; else_?: Block | IfStmt; line: number; col: number }
  | { tag: "while";    cond: Expr; body: Block; line: number; col: number }
  | { tag: "for";      init?: ForInit; cond?: Expr; update?: ForUpdate; body: Block; line: number; col: number }
  | { tag: "dowhile";  body: Block; cond: Expr; line: number; col: number }
  | { tag: "switch";   expr: Expr; cases: CaseClause[]; default_?: Stmt[]; line: number; col: number }
  | { tag: "return";   value?: Expr; line: number; col: number }
  | { tag: "break";    line: number; col: number }
  | { tag: "continue"; line: number; col: number }
  | { tag: "trap";     line: number; col: number }
  | { tag: "block";    block: Block; line: number; col: number }   // scoped block { ... }
  | { tag: "expr";     expr: Expr; line: number; col: number };

// Alias to reduce repetition in recursive types
export type IfStmt = Extract<Stmt, { tag: "if" }>;

export type CaseClause = { value: Expr; body: Stmt[]; line: number; col: number };

export type CompoundOp = "+=" | "-=" | "*=" | "/=" | "%=" | "<<=" | ">>=" | "&=" | "|=" | "^=";

export type ForInit =
  | { tag: "var";    isConst: boolean; type: WacType; name: string; init: Expr; line: number; col: number }
  | { tag: "assign"; lval: LVal; rhs: Expr; line: number; col: number };

export type ForUpdate =
  | { tag: "assign";   lval: LVal; rhs: Expr; line: number; col: number }
  | { tag: "compound"; lval: LVal; op: CompoundOp; rhs: Expr; line: number; col: number }
  | { tag: "incr";     lval: LVal; op: "++" | "--"; line: number; col: number };

// Lvalue — a location that can be assigned to.
// Chain of postfix operations rooted at an identifier.
export type LVal = {
  name: string;
  ops: LValOp[];
  line: number;
  col: number;
};

export type LValOp =
  | { tag: "unwrap" }                  // q!
  | { tag: "field";  name: string }    // .x
  | { tag: "index";  idx: Expr };      // [i]

// ---- Expressions ----

export type Expr =
  | { tag: "int";      value: number; line: number; col: number }
  | { tag: "int64";    value: bigint; line: number; col: number }   // when value > 2^31
  | { tag: "float";    value: number; line: number; col: number }
  | { tag: "str";      value: string; line: number; col: number }   // decoded content
  | { tag: "char";     value: string; line: number; col: number }
  | { tag: "bool";     value: boolean; line: number; col: number }
  | { tag: "null";     line: number; col: number }
  | { tag: "ident";    name: string; line: number; col: number }
  | { tag: "unary";    op: "-" | "!" | "~"; operand: Expr; line: number; col: number }
  | { tag: "binary";   op: BinOp; left: Expr; right: Expr; line: number; col: number }
  | { tag: "cast";     op: "as" | "as!" | "as~" | "as@"; operand: Expr; toType: WacType; line: number; col: number }
  | { tag: "is";       operand: Expr; not: boolean; checkType: WacType | "null" | Expr; line: number; col: number }
  | { tag: "ternary";  cond: Expr; then: Expr; else_: Expr; line: number; col: number }
  | { tag: "call";     func: string; typeQual?: string; args: Expr[]; line: number; col: number }
  | { tag: "construct";name: string; form: "positional" | "default" | "named"; args: Expr[]; fields?: FieldInit[]; line: number; col: number }
  | { tag: "array_new";elemType: WacType; size?: Expr; elems?: Expr[]; line: number; col: number }
  | { tag: "field";    object: Expr; name: string; line: number; col: number }
  | { tag: "method";   object: Expr; name: string; args: Expr[]; line: number; col: number }
  | { tag: "index";    object: Expr; idx: Expr; line: number; col: number }
  | { tag: "unwrap";    operand: Expr; line: number; col: number }
  | { tag: "paren";     expr: Expr; line: number; col: number }
  | { tag: "fnref";     func: string; typeQual?: string; line: number; col: number }
  | { tag: "callexpr";  callee: Expr; args: Expr[]; line: number; col: number };

export type FieldInit = { name: string; value: Expr; line: number; col: number };

export type BinOp =
  | "+" | "-" | "*" | "/" | "%"
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "&&" | "||"
  | "&" | "|" | "^"
  | "<<" | ">>";
