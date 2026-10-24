"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { tempDir, writeFiles, makeToolkit, snapshot } = require("./support");

const BEGIN = "<!-- BEGIN @thetiririri/10x-ai-toolkit -->";
const MANIFEST = ".claude/.10x-ai-toolkit-manifest.json";
const ALPHA = { "SKILL.md": "---\nname: alpha\ndescription: Alpha.\n---\nAlpha\n" };
const PACKAGE_PATH = path.join("node_modules", "@thetiririri", "10x-ai-toolkit");

/** Runs one of the toolkit copy's bins as npm would: a separate node process, PROJECT_ROOT unset unless given. */
function run(toolkitDir, bin, args, { cwd, env = {} }) {
  const childEnv = { ...process.env, ...env };
  if (!Object.hasOwn(env, "PROJECT_ROOT")) delete childEnv.PROJECT_ROOT;
  return spawnSync(process.execPath, [path.join(toolkitDir, bin), ...args], { cwd, env: childEnv, encoding: "utf8" });
}

function setup(t, files = { "CLAUDE.md": "# My notes\n", "package.json": "{}\n" }) {
  const base = tempDir(t);
  const project = path.join(base, "project");
  fs.mkdirSync(project);
  writeFiles(project, files);
  const toolkitDir = path.join(base, "toolkit");
  makeToolkit(toolkitDir, { skills: { alpha: ALPHA } });
  return { base, project, toolkitDir };
}

const read = (project, relPath) => fs.readFileSync(path.join(project, relPath), "utf8");

test("the install bin installs into the current directory and exits 0", (t) => {
  const { project, toolkitDir } = setup(t);

  const result = run(toolkitDir, "install.js", [], { cwd: project });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), ALPHA["SKILL.md"]);
  assert.equal(JSON.parse(read(project, MANIFEST)).mode, "copy");
});

test("the install bin exits 1 with the reason and no stack trace when CLAUDE.md has broken markers", (t) => {
  const { project, toolkitDir } = setup(t, { "CLAUDE.md": `# My notes\n${BEGIN}\n` });

  const result = run(toolkitDir, "install.js", [], { cwd: project });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /marker/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  assert.equal(fs.existsSync(path.join(project, ".claude")), false);
});

test("the install bin refuses a directory that does not look like a project", (t) => {
  const { base, toolkitDir } = setup(t);
  const stray = path.join(base, "stray");
  fs.mkdirSync(stray);

  const result = run(toolkitDir, "install.js", [], { cwd: stray });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROJECT_ROOT/);
  assert.deepEqual(snapshot(stray), {});
});

const FILESYSTEM_FAULTS = [
  ["CLAUDE.md is a directory", "EISDIR", /CLAUDE\.md/, (project) => fs.mkdirSync(path.join(project, "CLAUDE.md"))],
  [".claude is a file", "ENOTDIR", /\.claude/, (project) => fs.writeFileSync(path.join(project, ".claude"), "not a directory\n")],
  [
    ".claude/skills is read-only",
    "EACCES",
    /\.claude\/skills/,
    (project) => {
      fs.mkdirSync(path.join(project, ".claude/skills"), { recursive: true });
      fs.chmodSync(path.join(project, ".claude/skills"), 0o555);
    },
  ],
];

for (const [label, code, file, prepare] of FILESYSTEM_FAULTS) {
  const skip = code === "EACCES" && process.getuid?.() === 0 && "root ignores file permissions";
  test(`the install bin exits 1 with ${code} and the file, not a stack trace, when ${label}`, { skip }, (t) => {
    const { project, toolkitDir } = setup(t, { "package.json": "{}\n" });
    prepare(project);

    const result = run(toolkitDir, "install.js", [], { cwd: project });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(code));
    assert.match(result.stderr, file);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  });
}

test("the install bin passes --force through, overwriting an edited skill", (t) => {
  const { project, toolkitDir } = setup(t);
  run(toolkitDir, "install.js", [], { cwd: project });
  writeFiles(project, { ".claude/skills/alpha/SKILL.md": "my own alpha\n" });

  const skipped = run(toolkitDir, "install.js", [], { cwd: project });
  assert.equal(skipped.status, 0);
  assert.match(skipped.stderr, /alpha/);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), "my own alpha\n");

  const forced = run(toolkitDir, "install.js", ["--force"], { cwd: project });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), ALPHA["SKILL.md"]);
});

test("the install bin rejects an unknown option", (t) => {
  const { project, toolkitDir } = setup(t);

  const result = run(toolkitDir, "install.js", ["--frce"], { cwd: project });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--frce/);
  assert.equal(fs.existsSync(path.join(project, ".claude")), false);
});

test("postinstall under a project's node_modules installs into that project", (t) => {
  const project = path.join(tempDir(t), "project");
  writeFiles(project, { "package.json": "{}\n" });
  const toolkitDir = path.join(project, PACKAGE_PATH);
  makeToolkit(toolkitDir, { skills: { alpha: ALPHA } });

  const result = run(toolkitDir, "install.js", ["--postinstall"], { cwd: toolkitDir });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), ALPHA["SKILL.md"]);
  assert.equal(JSON.parse(read(project, MANIFEST)).mode, "postinstall");
});

test("postinstall only warns and exits 0 on broken markers, so npm install keeps going", (t) => {
  const project = path.join(tempDir(t), "project");
  writeFiles(project, { "package.json": "{}\n", "CLAUDE.md": `# My notes\n${BEGIN}\n` });
  const toolkitDir = path.join(project, PACKAGE_PATH);
  makeToolkit(toolkitDir, { skills: { alpha: ALPHA } });

  const result = run(toolkitDir, "install.js", ["--postinstall"], { cwd: toolkitDir });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /marker/);
  assert.equal(fs.existsSync(path.join(project, ".claude")), false);
});

test("postinstall inside the npx cache writes nothing and exits 0", (t) => {
  const npxDir = path.join(tempDir(t), "npm-cache", "_npx", "0123abcd");
  writeFiles(npxDir, { "package.json": "{}\n" });
  const toolkitDir = path.join(npxDir, PACKAGE_PATH);
  makeToolkit(toolkitDir, { skills: { alpha: ALPHA } });
  const before = snapshot(npxDir);

  const result = run(toolkitDir, "install.js", ["--postinstall"], { cwd: toolkitDir });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(npxDir), before);
});

test("the uninstall bin removes the installation and exits 0", (t) => {
  const { project, toolkitDir } = setup(t);
  const before = snapshot(project);
  run(toolkitDir, "install.js", [], { cwd: project });

  const result = run(toolkitDir, "uninstall.js", [], { cwd: project });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(project), before);
});

test("the uninstall bin passes --force through, removing an edited file", (t) => {
  const { project, toolkitDir } = setup(t);
  run(toolkitDir, "install.js", [], { cwd: project });
  writeFiles(project, { ".claude/skills/alpha/SKILL.md": "my own alpha\n" });

  const kept = run(toolkitDir, "uninstall.js", [], { cwd: project });
  assert.equal(kept.status, 0);
  assert.match(kept.stderr, /alpha/);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), "my own alpha\n");

  const forced = run(toolkitDir, "uninstall.js", ["--force"], { cwd: project });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(fs.existsSync(path.join(project, ".claude")), false);
});

test("the uninstall bin without a manifest changes nothing and exits 0", (t) => {
  const { project, toolkitDir } = setup(t);
  const before = snapshot(project);

  const result = run(toolkitDir, "uninstall.js", [], { cwd: project });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(project), before);
});

test("the uninstall bin exits 1 when the manifest is unreadable", (t) => {
  const { project, toolkitDir } = setup(t, { "package.json": "{}\n", [MANIFEST]: "{ not json" });

  const result = run(toolkitDir, "uninstall.js", [], { cwd: project });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /manifest/);
});
