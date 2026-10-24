"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { REPO, tempDir, writeFiles } = require("./support");

// Hermetic git: no global hooks or identity from the machine running the tests.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const ALPHA = "---\nname: alpha\ndescription: Use when testing.\n---\n";

// `npm view <name>@<version> version` as the registry answers it: E404 for a package it does not know,
// nothing at all for a known package without that version, the version itself once it is published.
const FAKE_NPM = `#!/bin/sh
[ "$1" = view ] || { echo "fake npm: unexpected npm $*" >&2; exit 2; }
case "$FAKE_NPM_VIEW" in
  missing-package) echo "npm error code E404" >&2; exit 1 ;;
  missing-version) exit 0 ;;
  *) echo "$FAKE_NPM_VIEW" ;;
esac
`;

function git(dir, ...args) {
  const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "tag.gpgsign=false"];
  const result = spawnSync("git", [...identity, "-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

function packageJson(version, extra = {}) {
  const pkg = { name: "@thetiririri/10x-ai-toolkit", version, files: ["skills/", "README.md"], ...extra };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function commitAndTag(dir, version) {
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", `Release ${version}.`);
  git(dir, "tag", "-a", `v${version}`, "-m", `Release ${version}.`);
}

// Pushing to a bare origin sets origin/main, which the publish job's checkout (fetch-depth: 0) also has.
const pushMain = (dir) => git(dir, "push", "-q", "origin", "main");

/** A git repository with the release script and a package at `version`, committed, tagged and pushed to origin. */
function repoAt(t, version) {
  const base = tempDir(t);
  const dir = path.join(base, "repo");
  writeFiles(dir, { "package.json": packageJson(version), "skills/alpha/SKILL.md": ALPHA, "docs/notes.md": "Notes\n" });
  fs.cpSync(path.join(REPO, "scripts"), path.join(dir, "scripts"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(base, "init", "-q", "--bare", "origin.git");
  git(dir, "remote", "add", "origin", path.join(base, "origin.git"));
  commitAndTag(dir, version);
  pushMain(dir);
  return dir;
}

/** Bumps package.json to `version` (with `extra` fields), writes `files`, commits, tags and pushes the release. */
function release(dir, version, files = {}, extra = {}) {
  writeFiles(dir, { "package.json": packageJson(version, extra), ...files });
  commitAndTag(dir, version);
  pushMain(dir);
}

/** Runs release-check.sh for `tag` against a registry that answers `registry`; returns the process and its outputs. */
function check(t, dir, tag, registry) {
  const bin = tempDir(t);
  writeFiles(bin, { npm: FAKE_NPM });
  fs.chmodSync(path.join(bin, "npm"), 0o755);
  const githubOutput = path.join(bin, "github-output");
  const result = spawnSync("bash", ["scripts/release-check.sh", tag], {
    cwd: dir,
    env: {
      ...GIT_ENV,
      PATH: [bin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
      GITHUB_OUTPUT: githubOutput,
      FAKE_NPM_VIEW: registry,
    },
    encoding: "utf8",
  });
  return { ...result, outputs: fs.existsSync(githubOutput) ? fs.readFileSync(githubOutput, "utf8") : "" };
}

test("a tag that does not match the package.json version stops the release", (t) => {
  const dir = repoAt(t, "0.1.0");
  git(dir, "tag", "-a", "v0.2.0", "-m", "Wrong tag.");

  const result = check(t, dir, "v0.2.0", "missing-package");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /v0\.2\.0/);
  assert.equal(result.outputs, "");
});

test("a tag on a commit that is not on main stops the release", (t) => {
  const dir = repoAt(t, "0.1.0");
  git(dir, "checkout", "-q", "-b", "side");
  writeFiles(dir, { "package.json": packageJson("0.1.1"), "skills/alpha/SKILL.md": `${ALPHA}\nSide.\n` });
  commitAndTag(dir, "0.1.1");

  const result = check(t, dir, "v0.1.1", "missing-version");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /v0\.1\.1.*main/);
  assert.equal(result.outputs, "");
});

test("a checkout without origin/main stops the release and points at fetch-depth", (t) => {
  const dir = repoAt(t, "0.1.0");
  git(dir, "remote", "remove", "origin");

  const result = check(t, dir, "v0.1.0", "missing-package");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /fetch-depth/);
  assert.equal(result.outputs, "");
});

test("a re-run after main moved past the tag still passes the main check", (t) => {
  const dir = repoAt(t, "0.1.0");
  writeFiles(dir, { "docs/notes.md": "Later notes\n" });
  git(dir, "commit", "-q", "-am", "Later.");
  pushMain(dir);

  const result = check(t, dir, "v0.1.0", "0.1.0");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs, "publish=false\n");
});

test("the first release of a package the registry does not know yet is published, without a warning", (t) => {
  const dir = repoAt(t, "0.1.0");

  const result = check(t, dir, "v0.1.0", "missing-package");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs, "publish=true\n");
  assert.doesNotMatch(result.stdout, /::warning::/);
});

test("a new version of a package already in the registry is published although npm view prints nothing", (t) => {
  const dir = repoAt(t, "0.1.0");
  release(dir, "0.1.1", { "skills/alpha/SKILL.md": `${ALPHA}\nMore.\n` });

  const result = check(t, dir, "v0.1.1", "missing-version");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs, "publish=true\n");
});

test("a version that is already published is skipped instead of failing on 409", (t) => {
  const dir = repoAt(t, "0.1.0");

  const result = check(t, dir, "v0.1.0", "0.1.0");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs, "publish=false\n");
});

test("a release that only bumps the version since the previous tag gets a warning", (t) => {
  const dir = repoAt(t, "0.1.0");
  release(dir, "0.1.1", { "docs/notes.md": "More notes\n" });

  const result = check(t, dir, "v0.1.1", "missing-version");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::warning::.*v0\.1\.0/);
});

test("a release that changes a packaged file gets no warning", (t) => {
  const dir = repoAt(t, "0.1.0");
  release(dir, "0.1.1", { "skills/alpha/SKILL.md": `${ALPHA}\nMore.\n` });

  const result = check(t, dir, "v0.1.1", "missing-version");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs, "publish=true\n");
  assert.doesNotMatch(result.stdout, /::warning::/);
});

test("a release that changes package.json beyond the version gets no warning", (t) => {
  const dir = repoAt(t, "0.1.0");
  release(dir, "0.1.1", {}, { description: "Now with a description" });

  const result = check(t, dir, "v0.1.1", "missing-version");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs, "publish=true\n");
  assert.doesNotMatch(result.stdout, /::warning::/);
});
