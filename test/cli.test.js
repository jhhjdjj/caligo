import test from "node:test";
import assert from "node:assert/strict";
import { main, needsMoreInput, usage } from "../src/cli.js";
import { VERSION } from "../src/version.js";

function harness() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    io: {
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      color: false,
    },
  };
}

test("eval prints the value of the expression", async () => {
  const { out, err, io } = harness();
  assert.equal(await main(["eval", "1 + 2 * 3"], io), 0);
  assert.deepEqual(out, ["7"]);
  assert.deepEqual(err, []);
});

test("eval prints strings with quotes, like a REPL", async () => {
  const { out, io } = harness();
  await main(["eval", '"hi"'], io);
  assert.deepEqual(out, ['"hi"']);
});

test("eval does not echo nil", async () => {
  const { out, io } = harness();
  await main(["eval", "print(\"hello\")"], io);
  assert.deepEqual(out, ["hello"]);
});

test("eval reports syntax errors on stderr with exit code 1", async () => {
  const { out, err, io } = harness();
  assert.equal(await main(["eval", "1 +"], io), 1);
  assert.equal(out.length, 0);
  assert.match(err.join("\n"), /^error: /mu);
  assert.match(err.join("\n"), /\^/u);
});

test("-e is an alias for eval", async () => {
  const { out, io } = harness();
  await main(["-e", "pow(2, 5)"], io);
  assert.deepEqual(out, ["32"]);
});

test("run executes a file and streams its output", async () => {
  const { out, io } = harness();
  const code = await main(["run", "demo.caligo", "a", "b"], {
    ...io,
    readFile: () => 'print("args:", args)',
  });
  assert.equal(code, 0);
  assert.deepEqual(out, ['args: ["a", "b"]']);
});

test("a bare path is treated as a file", async () => {
  const { out, io } = harness();
  const code = await main(["demo.caligo"], { ...io, readFile: () => "print(1)" });
  assert.equal(code, 0);
  assert.deepEqual(out, ["1"]);
});

test("missing files and missing arguments use exit code 2", async () => {
  const first = harness();
  assert.equal(
    await main(["run", "nope.caligo"], {
      ...first.io,
      readFile: () => {
        throw new Error("not found");
      },
    }),
    2,
  );
  assert.match(first.err[0], /cannot read nope\.caligo/u);

  const second = harness();
  assert.equal(await main(["run"], second.io), 2);
  assert.match(second.err[0], /needs a file/u);
});

test("runtime errors are reported with a caret", async () => {
  const { err, io } = harness();
  assert.equal(await main(["eval", "print(nope)"], io), 1);
  assert.match(err.join("\n"), /undefined variable/u);
  assert.match(err.join("\n"), /\^+/u);
});

test("version prints the version", async () => {
  const { out, io } = harness();
  assert.equal(await main(["version"], io), 0);
  assert.deepEqual(out, [`caligo ${VERSION}`]);

  const flag = harness();
  await main(["--version"], flag.io);
  assert.deepEqual(flag.out, [`caligo ${VERSION}`]);
});

test("help prints usage", async () => {
  const { out, io } = harness();
  assert.equal(await main(["help"], io), 0);
  assert.match(out.join("\n"), /Usage/u);
  assert.match(out.join("\n"), /caligo run <file>/u);

  const flag = harness();
  await main(["-h"], flag.io);
  assert.match(flag.out.join("\n"), /Usage/u);
});

test("unknown options exit with 2 and show usage", async () => {
  const { err, io } = harness();
  assert.equal(await main(["--wat"], io), 2);
  assert.match(err.join("\n"), /unknown option/u);
  assert.match(err.join("\n"), /Usage/u);
});

test("ast prints the syntax tree", async () => {
  const { out, io } = harness();
  const code = await main(["ast", "demo.caligo"], { ...io, readFile: () => "1 + 2" });
  assert.equal(code, 0);
  assert.match(out.join("\n"), /Binary \+/u);
});

test("ast reports parse errors", async () => {
  const { err, io } = harness();
  const code = await main(["ast", "demo.caligo"], { ...io, readFile: () => "fn (" });
  assert.equal(code, 1);
  assert.match(err.join("\n"), /error: /u);
});

test("usage text mentions every command", () => {
  const text = usage();
  for (const command of ["run", "eval", "ast", "help", "version"]) assert.match(text, new RegExp(command, "u"));
});

test("needsMoreInput detects unclosed brackets and strings", () => {
  assert.equal(needsMoreInput("1 + 1"), false);
  assert.equal(needsMoreInput("fn f() {"), true);
  assert.equal(needsMoreInput("print([1,"), true);
  assert.equal(needsMoreInput('print("abc'), true);
  assert.equal(needsMoreInput('print("abc")'), false);
  assert.equal(needsMoreInput("// {"), false);
  assert.equal(needsMoreInput("/* not a comment */"), false);
});
