# How Caligo works

Caligo is a tree-walking interpreter in a few thousand lines of dependency-free
JavaScript. This document explains the shape of the implementation, the choices
behind it, and where to add things.

- [Goals](#goals)
- [Repository map](#repository-map)
- [The pipeline](#the-pipeline)
- [Spans and diagnostics](#spans-and-diagnostics)
- [Environments and scope](#environments-and-scope)
- [Calls](#calls)
- [Blocks as expressions](#blocks-as-expressions)
- [Immutability and equality](#immutability-and-equality)
- [Pipes](#pipes)
- [Pattern matching](#pattern-matching)
- [Tracing](#tracing)
- [The playground](#the-playground)
- [Testing](#testing)
- [Extending](#extending)
- [Prior art](#prior-art)

## Goals

1. **Readable in one sitting.** Every phase is a separate, commented module with
   no framework or generated code.
2. **No dependencies.** Node built-ins and browser APIs only, so the same `src/`
   runs in the CLI and in the playground.
3. **Honest errors.** A span, a caret, a hint and a stack trace are part of the
   design, not an afterthought.
4. **Boringly portable.** ES modules, no build step, Node 20+ and every current
   browser.

## Repository map

```
src/
  lexer.js        source → tokens (strings, interpolation, newlines, spans)
  parser.js       tokens → AST (precedence climbing, blocks, patterns)
  interpreter.js  AST → values (scopes, calls, loops, match, trace events)
  builtins.js     the standard library, with metadata for docs and the UI
  values.js       value types, printing, equality, function classes
  errors.js       error types, positions, suggestions, diagnostics
  ast.js          pretty printer for the tree
  cli.js          run / eval / repl / ast
  index.js        the public API: run(), parse(), formatAst(), ...
bin/caligo.js       the executable wrapper around src/cli.js
web/              the playground (no build step)
examples/         example programs, shared by the CLI and the playground
docs/             this document, the language reference, the builtins list
scripts/          dev server, site build, test runner, doc generators
test/             node:test suites
```

## The pipeline

```
source text
   │  lexer.tokenize()
   ▼
tokens (type, value, absolute start/end offsets, line, column)
   │  parser.parse()
   ▼
AST (nodes with type, children and a span)
   │  interpreter.run()
   ▼
values (JS primitives, arrays, null-prototype objects, functions)
```

Each phase is a pure function of the previous one. `src/index.js` wires them
together and turns any thrown error into a diagnostic, so callers never see an
exception:

```js
import { run } from "./src/index.js";

const result = run('print("hi")');
// { ok: true, value: null, output: ["hi"], ast, steps, events, ... }
// or { ok: false, error: { kind, title, line, column, snippet, hint, frames } }
```

### Lexing

The lexer is a single pass over the string with an index, a line and a column.
Two details matter:

- **Newlines are tokens.** Collapsed to at most one in a row, they let the
  parser treat line breaks as statement separators while still allowing
  multi-line bracketed expressions.
- **Strings keep their interpolation parts.** `${...}` is not expanded in the
  lexer; the raw source of each expression is recorded with its absolute offset.
  The parser then runs a nested lexer/parser over that snippet, so errors inside
  an interpolation point at the right column of the original file.

### Parsing

Recursive descent for statements and a precedence-climbing loop for binary
operators. The important rules:

- braces are map literals in expression position and blocks only after a keyword
  (`if`, `else`, `while`, `for`, `fn`, `match`), which removes the classic
  `{` ambiguity;
- an expression continues across a newline when the next line starts with a
  binary operator (except `-`, which starts a new statement);
- `match` arms are separated by commas or newlines and may use a block body.

Every node carries `span = { start, end }` as absolute character offsets.

## Spans and diagnostics

Positions are stored as character offsets, not line/column pairs, because
offsets are cheap to carry through the whole pipeline. They are converted to
line/column only when an error is rendered, using a precomputed list of line
starts.

`toDiagnostic(error, source)` produces a structured object: the title, the
location, the offending line, a caret offset and width, a hint, and up to six
stack frames. Tabs are expanded for display, long lines are windowed around the
caret, and the CLI adds ANSI colours while the playground renders the same data
as HTML.

Undefined names get a suggestion from a small Levenshtein search over the names
currently in scope, including builtins.

## Environments and scope

```js
class Env {
  parent;            // Env | null
  bindings;          // Map<string, { value, constant }>
  isBuiltins;        // stops the tracer from listing the whole standard library
}
```

- A `let`/`const`/`fn` binds in the current environment.
- Lookup walks the parent chain; assignment walks it too and fails if the name is
  missing or `constant`.
- Builtins live in their own constant environment, so `let print = 1` is an
  error rather than a confusing shadow.
- Every block creates a child environment; `for` creates a fresh environment per
  iteration, which is what makes closures created in loops capture the right
  value.
- The top-level program runs *without* creating a new scope, so a REPL can reuse
  the same global environment across inputs.

## Calls

A call evaluates the callee and arguments, then dispatches on the function type:

- `NativeFunction` checks arity against `min`/`max`, builds a context object
  (`call`, `fail`, `write`) and calls the JS implementation;
- `CaligoFunction` checks exact arity, enforces `maxDepth`, creates an environment
  from the closure, binds parameters, pushes a frame and executes the body.

`return`, `break` and `continue` are implemented as small exception classes.
They unwind JS stacks naturally, and each function boundary catches `return` and
turns it into a value while letting everything else through. Runtime errors
record the frame stack at the point where they are thrown, which is what makes
the reported stack trace accurate.

## Blocks as expressions

`executeBlock` returns the value of its last statement. `let`, `fn` and loops are
statements that produce `nil`; `if` produces the value of the branch it took.
This is what makes these work without any special syntax:

```caligo
let mood = if raining { "tea" } else { "walk" }
fn sign(x) { if x < 0 { -1 } else if x > 0 { 1 } else { 0 } }
```

## Immutability and equality

Lists are plain JS arrays and maps are null-prototype objects; no wrapper types
means no allocation overhead and trivial JSON interop. Immutability is enforced
by omission: there is no syntax for `xs[i] = v`, and every builtin that would
mutate copies instead (`setAt`, `append`, `put`, `merge`, `sort`, `reverse`).

Equality is structural (`equals` recurses through lists and maps) and functions
compare by identity. Because values cannot form cycles, the recursion is safe.

## Pipes

`|>` is parsed as an ordinary binary operator with the loosest precedence. At
evaluation time it is special-cased:

```js
value |> f(a, b)   →   f(value, a, b)
value |> f         →   f(value)
```

No AST rewriting and no `Function.prototype` tricks: the interpreter simply
prepends the left value to the argument list of the call on the right.

## Pattern matching

Patterns are their own node types (`PatternLiteral`, `PatternBind`,
`PatternWildcard`, `PatternList`, `PatternMap`). Matching walks the pattern and
the value together, collecting bindings in a `Map` that is discarded if the
match fails. A successful arm gets a child environment with those bindings marked
`const`, then its body is evaluated.

List patterns are exact-length unless they end in `...rest`, which matches any
remaining elements. Map patterns are subset matches: the value may contain extra
keys.

## Tracing

The interpreter takes an `onStep` callback and emits one event per executed
statement plus explicit call events:

```js
{
  index: 3,
  kind: "stmt",
  line: 4,
  column: 3,
  label: "let total",
  variables: [{ name: "total", value: "0" }, ...],
}
```

Snapshots walk up to eight environments and truncate values with `preview` so a
500-element list does not end up in the DOM. Recording is capped at
`maxEvents` (400 by default) to keep a runaway loop cheap; the result carries
`eventsTruncated` so the UI can say so.

## The playground

The playground is deliberately old-fashioned:

- a `<textarea>` for editing, with a transparent text colour;
- a `<pre>` underneath holding lexer-highlighted HTML;
- scroll positions and font metrics kept in sync, so the caret and the colours
  never drift.

There is no CodeMirror or Monaco, which keeps the page a few kilobytes and means
the highlighting is produced by the real lexer — if it colours something, the
language agrees that it is that kind of token.

The "Share" button gzips the program with `CompressionStream` and puts it in the
URL fragment as base64url, so links never touch a server. The trace and AST tabs
are rendered from the same `run()` result the Output tab uses.

## Testing

`npm test` runs `scripts/test.js`, which imports every `test/*.test.js` file into
one `node:test` process. That avoids spawning children (which some sandboxes
forbid) and starts instantly; `npm run test:node` uses Node's own runner if you
prefer separate processes.

The suites cover:

- lexer tokens, positions, escapes, interpolation errors;
- parser precedence, newline rules, patterns, error spans;
- interpreter semantics: scoping, closures, recursion, pipes, match, loops,
  immutability, diagnostics, limits, tracing;
- every builtin, including its error paths;
- the CLI: `eval`, `run`, `ast`, exit codes, diagnostics;
- every example program in `examples/`.

## Extending

### Add a builtin

1. Add a `define({...})` block in `src/builtins.js` with `params`, `doc` and an
   implementation. Argument helpers (`expectList`, `expectString`, ...) throw
   errors with a span for you.
2. Add a test in `test/builtins.test.js`.
3. Run `npm run docs:builtins` to refresh `docs/builtins.md`.

The playground's Builtins tab and the generated docs both read the same
metadata, so they cannot drift.

### Add syntax

The checklist for a new expression or statement:

1. Lexer: new keyword or operator (and a highlighting class in `web/style.css`
   if it deserves one).
2. Parser: a `parse*` function that returns a node with a `span`; call it from
   `parseStatement` or `parsePrimary`.
3. Interpreter: a `case` in `evaluate` or `executeStatement`.
4. `src/ast.js`: a label and children, so `caligo ast` stays useful.
5. Tests: one for the happy path, one for the error path.
6. `docs/language.md`: update the reference and the grammar.

## Performance

It is a tree-walker; it is fast enough for programs of a few thousand steps and
for a playground that runs on every click. The obvious hot spots are avoided
without making the code clever:

- environments are `Map`s, not objects, so keys like `__proto__` are safe;
- native calls allocate one small context object each;
- trace snapshots are only built when `onStep` is provided;
- the step budget bounds worst-case work.

If you need to go faster, the next step would be caching identifier lookups or
compiling to closures — but that is a different project, and `docs/design.md`
would need a rewrite.

## Prior art

Caligo is not a port or a fork of anything; every line is written for this
project. Its ideas are borrowed from languages that are better than it at any
one thing:

- **Pipes** from Elixir and F#.
- **Pattern matching** from ML, Ruby and modern Rust/Elixir.
- **Immutable data by default** from Clojure and Elixir.
- **Blocks as expressions** from Ruby and Rust.
- **The book *Crafting Interpreters*** for the general shape of a tree-walking
  interpreter; Caligo uses none of its code and takes a different approach to
  scoping, errors and tooling.

If you know of a project this resembles too closely, please open an issue — the
goal is a distinct, well-documented language, not a clone.
