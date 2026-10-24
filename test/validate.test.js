"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { REPO, tempDir, writeFiles, makeToolkit } = require("./support");

const ALPHA = { "SKILL.md": "---\nname: alpha\ndescription: Use when testing.\n---\n\n# Alpha\n" };

/** A complete copy of the package (code, rules, README, scripts) with one fixture skill, ready for validate.sh. */
function packageCopy(t, { skills = { alpha: ALPHA } } = {}) {
  const dir = path.join(tempDir(t), "toolkit");
  makeToolkit(dir, { skills });
  fs.copyFileSync(path.join(REPO, "README.md"), path.join(dir, "README.md"));
  fs.cpSync(path.join(REPO, "scripts"), path.join(dir, "scripts"), { recursive: true });
  return dir;
}

function validate(dir) {
  return spawnSync("bash", [path.join(dir, "scripts", "validate.sh")], {
    cwd: dir,
    env: { ...process.env, npm_config_update_notifier: "false" },
    encoding: "utf8",
  });
}

function editJson(file, change) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  change(data);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

test("a well-formed package passes", (t) => {
  const result = validate(packageCopy(t));

  assert.equal(result.status, 0, result.stderr);
});

test("a skill whose frontmatter name differs from its directory fails", (t) => {
  const dir = packageCopy(t, { skills: { alpha: { "SKILL.md": "---\nname: beta\ndescription: Use when testing.\n---\n" } } });

  const result = validate(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /skills\/alpha\/SKILL\.md/);
});

test("a skill without a description fails", (t) => {
  const dir = packageCopy(t, { skills: { alpha: { "SKILL.md": "---\nname: alpha\n---\n\n# Alpha\n" } } });

  const result = validate(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /description/);
});

for (const banned of ["10x-plan", "caveman", "bt-audio"]) {
  test(`a skill that must never ship (${banned}) fails`, (t) => {
    const skill = { "SKILL.md": `---\nname: ${banned}\ndescription: Use when testing.\n---\n` };
    const dir = packageCopy(t, { skills: { alpha: ALPHA, [banned]: skill } });

    const result = validate(dir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(banned));
  });
}

test("a skill that points at the user's ~/.claude/skills fails", (t) => {
  const body = "---\nname: alpha\ndescription: Use when testing.\n---\n\nRun `python3 ~/.claude/skills/alpha/run.py`.\n";
  const dir = packageCopy(t, { skills: { alpha: { "SKILL.md": body } } });

  const result = validate(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /~\/\.claude\/skills/);
});

test("rules that contain a package marker fail", (t) => {
  const dir = packageCopy(t);
  writeFiles(dir, { "rules/CLAUDE.md": "# Rules\n<!-- END @thetiririri/10x-ai-toolkit -->\n" });

  const result = validate(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /rules\/CLAUDE\.md/);
});

test("Python bytecode inside a skill fails because npm pack would ship it", (t) => {
  const dir = packageCopy(t);
  writeFiles(dir, { "skills/alpha/__pycache__/run.cpython-312.pyc": "bytecode" });

  const result = validate(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /__pycache__/);
});

test("a files list that leaves out lib/ fails because the bins could not load", (t) => {
  const dir = packageCopy(t);
  editJson(path.join(dir, "package.json"), (pkg) => {
    pkg.files = pkg.files.filter((entry) => entry !== "lib/");
  });

  const result = validate(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /lib\/toolkit\.js/);
});

test("a bin without a node shebang fails", (t) => {
  const dir = packageCopy(t);
  const bin = path.join(dir, "install.js");
  fs.writeFileSync(bin, fs.readFileSync(bin, "utf8").replace(/^#!.*\n/, ""));

  const result = validate(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /install\.js/);
});

test("a script with a syntax error fails", (t) => {
  const dir = packageCopy(t);
  fs.appendFileSync(path.join(dir, "lib", "toolkit.js"), "\nfunction (\n");

  const result = validate(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /lib\/toolkit\.js/);
});
