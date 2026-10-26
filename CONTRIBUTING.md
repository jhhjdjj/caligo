# Contributing to Caligo

Thanks for taking a look. Caligo is a small project on purpose, and it is meant to
stay easy to read — contributions that keep that property are very welcome.

## Getting set up

You only need Node.js 20 or newer. There is nothing to install.

```bash
git clone https://github.com/__OWNER__/caligo.git
cd caligo
npm test        # runs the whole suite in one process
npm run dev     # playground at http://127.0.0.1:4173/
```

Handy commands:

| Command | What it does |
| --- | --- |
| `npm test` | All tests via `scripts/test.js` (no child processes). |
| `npm run test:node` | The same files through Node's own test runner. |
| `npm run dev` | Static server for the playground. |
| `npm run docs:builtins` | Regenerate `docs/builtins.md` from the source. |
| `npm run build:examples` | Regenerate `web/examples.js` from `examples/*.caligo`. |
| `npm run build:site` | Assemble `_site/` the way Pages publishes it. |

## Ground rules

- **No dependencies.** If a feature needs a library, it probably needs a
  different design.
- **ES modules, no build step.** The browser and Node must run the same files.
- **Two-space indentation, double quotes, semicolons.** Match the existing code.
- **Comment the *why*.** A short comment above a non-obvious decision is worth
  more than ten comments restating the code.
- **Every behaviour gets a test.** Bug fixes should add a regression test.

## Adding a builtin

1. Add a `define({ ... })` entry in `src/builtins.js`. Include `params`, a
   one-sentence `doc`, the return type and the implementation. Use the
   `expectList` / `expectMap` / `expectString` / `expectNumber` helpers so type
   errors carry the call span.
2. Never mutate an argument: return a new list or map (see `append`, `put`).
3. Add tests in `test/builtins.test.js`, including the error paths.
4. Run `npm run docs:builtins` and commit the regenerated docs.
5. If the builtin deserves a mention in the language guide, update
   `docs/language.md`.

The playground's Builtins tab reads the same metadata, so there is nothing else
to update.

## Adding syntax

1. `src/lexer.js` — add a keyword or operator if needed.
2. `src/parser.js` — parse it into a node with a `span`, from `parseStatement`
   or `parsePrimary`.
3. `src/interpreter.js` — handle the node in `evaluate` or `executeStatement`.
   The tracer's `describeNode` should also understand it.
4. `src/ast.js` — give it a label and children so `caligo ast` stays useful.
5. `web/style.css` — add a token class if you introduced a new token type.
6. Tests — one for the happy path, one for the error path.
7. `docs/language.md` — update the reference and the grammar.

`docs/design.md` explains the pipeline and the reasoning behind the current
design, which is a useful read before changing it.

## Generated files

These files are generated and checked by CI. Do not hand-edit them:

- `web/examples.js` ← `examples/*.caligo`
- `docs/builtins.md` ← builtin metadata in `src/builtins.js`

Run the matching `npm run ...` command and commit the result.

## Commits and pull requests

- Keep commits focused. A commit that fixes a bug should not also reformat three
  files.
- Write the summary in the imperative mood: "add `sort` comparator support", not
  "added" or "adds".
- Describe what changed and why in the body; link issues with `Fixes #12`.
- Add a `CHANGELOG.md` entry under `## [Unreleased]` for user-visible changes.
- Make sure `npm test` passes before opening the pull request.

## Reporting bugs

A useful bug report includes:

- the smallest program that reproduces the problem;
- what you expected and what happened instead;
- the output of `node --version` and, if relevant, which browser you used for
  the playground.

If the program is small, pasting it as a code block is perfect. If you can
reproduce it in the playground, a share link is even better.

## Code of conduct

Be kind and assume good intent. Harassment, personal attacks and dismissiveness
are not welcome here. Maintainers may edit or remove comments, commits and
issues that break this rule, and may block accounts that repeat it.
