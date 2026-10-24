"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { tempDir, writeFiles, makeToolkit, snapshot } = require("./support");

const BEGIN = "<!-- BEGIN @thetiririri/10x-ai-toolkit -->";
const END = "<!-- END @thetiririri/10x-ai-toolkit -->";
const BLOCK = `${BEGIN}\n# Rules\n\n- One sentence per commit.\n${END}`;
const MANIFEST = ".claude/.10x-ai-toolkit-manifest.json";

const ALPHA = { "SKILL.md": "---\nname: alpha\ndescription: Alpha.\n---\nAlpha\n", "references/notes.md": "Notes\n" };
const BETA = { "SKILL.md": "---\nname: beta\ndescription: Beta.\n---\nBeta\n" };
const GAMMA = { "SKILL.md": "---\nname: gamma\ndescription: Gamma.\n---\nGamma\n" };

const read = (project, relPath) => fs.readFileSync(path.join(project, relPath), "utf8");
const exists = (project, relPath) => fs.existsSync(path.join(project, relPath));

const CONSUMER = {
  "CLAUDE.md": "# My notes\n",
  "package.json": "{}\n",
  ".npmrc": "@thetiririri:registry=https://npm.pkg.github.com\n",
  ".claude/settings.json": "{}\n",
};

/** A consumer project with the given files, and a factory for toolkit "versions" to run against it. */
function setup(t, files = CONSUMER) {
  const base = tempDir(t);
  const project = path.join(base, "project");
  fs.mkdirSync(project);
  writeFiles(project, files);
  let copies = 0;
  const toolkit = (options = { skills: { alpha: ALPHA, beta: BETA } }) =>
    makeToolkit(path.join(base, `toolkit-${++copies}`), options);
  return { base, project, toolkit };
}

test("uninstalling right after an install restores the project byte for byte", (t) => {
  const { project, toolkit } = setup(t);
  const before = snapshot(project);
  const kit = toolkit();
  kit.install({ root: project });

  kit.uninstall({ root: project });

  assert.deepEqual(snapshot(project), before);
});

test("a CLAUDE.md the install created is deleted again, and so is the emptied .claude directory", (t) => {
  const { project, toolkit } = setup(t, { "package.json": "{}\n" });
  const kit = toolkit();
  kit.install({ root: project });

  kit.uninstall({ root: project });

  assert.deepEqual(snapshot(project), { "package.json": "{}\n" });
});

test("a CLAUDE.md the install created but the user extended keeps the user's text", (t) => {
  const { project, toolkit } = setup(t, { "package.json": "{}\n" });
  const kit = toolkit();
  kit.install({ root: project });
  writeFiles(project, { "CLAUDE.md": `${BLOCK}\n\n# Mine\n` });

  kit.uninstall({ root: project });

  assert.equal(read(project, "CLAUDE.md"), "# Mine\n");
});

test("an edited managed file survives uninstall and stays in the manifest", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit();
  kit.install({ root: project });
  writeFiles(project, { ".claude/skills/alpha/SKILL.md": "my own alpha\n" });

  const summary = kit.uninstall({ root: project });

  assert.deepEqual(summary.kept, [{ skill: "alpha", files: ["SKILL.md"] }]);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), "my own alpha\n");
  assert.equal(exists(project, ".claude/skills/alpha/references"), false);
  assert.equal(exists(project, ".claude/skills/beta"), false);
  assert.equal(read(project, "CLAUDE.md"), "# My notes\n");
  assert.deepEqual(JSON.parse(read(project, MANIFEST)).files.skills.alpha.files, ["SKILL.md"]);
});

test("a forced uninstall also removes edited files and finishes what an earlier run kept", (t) => {
  const { project, toolkit } = setup(t);
  const before = snapshot(project);
  const kit = toolkit();
  kit.install({ root: project });
  writeFiles(project, { ".claude/skills/alpha/SKILL.md": "my own alpha\n" });
  kit.uninstall({ root: project });

  kit.uninstall({ root: project, force: true });

  assert.deepEqual(snapshot(project), before);
});

test("files the user added to a skill directory survive uninstall", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit();
  kit.install({ root: project });
  writeFiles(project, { ".claude/skills/alpha/my-notes.md": "mine\n" });

  kit.uninstall({ root: project });

  assert.equal(read(project, ".claude/skills/alpha/my-notes.md"), "mine\n");
  assert.equal(exists(project, ".claude/skills/alpha/SKILL.md"), false);
  assert.equal(exists(project, MANIFEST), false);
});

test("uninstall follows the manifest alone, even after the installing package is gone", (t) => {
  const { base, project, toolkit } = setup(t);
  const before = snapshot(project);
  toolkit({ version: "1.0.0", skills: { alpha: ALPHA, beta: BETA } }).install({ root: project });
  fs.rmSync(path.join(base, "toolkit-1"), { recursive: true });

  toolkit({ version: "9.0.0", skills: { gamma: GAMMA } }).uninstall({ root: project });

  assert.deepEqual(snapshot(project), before);
});

test("without a manifest there is nothing to uninstall and nothing changes", (t) => {
  const { project, toolkit } = setup(t, { "CLAUDE.md": `# My notes\n\n${BLOCK}\n` });
  const before = snapshot(project);

  assert.equal(toolkit().uninstall({ root: project }), null);
  assert.deepEqual(snapshot(project), before);
});

test("broken markers in CLAUDE.md stop the uninstall before any file is deleted", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit();
  kit.install({ root: project });
  writeFiles(project, { "CLAUDE.md": `# My notes\n\n${BEGIN}\n# Rules\n` });
  const before = snapshot(project);

  assert.throws(() => kit.uninstall({ root: project }), /marker/);
  assert.deepEqual(snapshot(project), before);
});

test("a skill directory that is a symlink out of the project stops the uninstall before anything is deleted", (t) => {
  const { base, project, toolkit } = setup(t);
  const kit = toolkit();
  kit.install({ root: project });
  const outside = path.join(base, "outside");
  fs.renameSync(path.join(project, ".claude/skills/alpha"), outside);
  fs.symlinkSync(outside, path.join(project, ".claude/skills/alpha"));
  const before = snapshot(outside);

  assert.throws(() => kit.uninstall({ root: project }), /symlink/);
  assert.deepEqual(snapshot(outside), before);
  assert.equal(exists(project, ".claude/skills/beta/SKILL.md"), true);
});

test("a .claude directory symlinked inside the project uninstalls cleanly and keeps the link", (t) => {
  const { project, toolkit } = setup(t, { "CLAUDE.md": "# My notes\n", "package.json": "{}\n" });
  fs.mkdirSync(path.join(project, "config/claude"), { recursive: true });
  fs.symlinkSync("config/claude", path.join(project, ".claude"));
  const kit = toolkit();
  kit.install({ root: project });

  kit.uninstall({ root: project });

  assert.equal(read(project, "CLAUDE.md"), "# My notes\n");
  assert.deepEqual(fs.readdirSync(path.join(project, "config/claude")), []);
  assert.equal(fs.lstatSync(path.join(project, ".claude")).isSymbolicLink(), true);
});

test("an unreadable manifest stops the uninstall before any file is deleted", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit();
  kit.install({ root: project });
  writeFiles(project, { [MANIFEST]: "{ not json" });
  const before = snapshot(project);

  assert.throws(() => kit.uninstall({ root: project }), /manifest/);
  assert.deepEqual(snapshot(project), before);
});

test("a CLAUDE.md converted to CRLF after the install is restored exactly by uninstall, without a warning", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit();
  kit.install({ root: project });
  writeFiles(project, { "CLAUDE.md": read(project, "CLAUDE.md").replaceAll("\n", "\r\n") });

  const summary = kit.uninstall({ root: project });

  assert.equal(read(project, "CLAUDE.md"), "# My notes\r\n");
  assert.deepEqual(summary.warnings, []);
});

test("a hand-edited managed block is still removed, with a warning", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit();
  kit.install({ root: project });
  writeFiles(project, { "CLAUDE.md": `# My notes\n\n${BEGIN}\nmy edit\n${END}\n` });

  const summary = kit.uninstall({ root: project });

  assert.equal(read(project, "CLAUDE.md"), "# My notes\n");
  assert.match(summary.warnings.join("\n"), /CLAUDE\.md/);
});
