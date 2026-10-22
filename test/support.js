"use strict";
// Test utilities: temporary directories and throwaway copies of the toolkit, so a test can place
// "a version of the package" anywhere (a node_modules tree, the npx cache) without touching this repo.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const DEFAULT_RULES = "# Rules\n\n- One sentence per commit.\n";

/** A fresh directory, removed after the test; realpath so it compares equal to a module's __dirname. */
function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "10x-ai-toolkit-test-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFiles(root, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const target = path.join(root, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/**
 * Copies the toolkit code (lib/ and the bins) to `dir` with its own package.json version, skills and rules,
 * and returns the copy's freshly loaded lib/toolkit.js. `skills` maps a skill name to {relPath: content};
 * `rules: null` leaves rules/CLAUDE.md out.
 */
function makeToolkit(dir, { version = "1.0.0", skills = {}, rules = DEFAULT_RULES } = {}) {
  fs.cpSync(path.join(REPO, "lib"), path.join(dir, "lib"), { recursive: true });
  for (const bin of ["install.js", "uninstall.js"]) {
    if (fs.existsSync(path.join(REPO, bin))) fs.copyFileSync(path.join(REPO, bin), path.join(dir, bin));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  writeFiles(dir, { "package.json": `${JSON.stringify({ ...pkg, version }, null, 2)}\n` });
  for (const [name, files] of Object.entries(skills)) writeFiles(path.join(dir, "skills", name), files);
  if (rules !== null) writeFiles(dir, { "rules/CLAUDE.md": rules });
  return require(path.join(dir, "lib", "toolkit.js"));
}

/** Every directory (trailing "/") and file under `root` with its content, for before/after comparisons. */
function snapshot(root) {
  const tree = {};
  (function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        tree[`${rel}/`] = null;
        walk(full);
      } else {
        tree[rel] = fs.readFileSync(full, "utf8");
      }
    }
  })(root);
  return tree;
}

module.exports = { REPO, DEFAULT_RULES, tempDir, writeFiles, makeToolkit, snapshot };
