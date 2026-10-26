# The Caligo language

Caligo is a small, dynamically typed, expression-oriented language. This page is
the complete reference; the [README](../README.md) is the tour.

- [Design in one paragraph](#design-in-one-paragraph)
- [Lexical structure](#lexical-structure)
- [Values](#values)
- [Bindings](#bindings)
- [Operators](#operators)
- [Statements and blocks](#statements-and-blocks)
- [Functions](#functions)
- [Lists and maps](#lists-and-maps)
- [Pipes](#pipes)
- [Pattern matching](#pattern-matching)
- [Errors](#errors)
- [Grammar](#grammar)
- [Limits](#limits)

## Design in one paragraph

Everything in Caligo is an expression that produces a value, including `if`,
blocks and function bodies. Data is immutable: there is no assignment through an
index, and every helper that "changes" a list or map returns a new one. That
leaves a language with a handful of rules you can hold in your head, while still
supporting the things that make small programs pleasant — closures, pipes,
pattern matching and a real stack trace when something goes wrong.

## Lexical structure

### Comments

```caligo
// a line comment, to the end of the line
let x = 1 // trailing comments work too
```

There are no block comments.

### Identifiers

Identifiers start with a letter (any Unicode letter) or `_`, and continue with
letters, digits or `_`:

```caligo
let name = "caligo"
let 名字 = "also fine"
let _private = 1
```

### Numbers

Numbers are IEEE-754 doubles written in decimal:

```caligo
1
2.5
1e3      // 1000
2.5e-2   // 0.025
```

There is no separate integer type. Values are printed with up to 15 significant
digits, so `0.1 + 0.2` prints as `0.3`.

### Strings

Strings use double quotes and support these escapes:
`\n`, `\t`, `\r`, `\0`, `\\`, `\"`, `\'`, `\$`, and Unicode escapes `\u00e9` or
`\u{1F600}`.

```caligo
"plain"
"two\nlines"
"a 😀 emoji"
```

`${expression}` interpolates any value, converted with the same rules as `print`:

```caligo
let who = "world"
print("hello, ${who}!")        // hello, world!
print("sum: ${1 + 2}")         // sum: 3
print("list: ${[1, 2]}")       // list: [1, 2]
```

For an exact, quoted rendering (used inside lists and maps) there is `toJson`
or `str` with your own quoting.

### Newlines and separators

A newline (or `;`) ends a statement. Expressions may span lines when they are
inside `()`, `[]` or `{}`, or when the next line starts with a binary operator:

```caligo
let total = 1 +
  2 +
  3

let names = [
  "caligo",
  "wheat",
]
```

A line that starts with `-` begins a new statement rather than continuing the
previous one. Write the operator at the end of the line if you need to split
there.

## Values

| Type | Examples | Notes |
| --- | --- | --- |
| `nil` | `nil` | The absence of a value. |
| `bool` | `true`, `false` | |
| `number` | `1`, `2.5`, `-3` | IEEE-754 doubles. |
| `string` | `"hi"` | UTF-8; indexing and `len` count characters, not bytes. |
| `list` | `[1, "two", nil]` | Immutable. |
| `map` | `{ name: "caligo" }` | String keys, immutable. |
| `function` | `fn(x) { x }`, `print` | Closures and builtins. |

Only `nil` and `false` are falsy. `0`, `""` and `[]` are all truthy.

Equality is structural for lists and maps, and identity-based for functions:

```caligo
[1, [2]] == [1, [2]]   // true
{ a: 1 } == { a: 1 }   // true
"1" == 1               // false
```

## Bindings

```caligo
let count = 0        // mutable
const name = "caligo"  // immutable
count = count + 1    // ok
count += 1           // += -= *= /= are supported
name = "other"       // runtime error
```

`let x` without a value binds `nil`.

Bindings are lexical. Every block creates a new scope, and assignments walk up
the scope chain to the nearest matching `let`:

```caligo
let x = 1
if true {
  let x = 2   // shadows the outer x
  print(x)    // 2
}
print(x)      // 1
```

Function parameters are ordinary bindings and can be reassigned.

## Operators

From loosest to tightest:

| Precedence | Operators | Notes |
| --- | --- | --- |
| 1 | `\|>` | Pipe: `value \|> f(a)` calls `f(value, a)`. |
| 2 | `\|\|` | Returns the left value when truthy, otherwise the right one. |
| 3 | `&&` | Returns the left value when falsy, otherwise the right one. |
| 4 | `==` `!=` | Structural equality. |
| 5 | `<` `<=` `>` `>=` | Numbers or strings; mixing types is an error. |
| 6 | `+` `-` | `+` also concatenates two strings or two lists. |
| 7 | `*` `/` `%` | Division or modulo by zero is an error. |
| 8 | `!` `-` (unary) | `!` negates truthiness. |
| 9 | `f(...)`, `xs[i]`, `m.key` | Call, index, member access. |

Examples:

```caligo
1 + 2 * 3            // 7
"a" + "b"            // "ab"
[1] + [2]            // [1, 2]
nil || "fallback"    // "fallback"
1 < 2 && "yes"       // "yes"
```

`+` does not mix types: `"x" + 1` is an error, and the error suggests `str(...)`.

## Statements and blocks

A block is zero or more statements inside `{ ... }`. Blocks are expressions: the
value of a block is the value of its last statement.

```caligo
let x = if 1 < 2 { "yes" } else { "no" }
print(x)  // yes
```

`if` requires braces and can chain `else if`:

```caligo
if n % 15 == 0 {
  "fizzbuzz"
} else if n % 3 == 0 {
  "fizz"
} else if n % 5 == 0 {
  "buzz"
} else {
  str(n)
}
```

`while` repeats while its condition is truthy and evaluates to `nil`:

```caligo
let i = 0
while i < 3 {
  print(i)
  i += 1
}
```

`for` walks a list, string or map and evaluates to `nil`:

```caligo
for value in [10, 20] { print(value) }
for index, value in [10, 20] { print(index, value) }
for character in "hi" { print(character) }
for key in { a: 1, b: 2 } { print(key) }
for key, value in { a: 1 } { print(key, value) }
```

Loop variables are fresh on every iteration, which means closures created inside
a loop capture that iteration's value rather than a shared variable.

`break` exits the innermost loop, `continue` skips to the next iteration, and
`return` exits the current function:

```caligo
fn indexOf(items, target) {
  for index, item in items {
    if item == target { return index }
  }
  -1
}
```

## Functions

```caligo
fn add(a, b) { a + b }          // declaration
let double = fn(x) { x * 2 }   // anonymous function
let fact = fn f(n) {           // named expression, can recurse
  if n <= 1 { 1 } else { n * f(n - 1) }
}
```

- The body is a block; its last expression is the return value.
- `return` exits early, with or without a value.
- Parameters are required; there are no defaults, no rest parameters and no
  keyword arguments. Calling with the wrong number of arguments is an error.
- Functions capture their defining scope (lexical closures). They can read and
  assign to captured `let` bindings.
- Recursion depth is limited (see [Limits](#limits)) and the error tells you so.

```caligo
fn counter() {
  let n = 0
  fn() {
    n = n + 1
    n
  }
}

let next = counter()
print(next(), next())  // 1 2
```

## Lists and maps

Lists and maps are immutable. These helpers return new values and leave the
original alone:

```caligo
let xs = [1, 2, 3]
let ys = append(xs, 4)        // [1, 2, 3, 4]
let zs = setAt(xs, 0, 9)      // [9, 2, 3]
let more = xs + [4]           // [1, 2, 3, 4]

let m = { name: "caligo" }
let m2 = put(m, "year", 2026) // a new map
let m3 = merge(m, m2)         // m2 wins on conflicts
```

Indexing and member access:

```caligo
[10, 20, 30][0]     // 10
[10, 20, 30][-1]    // 30 (negative indexes count from the end)
"caligo"[1]           // "u"
{ name: "caligo" }.name
{ "two words": 1 }["two words"]
```

Reading a missing key or an out-of-range index is a runtime error with a hint.
Use `get(map, key, default)` for optional lookups.

Iteration order is insertion order, the same as `keys(map)`.

## Pipes

`value |> f(a, b)` calls `f(value, a, b)`: the piped value becomes the **first**
argument. Pipes chain left to right.

```caligo
let result = [1, 2, 3, 4]
  |> filter(fn(x) { x % 2 == 0 })
  |> map(fn(x) { x * 10 })
  |> sum()

print(result)  // 60
```

Any function works on the right side, including builtins, user functions and
anonymous functions:

```caligo
"caligo" |> upper()          // "CALIGO"
5 |> fn(x) { x + 1 }       // 6
```

## Pattern matching

`match` tests a value against patterns in order and evaluates the body of the
first match. Arms are separated by commas or new lines, and the body may be an
expression or a block.

```caligo
let label = match value {
  nil => "nothing",
  [] => "empty",
  [only] => "one: ${only}",
  [first, ...rest] => "first ${first}, then ${len(rest)} more",
  { kind: k } => "a ${k}",
  _ => "something else"
}
```

Patterns:

| Pattern | Matches |
| --- | --- |
| `nil`, `true`, `false`, `3`, `"x"`, `-1` | That exact value. |
| `_` | Anything, without binding it. |
| `name` | Anything, and binds it. |
| `[]`, `[a, b]` | A list of exactly that length. |
| `[head, ...tail]` | A list with at least one element; `tail` is the rest. |
| `{ key: pattern }` | A map that contains at least these keys and matches. |
| Nested patterns | `[1, { a: [x] }]` and so on. |

Matching is not exhaustive: if no arm matches, that is a runtime error, which is
why the examples above all end with `_`.

Bindings introduced by a pattern are `const` inside that arm.

## Errors

Caligo has three error kinds — `lex`, `parse` and `runtime` — and every one of them
carries a source span, a source line with a caret, an optional hint and, for
runtime errors, a stack of function frames:

```
error: undefined variable `totl`
  --> demo.caligo:2:7
  |
2 | print(totl)
  |       ^^^^
  hint: did you mean `total`?
```

Common runtime errors:

- defining a variable that is already a `const` in the same scope;
- assigning to an undefined name or a `const`;
- reading a missing map key, or indexing out of range;
- calling something that is not a function, or calling with the wrong arity;
- mixing types in arithmetic or comparisons;
- division or modulo by zero;
- running past the step or call-depth limits.

There is no `try`/`catch`: errors stop the program and are reported by the host
(the CLI or the playground).

## Grammar

A compact EBNF, where `{ x }` means zero or more and `[ x ]` means optional:

```ebnf
program     = { statement } ;
statement   = binding | fnDecl | ifExpr | whileStmt | forStmt | matchExpr
            | returnStmt | "break" | "continue" | assignment | expression ;

binding     = ( "let" | "const" ) IDENT [ "=" expression ] ;
fnDecl      = "fn" IDENT parameters block ;
assignment  = IDENT ( "=" | "+=" | "-=" | "*=" | "/=" ) expression ;
whileStmt   = "while" expression block ;
forStmt     = "for" IDENT [ "," IDENT ] "in" expression block ;
returnStmt  = "return" [ expression ] ;

expression  = binary | unary | postfix | primary ;
binary      = expression OP expression ;              (* precedence table above *)
unary       = ( "!" | "-" ) expression ;
postfix     = primary { "(" arguments ")" | "[" expression "]" | "." IDENT } ;
primary     = NUMBER | STRING | IDENT | "true" | "false" | "nil"
            | list | map | fnExpr | ifExpr | matchExpr | "(" expression ")" ;

arguments   = [ expression { "," expression } [ "," ] ] ;
list        = "[" [ expression { "," expression } [ "," ] ] "]" ;
map         = "{" [ entry { "," entry } [ "," ] ] "}" ;
entry       = ( IDENT | STRING ) ":" expression ;

fnExpr      = "fn" [ IDENT ] parameters block ;
parameters  = "(" [ IDENT { "," IDENT } ] ")" ;
block       = "{" { statement } "}" ;

ifExpr      = "if" expression block [ "else" ( ifExpr | block ) ]
            | "if" expression block [ "else" block ] ;
matchExpr   = "match" expression "{" { pattern "=>" ( block | expression ) sep } "}" ;

pattern     = "nil" | "true" | "false" | NUMBER | [ "-" ] NUMBER | STRING
            | "_" | IDENT | listPattern | mapPattern | "(" pattern ")" ;
listPattern = "[" [ pattern { "," pattern } [ "," ] [ "..." IDENT ] ] "]" ;
mapPattern  = "{" [ ( IDENT | STRING ) ":" pattern { "," ... } ] "}" ;
```

## Limits

The runtime is deliberately small, so it is also deliberately finite:

| Limit | Default | Where |
| --- | --- | --- |
| Steps per program | 200,000 | `run(code, { maxSteps })` |
| Call depth | 1,000 | `run(code, { maxDepth })` |
| Recorded trace events | 400 | `run(code, { maxEvents })` |
| `range` size | 1,000,000 items | builtin |
| Repeated string length | 1,000,000 characters | `repeat` |

The step limit is what keeps an accidental `while true {}` from freezing the
playground tab; the CLI and the playground both report it as an error.
