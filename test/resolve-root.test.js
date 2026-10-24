"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { tempDir, writeFiles, makeToolkit } = require("./support");

const PACKAGE_PATH = path.join("node_modules", "@thetiririri", "10x-ai-toolkit");

test("postinstall installs into the project that holds node_modules", (t) => {
  const project = path.join(tempDir(t), "project");
  writeFiles(project, { "package.json": "{}\n" });
  const toolkit = makeToolkit(path.join(project, PACKAGE_PATH));

  assert.deepEqual(toolkit.resolveRoot({ mode: "postinstall", env: {} }), { root: project });
});

test("postinstall in a nested node_modules tree still picks the outermost project", (t) => {
  const project = path.join(tempDir(t), "project");
  writeFiles(project, { "package.json": "{}\n" });
  const nested = path.join(project, "node_modules", ".pnpm", "pkg@1.0.0", PACKAGE_PATH);
  const toolkit = makeToolkit(nested);

  assert.deepEqual(toolkit.resolveRoot({ mode: "postinstall", env: {} }), { root: project });
});

test("postinstall inside the npx cache installs nothing, even with PROJECT_ROOT set", (t) => {
  const base = tempDir(t);
  const npxDir = path.join(base, "npm-cache", "_npx", "0123abcd");
  writeFiles(npxDir, { "package.json": "{}\n" });
  const toolkit = makeToolkit(path.join(npxDir, PACKAGE_PATH));

  assert.ok(toolkit.resolveRoot({ mode: "postinstall", env: {} }).skip);
  assert.ok(toolkit.resolveRoot({ mode: "postinstall", env: { PROJECT_ROOT: base } }).skip);
});

test("postinstall of a global install installs nothing", (t) => {
  const prefix = path.join(tempDir(t), "prefix");
  const toolkit = makeToolkit(path.join(prefix, "lib", PACKAGE_PATH));

  assert.ok(toolkit.resolveRoot({ mode: "postinstall", env: {} }).skip);
});

test("postinstall in the toolkit's own checkout installs nothing", (t) => {
  const toolkit = makeToolkit(path.join(tempDir(t), "10x-ai-toolkit"));

  assert.ok(toolkit.resolveRoot({ mode: "postinstall", env: {} }).skip);
});

test("PROJECT_ROOT overrides the node_modules location in postinstall", (t) => {
  const base = tempDir(t);
  const project = path.join(base, "project");
  const other = path.join(base, "other");
  writeFiles(project, { "package.json": "{}\n" });
  fs.mkdirSync(other);
  const toolkit = makeToolkit(path.join(project, PACKAGE_PATH));

  assert.deepEqual(toolkit.resolveRoot({ mode: "postinstall", env: { PROJECT_ROOT: other } }), { root: other });
});

for (const sign of [".git/", "package.json", ".claude/", "CLAUDE.md"]) {
  test(`the bin installs into the current directory when it has ${sign}`, (t) => {
    const project = tempDir(t);
    if (sign.endsWith("/")) fs.mkdirSync(path.join(project, sign));
    else writeFiles(project, { [sign]: "{}\n" });
    const toolkit = makeToolkit(path.join(tempDir(t), "toolkit"));

    assert.deepEqual(toolkit.resolveRoot({ mode: "copy", env: {}, cwd: project }), { root: project });
  });
}

test("the bin refuses a current directory that does not look like a project", (t) => {
  const stray = tempDir(t);
  const toolkit = makeToolkit(path.join(tempDir(t), "toolkit"));

  assert.throws(() => toolkit.resolveRoot({ mode: "copy", env: {}, cwd: stray }), /PROJECT_ROOT/);
});

test("PROJECT_ROOT lets the bin install outside the current directory", (t) => {
  const project = tempDir(t);
  const stray = tempDir(t);
  const toolkit = makeToolkit(path.join(tempDir(t), "toolkit"));

  assert.deepEqual(toolkit.resolveRoot({ mode: "copy", env: { PROJECT_ROOT: project }, cwd: stray }), {
    root: project,
  });
});

test("a PROJECT_ROOT that is not a directory is an error", (t) => {
  const missing = path.join(tempDir(t), "missing");
  const toolkit = makeToolkit(path.join(tempDir(t), "toolkit"));

  assert.throws(() => toolkit.resolveRoot({ mode: "copy", env: { PROJECT_ROOT: missing }, cwd: missing }), /PROJECT_ROOT/);
});
