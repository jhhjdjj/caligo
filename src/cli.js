/**
 * The `caligo` command line interface.
 *
 * `main()` takes its IO from `options` so the tests can drive the CLI without
 * spawning a process: every command is a plain function of (argv, io) -> code.
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { formatAst } from "./ast.js";
import { formatDiagnostic, toDiagnostic } from "./errors.js";
import { Interpreter } from "./interpreter.js";
import { parse, stripBom } from "./parser.js";
import { VERSION } from "./version.js";
import { inspect } from "./values.js";
import { run } from "./index.js";

export function usage() {
  return `caligo ${VERSION} — a tiny scripting language

Usage
  caligo                     start the REPL
  caligo run <file> [args]   run a .caligo program
  caligo eval <code>         evaluate a snippet and print its value
  caligo ast <file>          print the syntax tree of a program
  caligo help                show this help
  caligo version             print the version

Options
  --no-color               disable ANSI colours
  -h, --help               show this help
  -v, --version            print the version

Examples
  caligo run examples/hello.caligo
  caligo eval "sum(range(10))"
  caligo eval "map(range(3), fn(n) { n * n })"
`;
}

function defaultColor() {
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stdout.isTTY);
}

/**
 * @param {string[]} argv
 * @param {{
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 *   color?: boolean,
 *   readFile?: (path: string) => string,
 *   stdin?: NodeJS.ReadableStream,
 *   stdoutStream?: NodeJS.WritableStream,
 *   terminal?: boolean,
 * }} [options]
 * @returns {Promise<number>}
 */
export async function main(argv, options = {}) {
  const color = options.color ?? defaultColor();
  const write = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const writeError = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  const readFile = options.readFile ?? ((path) => readFileSync(path, "utf8"));
  const io = { write, writeError, color, readFile };

  const args = argv.filter((argument) => argument !== "--no-color");
  const [command, ...rest] = args;

  if (command === undefined) return repl(io, options);

  switch (command) {
    case "run":
      return runFile(rest, io);
    case "eval":
    case "-e":
      if (!rest.length) {
        writeError("error: `caligo eval` needs an expression, e.g. caligo eval \"1 + 1\"");
        return 2;
      }
      return evaluate(rest.join(" "), io);
    case "repl":
      return repl(io, options);
    case "ast":
      return printAst(rest, io);
    case "version":
    case "-v":
    case "--version":
      write(`caligo ${VERSION}`);
      return 0;
    case "help":
    case "-h":
    case "--help":
      write(usage());
      return 0;
    default:
      if (command.startsWith("-")) {
        writeError(`error: unknown option \`${command}\``);
        writeError(usage());
        return 2;
      }
      // `caligo hello.caligo` is a friendly shorthand for `caligo run hello.caligo`.
      return runFile(args, io);
  }
}

function runFile(args, io) {
  const [file, ...scriptArgs] = args;
  if (!file) {
    io.writeError("error: `caligo run` needs a file, e.g. caligo run examples/hello.caligo");
    return 2;
  }

  let source;
  try {
    source = stripBom(io.readFile(file));
  } catch (error) {
    io.writeError(`error: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const result = run(source, {
    filename: file,
    args: scriptArgs,
    onOutput: io.write,
  });

  if (!result.ok) {
    io.writeError(formatDiagnostic(result.error, { color: io.color }));
    return 1;
  }

  return 0;
}

function evaluate(code, io) {
  const result = run(code, { filename: "<eval>", onOutput: io.write });

  if (!result.ok) {
    io.writeError(formatDiagnostic(result.error, { color: io.color }));
    return 1;
  }

  if (result.value !== null) io.write(inspect(result.value));
  return 0;
}

function printAst(args, io) {
  const [file] = args;
  if (!file) {
    io.writeError("error: `caligo ast` needs a file, e.g. caligo ast examples/hello.caligo");
    return 2;
  }

  let source;
  try {
    source = stripBom(io.readFile(file));
  } catch (error) {
    io.writeError(`error: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  try {
    io.write(formatAst(parse(source)));
    return 0;
  } catch (error) {
    io.writeError(formatDiagnostic(toDiagnostic(error, source, { filename: file }), { color: io.color }));
    return 1;
  }
}

/** True when the buffered input still has an unclosed bracket or string. */
export function needsMoreInput(source) {
  let depth = 0;
  let inString = false;
  let inComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inComment) {
      if (character === "\n") inComment = false;
      continue;
    }
    if (inString) {
      if (character === "\\") index += 1;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") depth -= 1;
  }

  return depth > 0 || inString;
}

const REPL_HELP = [
  "  :help     show this help",
  "  :clear    forget every variable",
  "  :quit     leave the REPL",
].join("\n");

function repl(io, options) {
  const input = options.stdin ?? process.stdin;
  const terminal = options.terminal ?? Boolean(process.stdin.isTTY);
  const output = options.stdoutStream ?? process.stdout;

  io.write(`Caligo ${VERSION} — a tiny scripting language. Type :help for help.`);

  const reader = createInterface({ input, output, terminal, historySize: 200 });
  let global = new Interpreter({ output: io.write }).global;
  let buffer = "";

  const prompt = () => {
    if (!terminal) return;
    reader.setPrompt(buffer ? "   ... " : "caligo> ");
    reader.prompt();
  };

  return new Promise((resolve) => {
    reader.on("line", (line) => {
      if (!buffer && line.trim().startsWith(":")) {
        const command = line.trim();
        if (command === ":quit" || command === ":q" || command === ":exit") {
          reader.close();
          return;
        }
        if (command === ":clear") {
          global = new Interpreter({ output: io.write }).global;
          io.write("ok — all variables cleared");
          prompt();
          return;
        }
        io.write(REPL_HELP);
        prompt();
        return;
      }

      buffer = buffer ? `${buffer}\n${line}` : line;
      if (!buffer.trim()) {
        buffer = "";
        prompt();
        return;
      }
      if (needsMoreInput(buffer)) {
        prompt();
        return;
      }

      const source = buffer;
      buffer = "";

      try {
        const ast = parse(source);
        const interpreter = new Interpreter({ output: io.write, source, global });
        global = interpreter.global;
        const value = interpreter.run(ast);
        if (value !== null) io.write(inspect(value));
      } catch (error) {
        io.write(formatDiagnostic(toDiagnostic(error, source), { color: io.color }));
      }

      prompt();
    });

    reader.on("SIGINT", () => {
      buffer = "";
      io.write("");
      prompt();
    });

    reader.on("close", () => {
      if (terminal) io.write("");
      resolve(0);
    });

    prompt();
  });
}
