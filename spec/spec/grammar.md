## Formal Grammar

`[§wac-grammar-k7fn4xq]` EBNF grammar for the wac language.

### Program structure

```ebnf
program        = { import | struct_decl | func_decl } ;

import         = "import" , "{" , import_list , "}" , "from" , STRING , ";" ;
import_list    = import_item , { "," , import_item } ;
import_item    = IDENT , [ "as" , IDENT ] ;

func_decl      = [ "export" ] , type , IDENT , "(" , [ param_list ] , ")" , block ;
param_list     = param , { "," , param } ;
param          = type , IDENT ;
```

### Struct declarations

```ebnf
struct_decl    = [ "const" ] , "struct" , IDENT , [ ":" , IDENT ] , "{" , { struct_member } , "}" ;

struct_member  = field_decl | method_decl ;

field_decl     = [ "const" ] , type , IDENT , ";" ;

method_decl    = [ "override" ] , type , IDENT , "(" , [ method_params ] , ")" , block ;
method_params  = this_param , [ "," , param_list ]
               | param_list ;
this_param     = [ "const" ] , "this" ;
```

### Statements

```ebnf
block          = "{" , { statement } , "}" ;

statement      = var_decl
               | assign_stmt
               | compound_stmt
               | incr_stmt
               | if_stmt
               | while_stmt
               | for_stmt
               | do_while_stmt
               | switch_stmt
               | return_stmt
               | break_stmt
               | continue_stmt
               | trap_stmt
               | expr_stmt ;

var_decl       = [ "const" ] , type , IDENT , "=" , expr , ";" ;

assign_stmt    = lvalue , "=" , expr , ";" ;

compound_stmt  = lvalue , compound_op , expr , ";" ;
compound_op    = "+=" | "-=" | "*=" | "/=" | "%=" | "<<=" | ">>=" | "&=" | "|=" | "^=" ;

incr_stmt      = lvalue , ( "++" | "--" ) , ";" ;

if_stmt        = "if" , "(" , expr , ")" , block , [ "else" , ( block | if_stmt ) ] ;

while_stmt     = "while" , "(" , expr , ")" , block ;

for_stmt       = "for" , "(" , [ for_init ] , ";" , [ expr ] , ";" , [ for_update ] , ")" , block ;
for_init       = var_decl_no_semi | assign_stmt_no_semi ;
for_update     = assign_stmt_no_semi | compound_stmt_no_semi | incr_stmt_no_semi ;
var_decl_no_semi     = [ "const" ] , type , IDENT , "=" , expr ;
assign_stmt_no_semi  = lvalue , "=" , expr ;
compound_stmt_no_semi = lvalue , compound_op , expr ;
incr_stmt_no_semi    = lvalue , ( "++" | "--" ) ;

do_while_stmt  = "do" , block , "while" , "(" , expr , ")" , ";" ;

switch_stmt    = "switch" , "(" , expr , ")" , "{" , { case_clause } , [ default_clause ] , "}" ;
case_clause    = "case" , expr , ":" , { statement } ;
default_clause = "default" , ":" , { statement } ;

return_stmt    = "return" , [ expr ] , ";" ;
break_stmt     = "break" , ";" ;
continue_stmt  = "continue" , ";" ;
trap_stmt      = "trap" , ";" ;

expr_stmt      = expr , ";" ;
```

### Expressions

```ebnf
expr           = ternary_expr ;

ternary_expr   = is_expr , [ "?" , expr , ":" , expr ] ;

is_expr        = or_expr , [ ( "is" | "is" , "not" ) , ( type | "null" | or_expr ) ] ;

or_expr        = and_expr , { "||" , and_expr } ;
and_expr       = bitor_expr , { "&&" , bitor_expr } ;
bitor_expr     = xor_expr , { "|" , xor_expr } ;
xor_expr       = bitand_expr , { "^" , bitand_expr } ;
bitand_expr    = eq_expr , { "&" , eq_expr } ;
eq_expr        = rel_expr , { ( "==" | "!=" ) , rel_expr } ;
rel_expr       = shift_expr , { ( "<" | "<=" | ">" | ">=" ) , shift_expr } ;
shift_expr     = add_expr , { ( "<<" | ">>" ) , add_expr } ;
add_expr       = mul_expr , { ( "+" | "-" ) , mul_expr } ;
mul_expr       = cast_expr , { ( "*" | "/" | "%" ) , cast_expr } ;

cast_expr      = unary_expr , { ( "as" | "as!" | "as~" | "as@" ) , type } ;

unary_expr     = ( "-" | "!" | "~" ) , unary_expr
               | postfix_expr ;

postfix_expr   = primary_expr , { postfix_op } ;
postfix_op     = "." , IDENT , [ "(" , [ arg_list ] , ")" ]   (* method call or field access *)
               | "[" , expr , "]"                                (* index *)
               | "!" ;                                           (* unwrap *)

primary_expr   = INT_LITERAL
               | FLOAT_LITERAL
               | STRING
               | CHAR_LITERAL
               | "true" | "false"
               | "null"
               | IDENT , [ "." , IDENT ] , "(" , [ arg_list ] , ")"   (* function/static call *)
               | IDENT                                                  (* variable *)
               | "(" , expr , ")"                                       (* grouping *)
               | construction_expr ;

construction_expr = type_name , "(" , [ arg_list ] , ")"               (* positional or default *)
                  | type_name , "{" , field_init_list , "}"             (* named *)
                  | array_construction ;

array_construction = element_type , "[" , expr , "]" , "(" , ")"                (* sized default *)
                   | element_type , "[" , "]" , "(" , [ arg_list ] , ")" ;      (* literal *)

field_init_list = field_init , { "," , field_init } ;
field_init      = IDENT , ":" , expr ;

arg_list       = expr , { "," , expr } ;

lvalue         = IDENT , { "!" | "." , IDENT | "[" , expr , "]" } ;
```

### Types

```ebnf
type           = primitive_type
               | "string"
               | IDENT                              (* struct type *)
               | array_type
               | funcref_type
               | type , "?"                         (* nullable *)
               | "anyref"
               | "i31ref" ;

primitive_type = "i32" | "i64" | "f32" | "f64" | "bool" | "void" ;

array_type     = element_type , "[" , "]" ;
element_type   = primitive_type | "i8" | "i16" | "string" | IDENT | funcref_type ;

funcref_type   = "fn" , "[" , type , "(" , [ type_list ] , ")" , "]" ;
type_list      = type , { "," , type } ;
```

### Lexical elements

```ebnf
IDENT          = letter , { letter | digit | "_" } ;
INT_LITERAL    = digit , { digit } ;
FLOAT_LITERAL  = digit , { digit } , "." , digit , { digit } ;
STRING         = '"' , { string_char } , '"' ;
CHAR_LITERAL   = "'" , char_content , "'" ;
string_char    = (* any character except " and \ *) | escape ;
escape         = "\\" , ( "n" | "t" | "r" | "\\" | '"' | "0" ) ;
letter         = "a"..."z" | "A"..."Z" | "_" ;
digit          = "0"..."9" ;
```

### Keywords

```
as  as!  as~  as@  bool  break  case  const  continue  default  do  else
export  f32  f64  false  fn  for  i16  i32  i64  i8  if  import  is  not
null  override  return  string  struct  switch  trap  true  void  while
```
