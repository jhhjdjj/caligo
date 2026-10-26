# Changelog

All notable changes to Caligo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-26

The first public release: a complete little language, a CLI and a playground.

### Added

- **Language**
  - `let` and `const` bindings, assignment and compound assignment (`+=`, `-=`,
    `*=`, `/=`).
  - Dynamic values: `nil`, booleans, numbers, strings, lists, maps and functions.
  - String interpolation with `${expression}` and `\u{...}` escapes.
  - Functions with closures, recursion, exact arity checking and `return`.
  - Expression-oriented blocks: `if`/`else`, `while`, `for`, and functions all
    produce values.
  - `for` iteration over lists (value or `index, value`), strings and maps
    (key or `key, value`), with `break` and `continue`.
  - The `|>` pipe operator, which passes the left value as the first argument.
  - `match` with literal, wildcard, binding, list (including `...rest`) and map
    patterns, plus block bodies.
  - Structurally compared, immutable lists and maps.
  - Rich runtime errors: spans, carets, hints, "did you mean" suggestions and
    stack traces.
  - Step, call-depth and trace budgets so runaway programs fail with a message
    instead of hanging.
- **Standard library** — 48 builtins covering collections, strings, numbers,
  maps and JSON. See [docs/builtins.md](docs/builtins.md).
- **CLI** — `run`, `eval`, `ast`, an interactive REPL with persistent state, and
  coloured diagnostics with `NO_COLOR` support.
- **Playground** — a dependency-free browser IDE with lexer-driven highlighting,
  output, statement-level tracing, an AST viewer, a builtins browser and
  shareable URLs that never touch a server.
- **Tooling** — 121 tests on `node:test`, GitHub Actions CI on Node 20/22/24,
  automatic GitHub Pages deployment, generated builtin docs and example modules.
