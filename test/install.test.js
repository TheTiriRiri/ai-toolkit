"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { tempDir, writeFiles, makeToolkit, snapshot } = require("./support");

const BEGIN = "<!-- BEGIN @thetiririri/ai-toolkit -->";
const END = "<!-- END @thetiririri/ai-toolkit -->";
const BLOCK = `${BEGIN}\n# Rules\n\n- One sentence per commit.\n${END}`;
const MANIFEST = ".claude/.ai-toolkit-manifest.json";

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
      package: "@thetiririri/ai-toolkit",
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

test("a CLAUDE.md converted to CRLF after the install is left alone by a forced install, without a warning", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit({ skills: { alpha: ALPHA_V1 } });
  kit.install({ root: project });
  const crlf = read(project, "CLAUDE.md").replaceAll("\n", "\r\n");
  writeFiles(project, { "CLAUDE.md": crlf });
  const manifest = read(project, MANIFEST);

  const summary = kit.install({ root: project, force: true });

  assert.equal(read(project, "CLAUDE.md"), crlf);
  assert.equal(read(project, MANIFEST), manifest);
  assert.deepEqual(summary.warnings, []);
});

/** Every fs.writeFileSync to a path containing `name` writes half its data and then fails like a full disk. */
function failWritesTo(t, name) {
  const write = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (file, data, ...rest) => {
    if (!String(file).includes(name)) return write(file, data, ...rest);
    const bytes = Buffer.from(data);
    write(file, bytes.subarray(0, Math.floor(bytes.length / 2)), ...rest);
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", syscall: "write" });
  });
}

test("an install that dies halfway through writing CLAUDE.md leaves the old file whole and no temporary file", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit({ skills: { alpha: ALPHA_V1 } });
  failWritesTo(t, "CLAUDE.md");

  assert.throws(() => kit.install({ root: project }), /ENOSPC/);

  assert.equal(read(project, "CLAUDE.md"), "# My notes\n");
  assert.deepEqual(fs.readdirSync(project).sort(), [".claude", "CLAUDE.md", "package.json"]);
});

test("an install that dies halfway through writing a skill file can be rerun without --force", (t) => {
  const { project, toolkit } = setup(t);
  toolkit({ version: "1.0.0", skills: { alpha: ALPHA_V1 } }).install({ root: project });
  const v2 = toolkit({ version: "2.0.0", skills: { alpha: ALPHA_V2 } });
  failWritesTo(t, "SKILL.md");
  assert.throws(() => v2.install({ root: project }), /ENOSPC/);
  t.mock.restoreAll();

  const summary = v2.install({ root: project });

  assert.deepEqual(summary.skipped, []);
  assert.equal(read(project, ".claude/skills/alpha/SKILL.md"), ALPHA_V2["SKILL.md"]);
});

test("a failed write still names the file in the bin's error line, although the write syscall gives no path", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit({ skills: { alpha: ALPHA_V1 } });
  failWritesTo(t, "CLAUDE.md");
  let errors = "";
  const io = { stdout: { write() {} }, stderr: { write: (text) => (errors += text) } };

  const status = kit.runInstall([], { cwd: project, env: {}, ...io });

  assert.equal(status, 1);
  assert.match(errors, /ENOSPC.*CLAUDE\.md/);
  assert.doesNotMatch(errors, /\n\s+at /);
});

test("rewriting CLAUDE.md keeps its file mode, so git sees no mode change", (t) => {
  const { project, toolkit } = setup(t);
  fs.chmodSync(path.join(project, "CLAUDE.md"), 0o600);

  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project });

  assert.equal(fs.statSync(path.join(project, "CLAUDE.md")).mode & 0o777, 0o600);
});

const BROKEN_MANIFESTS = [
  ["is not JSON", "{ not json"],
  ["belongs to another package", JSON.stringify({ package: "@someone/else", manifestVersion: 1, files: { skills: {} } })],
  [
    "has an unknown manifestVersion",
    JSON.stringify({ package: "@thetiririri/ai-toolkit", manifestVersion: 99, files: { skills: {} } }),
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
    const manifest = { package: "@thetiririri/ai-toolkit", version: "1.0.0", manifestVersion: 1, files: { skills } };
    const { project, toolkit } = setup(t, { "victim.txt": VICTIM, [MANIFEST]: JSON.stringify(manifest) });
    const before = snapshot(project);

    assert.throws(() => toolkit({ skills: { alpha: ALPHA_V2 } }).install({ root: project }), /manifest/);
    assert.deepEqual(snapshot(project), before);
  });
}

test("a skill directory that is a symlink out of the project stops even a forced install, and nothing outside changes", (t) => {
  const { project, toolkit } = setup(t);
  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project });
  const outside = path.join(path.dirname(project), "outside");
  writeFiles(outside, { "SKILL.md": "not yours\n", "references/notes.md": "not yours either\n" });
  fs.rmSync(path.join(project, ".claude/skills/alpha"), { recursive: true });
  fs.symlinkSync(outside, path.join(project, ".claude/skills/alpha"));
  const before = snapshot(outside);

  assert.throws(() => toolkit({ skills: { alpha: ALPHA_V2 } }).install({ root: project, force: true }), /symlink/);
  assert.deepEqual(snapshot(outside), before);
});

test("a managed file that is a symlink out of the project stops a forced install before it writes through the link", (t) => {
  const { project, toolkit } = setup(t);
  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project });
  const victim = path.join(path.dirname(project), "victim.txt");
  fs.writeFileSync(victim, "not yours\n");
  fs.rmSync(path.join(project, ".claude/skills/alpha/SKILL.md"));
  fs.symlinkSync(victim, path.join(project, ".claude/skills/alpha/SKILL.md"));

  assert.throws(() => toolkit({ skills: { alpha: ALPHA_V2 } }).install({ root: project, force: true }), /symlink/);
  assert.equal(fs.readFileSync(victim, "utf8"), "not yours\n");
});

test("a symlink planted where the temporary file of a write goes is refused, never written through", (t) => {
  const { project, toolkit } = setup(t);
  const kit = toolkit({ skills: { alpha: ALPHA_V1 } });
  const victim = path.join(path.dirname(project), "victim.txt");
  fs.writeFileSync(victim, "not yours\n");
  // A cloned repo can carry such links. Fixed random bytes make the temporary name predictable for the test;
  // the pid-only name is what 0.1.1 used.
  t.mock.method(crypto, "randomBytes", (size) => Buffer.alloc(size, 0xab));
  for (const name of [`CLAUDE.md.tmp-${process.pid}`, `CLAUDE.md.tmp-${process.pid}-abababababab`]) {
    fs.symlinkSync(victim, path.join(project, name));
  }

  assert.throws(() => kit.install({ root: project }), /EEXIST/);
  assert.equal(fs.readFileSync(victim, "utf8"), "not yours\n");
  assert.equal(fs.lstatSync(path.join(project, "CLAUDE.md")).isSymbolicLink(), false);
  // The run did not create the entry it refused, so it does not delete it either.
  assert.equal(fs.lstatSync(path.join(project, `CLAUDE.md.tmp-${process.pid}-abababababab`)).isSymbolicLink(), true);
});

test("a temporary file left by a killed run does not block a later install under the same pid", (t) => {
  const { project, toolkit } = setup(t);
  fs.writeFileSync(path.join(project, `CLAUDE.md.tmp-${process.pid}`), "left by a killed run\n");

  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project });

  assert.equal(read(project, "CLAUDE.md"), `# My notes\n\n${BLOCK}\n`);
});

test("a CLAUDE.md symlink to a missing file stops the install before anything is created", (t) => {
  const { project, toolkit } = setup(t, { "package.json": "{}\n" });
  const missing = path.join(path.dirname(project), "CLAUDE-elsewhere.md");
  fs.symlinkSync(missing, path.join(project, "CLAUDE.md"));

  assert.throws(() => toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project }), /symlink/);
  assert.equal(fs.existsSync(missing), false);
  assert.equal(exists(project, ".claude"), false);
});

test("a CLAUDE.md symlinked to another file inside the project gets the block in that file", (t) => {
  const { project, toolkit } = setup(t, { "AGENTS.md": "# Agents\n", "package.json": "{}\n" });
  fs.symlinkSync("AGENTS.md", path.join(project, "CLAUDE.md"));

  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project });

  assert.equal(read(project, "AGENTS.md"), `# Agents\n\n${BLOCK}\n`);
  assert.equal(fs.lstatSync(path.join(project, "CLAUDE.md")).isSymbolicLink(), true);
});

test("a CLAUDE.md hard-linked to AGENTS.md stays one file, so AGENTS.md gets the block too", (t) => {
  const { project, toolkit } = setup(t, { "AGENTS.md": "# Agents\n", "package.json": "{}\n" });
  fs.linkSync(path.join(project, "AGENTS.md"), path.join(project, "CLAUDE.md"));

  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project });

  assert.equal(read(project, "AGENTS.md"), `# Agents\n\n${BLOCK}\n`);
  assert.equal(fs.statSync(path.join(project, "CLAUDE.md")).nlink, 2);
});

for (const managed of [".claude/skills/alpha/SKILL.md", MANIFEST]) {
  test(`a hard-linked ${managed} is split by an update, so a snapshot made with cp -al keeps its copy`, (t) => {
    const { project, toolkit } = setup(t);
    toolkit({ version: "1.0.0", skills: { alpha: ALPHA_V1 } }).install({ root: project });
    const snapshotCopy = path.join(path.dirname(project), "snapshot-copy");
    fs.linkSync(path.join(project, managed), snapshotCopy);
    const before = fs.readFileSync(snapshotCopy, "utf8");

    toolkit({ version: "2.0.0", skills: { alpha: ALPHA_V2 } }).install({ root: project });

    assert.equal(fs.readFileSync(snapshotCopy, "utf8"), before);
    assert.equal(fs.statSync(path.join(project, managed)).nlink, 1);
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

// Up to 0.1.3 the package was @thetiririri/10x-ai-toolkit: installing over such an install would keep its block in
// CLAUDE.md next to the new one, so the install refuses, with a way out that fits what is left of the old install.
const LEGACY_BEGIN = "<!-- BEGIN @thetiririri/10x-ai-toolkit -->";
const LEGACY_END = "<!-- END @thetiririri/10x-ai-toolkit -->";
const LEGACY_BLOCK = `${LEGACY_BEGIN}\n# Old rules\n${LEGACY_END}`;
const LEGACY_MANIFEST = ".claude/.10x-ai-toolkit-manifest.json";
const LEGACY_UNINSTALL = "npx --yes -p @thetiririri/10x-ai-toolkit@0.1.3 10x-ai-toolkit-uninstall";
const legacyManifest = (rules) =>
  JSON.stringify({
    package: "@thetiririri/10x-ai-toolkit",
    version: "0.1.3",
    manifestVersion: 1,
    mode: "copy",
    files: { skills: { alpha: { files: ["SKILL.md"], contentHashes: { "SKILL.md": sha256(ALPHA_V1["SKILL.md"]) } } }, rules },
  });

// An old install, or something the old uninstaller cannot read: it goes first, unless the user wants to keep edits.
const LEGACY_INSTALLED = [
  [
    "a complete @thetiririri/10x-ai-toolkit install",
    {
      "CLAUDE.md": `# My notes\n\n${LEGACY_BLOCK}\n`,
      [LEGACY_MANIFEST]: legacyManifest({ file: "CLAUDE.md", blockHash: sha256(LEGACY_BLOCK), createdFile: false }),
      ".claude/skills/alpha/SKILL.md": ALPHA_V1["SKILL.md"],
    },
  ],
  ["an old manifest that is not JSON", { "CLAUDE.md": "# My notes\n", [LEGACY_MANIFEST]: "{ not json" }],
  ["a directory where the old manifest goes", { "CLAUDE.md": "# My notes\n", [`${LEGACY_MANIFEST}/stray`]: "" }],
];

for (const [label, files] of LEGACY_INSTALLED) {
  test(`an install over ${label} stops before any file changes and names the old uninstaller, --force included`, (t) => {
    const { project, toolkit } = setup(t, files);
    const before = snapshot(project);
    const kit = toolkit({ skills: { alpha: ALPHA_V1 } });

    for (const force of [false, true]) {
      assert.throws(
        () => kit.install({ root: project, force }),
        (error) =>
          error.message.includes(LEGACY_UNINSTALL) && error.message.includes(`delete ${LEGACY_MANIFEST} and the old block`),
      );
    }
    assert.deepEqual(snapshot(project), before);
  });
}

// What the old uninstaller leaves when it keeps edited files (rules: null): it already deleted the rest of those
// skills, and a skipped edited skill is never completed, so the edits go aside while the install restores the skill.
test("an install over the edited files and manifest that the old uninstaller kept asks to move the edits aside", (t) => {
  const { project, toolkit } = setup(t, {
    "CLAUDE.md": "# My notes\n",
    [LEGACY_MANIFEST]: legacyManifest(null),
    ".claude/skills/alpha/SKILL.md": "edited\n",
  });
  const before = snapshot(project);
  const kit = toolkit({ skills: { alpha: ALPHA_V1 } });

  for (const force of [false, true]) {
    assert.throws(
      () => kit.install({ root: project, force }),
      (error) =>
        error.message.includes("Move your edited files aside") &&
        error.message.includes(`delete ${LEGACY_MANIFEST}`) &&
        !error.message.includes(LEGACY_UNINSTALL),
    );
  }
  assert.deepEqual(snapshot(project), before);
});

// Without its manifest the old uninstaller finds nothing to remove, so the block has to go by hand.
const LEGACY_WITHOUT_MANIFEST = [
  ["an old block whose manifest is gone", { "CLAUDE.md": `# My notes\n\n${LEGACY_BLOCK}\n` }],
  ["an old block with CRLF line endings", { "CLAUDE.md": `# My notes\r\n\r\n${LEGACY_BLOCK.replaceAll("\n", "\r\n")}\r\n` }],
  ["a lone old END marker", { "CLAUDE.md": `# My notes\n${LEGACY_END}\n` }],
];

for (const [label, files] of LEGACY_WITHOUT_MANIFEST) {
  test(`an install over ${label} stops before any file changes and asks to delete the block by hand`, (t) => {
    const { project, toolkit } = setup(t, files);
    const before = snapshot(project);
    const kit = toolkit({ skills: { alpha: ALPHA_V1 } });

    for (const force of [false, true]) {
      assert.throws(
        () => kit.install({ root: project, force }),
        (error) => error.message.includes("by hand") && !error.message.includes(LEGACY_UNINSTALL),
      );
    }
    assert.deepEqual(snapshot(project), before);
  });
}

test("an old marker quoted inside a sentence is not an old install", (t) => {
  const { project, toolkit } = setup(t, { "CLAUDE.md": `# My notes\n\nThe old block began with \`${LEGACY_BEGIN}\`.\n` });

  toolkit({ skills: { alpha: ALPHA_V1 } }).install({ root: project });

  assert.equal(read(project, "CLAUDE.md"), `# My notes\n\nThe old block began with \`${LEGACY_BEGIN}\`.\n\n${BLOCK}\n`);
});

test("packaged rules that carry an old marker stop the install, which would refuse every later install", (t) => {
  const { project, toolkit } = setup(t);
  const before = snapshot(project);

  assert.throws(
    () => toolkit({ skills: { alpha: ALPHA_V1 }, rules: `# Rules\n${LEGACY_BEGIN}\n` }).install({ root: project }),
    /marker/,
  );
  assert.deepEqual(snapshot(project), before);
});
