"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { tempDir, writeFiles, makeToolkit, snapshot } = require("./support");

const BEGIN = "<!-- BEGIN @thetiriri/10x-ai-toolkit -->";
const END = "<!-- END @thetiriri/10x-ai-toolkit -->";
const BLOCK = `${BEGIN}\n# Rules\n\n- One sentence per commit.\n${END}`;
const MANIFEST = ".claude/.10x-ai-toolkit-manifest.json";

const ALPHA_V1 = { "SKILL.md": "---\nname: alpha\ndescription: Alpha.\n---\nAlpha v1\n", "references/notes.md": "Notes v1\n" };
const ALPHA_V2 = { "SKILL.md": "---\nname: alpha\ndescription: Alpha.\n---\nAlpha v2\n" };
const BETA_V1 = { "SKILL.md": "---\nname: beta\ndescription: Beta.\n---\nBeta v1\n" };
const BETA_V2 = { "SKILL.md": "---\nname: beta\ndescription: Beta.\n---\nBeta v2\n" };

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const read = (project, relPath) => fs.readFileSync(path.join(project, relPath), "utf8");
const exists = (project, relPath) => fs.existsSync(path.join(project, relPath));
const manifestOf = (project) => JSON.parse(read(project, MANIFEST));

/** A consumer project with the given files, and a factory for toolkit "versions" to install into it. */
function setup(t, files = { "CLAUDE.md": "# My notes\n", "package.json": "{}\n" }) {
  const base = tempDir(t);
  const project = path.join(base, "project");
  fs.mkdirSync(project);
  writeFiles(project, files);
  let copies = 0;
  const toolkit = (options) => makeToolkit(path.join(base, `toolkit-${++copies}`), options);
  return { project, toolkit };
}

test("a fresh install copies every skill file, appends the rules block and records both in the manifest", (t) => {
  const { project, toolkit } = setup(t);

  toolkit({ version: "1.0.0", skills: { alpha: ALPHA_V1, beta: BETA_V1 } }).install({ root: project });

  const { [MANIFEST]: manifestText, ...tree } = snapshot(project);
  assert.deepEqual(tree, {
    ".claude/": null,
    ".claude/skills/": null,
    ".claude/skills/alpha/": null,
    ".claude/skills/alpha/SKILL.md": ALPHA_V1["SKILL.md"],
    ".claude/skills/alpha/references/": null,
    ".claude/skills/alpha/references/notes.md": "Notes v1\n",
    ".claude/skills/beta/": null,
    ".claude/skills/beta/SKILL.md": BETA_V1["SKILL.md"],
    "CLAUDE.md": `# My notes\n\n${BLOCK}\n`,
    "package.json": "{}\n",
  });
  const manifest = JSON.parse(manifestText);
  assert.match(manifest.installedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(
    { ...manifest, installedAt: "<time>" },
    {
      package: "@thetiriri/10x-ai-toolkit",
      version: "1.0.0",
      manifestVersion: 1,
      mode: "copy",
      installedAt: "<time>",
      files: {
        skills: {
          alpha: {
            files: ["SKILL.md", "references/notes.md"],
            contentHashes: { "SKILL.md": sha256(ALPHA_V1["SKILL.md"]), "references/notes.md": sha256("Notes v1\n") },
          },
          beta: { files: ["SKILL.md"], contentHashes: { "SKILL.md": sha256(BETA_V1["SKILL.md"]) } },
        },
        rules: { file: "CLAUDE.md", blockHash: sha256(BLOCK), createdFile: false },
      },
    },
  );
});

test("a second install of the same version changes no byte, the manifest included", (t) => {
  const { project, toolkit } = setup(t);
  const v1 = toolkit({ skills: { alpha: ALPHA_V1, beta: BETA_V1 } });
  v1.install({ root: project });
  const before = snapshot(project);

  const summary = v1.install({ root: project });

  assert.deepEqual(snapshot(project), before);
  assert.deepEqual(summary.written, []);
});

test("the install mode is recorded in the manifest", (t) => {
  const { project, toolkit } = setup(t);

  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project, mode: "postinstall" });

  assert.equal(manifestOf(project).mode, "postinstall");
});

test("a missing CLAUDE.md is created with the block alone and recorded as created by the toolkit", (t) => {
  const { project, toolkit } = setup(t, { "package.json": "{}\n" });

  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project });

  assert.equal(read(project, "CLAUDE.md"), `${BLOCK}\n`);
  assert.equal(manifestOf(project).files.rules.createdFile, true);
});

test("an update rewrites changed files, deletes dropped ones and leaves files the user added", (t) => {
  const { project, toolkit } = setup(t);
  toolkit({ version: "1.0.0", skills: { alpha: ALPHA_V1 } }).install({ root: project });
  writeFiles(project, { ".claude/skills/alpha/my-notes.md": "mine\n" });

  toolkit({ version: "2.0.0", skills: { alpha: ALPHA_V2 } }).install({ root: project });

  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), ALPHA_V2["SKILL.md"]);
  assert.equal(exists(project, ".claude/skills/alpha/references"), false);
  assert.equal(read(project, ".claude/skills/alpha/my-notes.md"), "mine\n");
  assert.equal(manifestOf(project).version, "2.0.0");
  assert.deepEqual(manifestOf(project).files.skills.alpha.files, ["SKILL.md"]);
});

test("a skill edited locally is skipped with its edited files named, while the other skills update", (t) => {
  const { project, toolkit } = setup(t);
  toolkit({ version: "1.0.0", skills: { alpha: ALPHA_V1, beta: BETA_V1 } }).install({ root: project });
  writeFiles(project, { ".claude/skills/alpha/SKILL.md": "my own alpha\n" });

  const summary = toolkit({ version: "2.0.0", skills: { alpha: ALPHA_V2, beta: BETA_V2 } }).install({ root: project });

  assert.deepEqual(summary.skipped, [{ skill: "alpha", files: ["SKILL.md"] }]);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), "my own alpha\n");
  assert.equal(read(project, ".claude/skills/alpha/references/notes.md"), "Notes v1\n");
  assert.equal(read(project, ".claude/skills/beta/SKILL.md"), BETA_V2["SKILL.md"]);
  assert.equal(manifestOf(project).files.skills.alpha.contentHashes["SKILL.md"], sha256(ALPHA_V1["SKILL.md"]));
});

test("force overwrites a locally edited skill", (t) => {
  const { project, toolkit } = setup(t);
  toolkit({ version: "1.0.0", skills: { alpha: ALPHA_V1 } }).install({ root: project });
  writeFiles(project, { ".claude/skills/alpha/SKILL.md": "my own alpha\n" });

  const summary = toolkit({ version: "2.0.0", skills: { alpha: ALPHA_V2 } }).install({ root: project, force: true });

  assert.deepEqual(summary.skipped, []);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), ALPHA_V2["SKILL.md"]);
  assert.equal(exists(project, ".claude/skills/alpha/references"), false);
});

test("a skill directory the toolkit never installed is left alone and not recorded", (t) => {
  const { project, toolkit } = setup(t, { ".claude/skills/alpha/SKILL.md": "someone else's alpha\n" });

  const summary = toolkit({ skills: { alpha: ALPHA_V1, beta: BETA_V1 } }).install({ root: project });

  assert.deepEqual(summary.skipped, [{ skill: "alpha", files: ["SKILL.md"] }]);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), "someone else's alpha\n");
  assert.equal(manifestOf(project).files.skills.alpha, undefined);
  assert.equal(read(project, ".claude/skills/beta/SKILL.md"), BETA_V1["SKILL.md"]);
});

test("force takes over a skill directory the toolkit never installed", (t) => {
  const { project, toolkit } = setup(t, { ".claude/skills/alpha/SKILL.md": "someone else's alpha\n" });

  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project, force: true });

  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), ALPHA_V1["SKILL.md"]);
  assert.deepEqual(manifestOf(project).files.skills.alpha.files, ["SKILL.md", "references/notes.md"]);
});

test("a managed file deleted by hand is restored by the next install", (t) => {
  const { project, toolkit } = setup(t);
  const v1 = toolkit({ skills: { alpha: ALPHA_V1 } });
  v1.install({ root: project });
  fs.rmSync(path.join(project, ".claude/skills/alpha/SKILL.md"));

  const summary = v1.install({ root: project });

  assert.deepEqual(summary.skipped, []);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), ALPHA_V1["SKILL.md"]);
});

test("a skill dropped from the package is deleted together with its emptied directories", (t) => {
  const { project, toolkit } = setup(t);
  toolkit({ version: "1.0.0", skills: { alpha: ALPHA_V1, beta: BETA_V1 } }).install({ root: project });

  toolkit({ version: "2.0.0", skills: { beta: BETA_V1 } }).install({ root: project });

  assert.equal(exists(project, ".claude/skills/alpha"), false);
  assert.equal(manifestOf(project).files.skills.alpha, undefined);
  assert.equal(read(project, ".claude/skills/beta/SKILL.md"), BETA_V1["SKILL.md"]);
});

test("a dropped skill keeps the files the user edited, stops managing them and says so", (t) => {
  const { project, toolkit } = setup(t);
  toolkit({ version: "1.0.0", skills: { alpha: ALPHA_V1, beta: BETA_V1 } }).install({ root: project });
  writeFiles(project, { ".claude/skills/alpha/SKILL.md": "my own alpha\n" });

  const summary = toolkit({ version: "2.0.0", skills: { beta: BETA_V1 } }).install({ root: project });

  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), "my own alpha\n");
  assert.equal(exists(project, ".claude/skills/alpha/references"), false);
  assert.equal(manifestOf(project).files.skills.alpha, undefined);
  assert.match(summary.warnings.join("\n"), /alpha/);
});

test("hand edits inside the managed block are replaced, with a warning", (t) => {
  const { project, toolkit } = setup(t);
  const v1 = toolkit({ skills: { alpha: ALPHA_V1 } });
  v1.install({ root: project });
  writeFiles(project, { "CLAUDE.md": `# My notes\n\n${BEGIN}\nmy edit\n${END}\n` });

  const summary = v1.install({ root: project });

  assert.equal(read(project, "CLAUDE.md"), `# My notes\n\n${BLOCK}\n`);
  assert.match(summary.warnings.join("\n"), /CLAUDE\.md/);
});

const BROKEN_MANIFESTS = [
  ["is not JSON", "{ not json"],
  ["belongs to another package", JSON.stringify({ package: "@someone/else", manifestVersion: 1, files: { skills: {} } })],
  [
    "has an unknown manifestVersion",
    JSON.stringify({ package: "@thetiriri/10x-ai-toolkit", manifestVersion: 99, files: { skills: {} } }),
  ],
];

for (const [label, content] of BROKEN_MANIFESTS) {
  test(`a manifest that ${label} stops the install before any file changes`, (t) => {
    const { project, toolkit } = setup(t, { "CLAUDE.md": "# My notes\n", [MANIFEST]: content });
    const before = snapshot(project);

    assert.throws(() => toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project }), /manifest/);
    assert.deepEqual(snapshot(project), before);
  });
}

const VICTIM = "a file outside .claude/skills\n";
const ESCAPING_ENTRIES = [
  ["a file path", { alpha: { files: ["../../../victim.txt"], contentHashes: { "../../../victim.txt": sha256(VICTIM) } } }],
  ["a skill name", { "../..": { files: ["victim.txt"], contentHashes: { "victim.txt": sha256(VICTIM) } } }],
];

for (const [label, skills] of ESCAPING_ENTRIES) {
  test(`a manifest with ${label} that escapes .claude/skills is refused and nothing is deleted`, (t) => {
    const manifest = { package: "@thetiriri/10x-ai-toolkit", version: "1.0.0", manifestVersion: 1, files: { skills } };
    const { project, toolkit } = setup(t, { "victim.txt": VICTIM, [MANIFEST]: JSON.stringify(manifest) });
    const before = snapshot(project);

    assert.throws(() => toolkit({ skills: { alpha: ALPHA_V2 } }).install({ root: project }), /manifest/);
    assert.deepEqual(snapshot(project), before);
  });
}

test("broken markers in CLAUDE.md stop the install before any file changes", (t) => {
  const { project, toolkit } = setup(t, { "CLAUDE.md": `# My notes\n${BEGIN}\n` });
  const before = snapshot(project);

  assert.throws(() => toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project }), /marker/);
  assert.deepEqual(snapshot(project), before);
});

test("packaged rules that carry a marker stop the install before any file changes", (t) => {
  const { project, toolkit } = setup(t);
  const before = snapshot(project);

  assert.throws(
    () => toolkit({ skills: { alpha: ALPHA_V1 }, rules: `# Rules\n${END}\n` }).install({ root: project }),
    /marker/,
  );
  assert.deepEqual(snapshot(project), before);
});
