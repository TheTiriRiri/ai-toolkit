"use strict";
// Shared logic of the installer and the uninstaller: the managed block in the consumer's CLAUDE.md,
// the install manifest and the project root. install.js and uninstall.js are thin CLIs over this module.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");

const PACKAGE_DIR = path.join(__dirname, "..");
const { name: PACKAGE_NAME, version: PACKAGE_VERSION } = require(path.join(PACKAGE_DIR, "package.json"));

const BEGIN = `<!-- BEGIN ${PACKAGE_NAME} -->`;
const END = `<!-- END ${PACKAGE_NAME} -->`;
const RULES_FILE = "CLAUDE.md";
const SKILLS_DIR = path.join(".claude", "skills");
const MANIFEST = path.join(".claude", ".10x-ai-toolkit-manifest.json");
const MANIFEST_VERSION = 1;
const PROJECT_SIGNS = [".git", "package.json", ".claude", RULES_FILE];
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** An expected failure: the CLIs print its message without a stack trace. */
class ToolkitError extends Error {}

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const toPosix = (relPath) => relPath.split(path.sep).join("/");
const own = (record, key) => (Object.hasOwn(record, key) ? record[key] : undefined);
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function readIfExists(file, encoding) {
  try {
    return fs.readFileSync(file, encoding);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function hashOf(file) {
  const data = readIfExists(file);
  return data === null ? null : sha256(data);
}

// --- The managed block in CLAUDE.md -------------------------------------------------------------------------

function indexesOf(text, needle) {
  const found = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) found.push(at);
  return found;
}

/** Where the managed block sits in `content`, or null when there is none; broken markers are an error, never a guess. */
function locateBlock(content) {
  const begins = indexesOf(content, BEGIN);
  const ends = indexesOf(content, END);
  if (begins.length === 0 && ends.length === 0) return null;
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
    throw new ToolkitError(
      `${RULES_FILE} has unpaired or repeated ${PACKAGE_NAME} markers; fix them by hand, then rerun`,
    );
  }
  return { start: begins[0], end: ends[0] + END.length };
}

function blockOf(content) {
  const found = locateBlock(content);
  return found ? content.slice(found.start, found.end) : null;
}

/** `existing` with `rules` between the package markers: replaces the block in place, or appends it after one blank line. */
function applyRulesBlock(existing, rules) {
  if (rules.includes(BEGIN) || rules.includes(END)) {
    // A marker inside the rules would be taken for the real one on the next install and cut the user's text.
    throw new ToolkitError(`the packaged rules contain a ${PACKAGE_NAME} marker; refusing to install them`);
  }
  const block = `${BEGIN}\n${rules.trim()}\n${END}`;
  const found = locateBlock(existing);
  if (found) return existing.slice(0, found.start) + block + existing.slice(found.end);
  if (existing === "") return `${block}\n`;
  return `${existing}${existing.endsWith("\n") ? "" : "\n"}\n${block}\n`;
}

/** `content` without the managed block and the blank line that applyRulesBlock put around it. */
function removeRulesBlock(content) {
  const found = locateBlock(content);
  if (!found) return content;
  const before = content.slice(0, found.start);
  let after = content.slice(found.end).replace(/^\r?\n/, "");
  if (after === "") return before.endsWith("\n\n") ? before.slice(0, -1) : before;
  if (before === "" || before.endsWith("\n\n")) after = after.replace(/^\r?\n/, "");
  return before + after;
}

// --- The project root ---------------------------------------------------------------------------------------

function existingDir(dir) {
  const resolved = path.resolve(dir);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    throw new ToolkitError(`PROJECT_ROOT ${resolved} is not a directory`);
  }
  return resolved;
}

/**
 * The project to install into, or `{ skip }` when a postinstall run has no project to touch.
 * postinstall: the directory above the outermost node_modules holding this package (outermost, so pnpm's
 * nested store still resolves to the project); inside the npx cache the bin does the work instead.
 * copy (the bins): the current directory, which must look like a project. PROJECT_ROOT overrides both.
 */
function resolveRoot({ mode, env = process.env, cwd = process.cwd() }) {
  const parts = PACKAGE_DIR.split(path.sep);
  if (mode === "postinstall") {
    if (parts.includes("_npx")) return { skip: "running from the npx cache, where the bin installs instead" };
    if (env.PROJECT_ROOT) return { root: existingDir(env.PROJECT_ROOT) };
    const at = parts.indexOf("node_modules");
    if (at === -1) return { skip: "not installed as a dependency of a project" };
    const root = parts.slice(0, at).join(path.sep) || path.sep;
    if (!fs.existsSync(path.join(root, "package.json"))) return { skip: "no project above node_modules (global install)" };
    return { root };
  }
  if (env.PROJECT_ROOT) return { root: existingDir(env.PROJECT_ROOT) };
  const dir = path.resolve(cwd);
  if (!PROJECT_SIGNS.some((sign) => fs.existsSync(path.join(dir, sign)))) {
    throw new ToolkitError(
      `${dir} does not look like a project root (no .git, package.json, .claude/ or ${RULES_FILE}); ` +
        "run from the repository root or set PROJECT_ROOT",
    );
  }
  return { root: dir };
}

// --- The manifest -------------------------------------------------------------------------------------------

/** A manifest path may only name a file inside its skill directory: it decides what gets deleted. */
function isSafeRelPath(relPath) {
  return (
    typeof relPath === "string" &&
    !relPath.includes("\\") &&
    relPath.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** The previous install's manifest, or null; anything unexpected stops the run before a single file changes. */
function readManifest(root) {
  const text = readIfExists(path.join(root, MANIFEST), "utf8");
  if (text === null) return null;
  const refuse = (problem) =>
    new ToolkitError(`${toPosix(MANIFEST)} ${problem}; not touching any files. Fix or delete it, then rerun`);
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw refuse(`is not valid JSON (${error.message})`);
  }
  if (!isRecord(manifest) || manifest.package !== PACKAGE_NAME) throw refuse(`does not belong to ${PACKAGE_NAME}`);
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    throw refuse(`has manifestVersion ${JSON.stringify(manifest.manifestVersion)}, this toolkit reads ${MANIFEST_VERSION}`);
  }
  const skills = manifest.files?.skills;
  if (!isRecord(skills)) throw refuse("has no files.skills map");
  for (const [name, entry] of Object.entries(skills)) {
    const valid =
      SKILL_NAME.test(name) &&
      isRecord(entry) &&
      Array.isArray(entry.files) &&
      isRecord(entry.contentHashes) &&
      entry.files.every((relPath) => isSafeRelPath(relPath) && typeof own(entry.contentHashes, relPath) === "string");
    if (!valid) throw refuse(`has an invalid or unsafe entry for skill ${JSON.stringify(name)}`);
  }
  const { rules } = manifest.files;
  const validRules =
    rules == null ||
    (isRecord(rules) && rules.file === RULES_FILE && typeof rules.blockHash === "string" && typeof rules.createdFile === "boolean");
  if (!validRules) throw refuse("has an invalid rules entry");
  return manifest;
}

function writeManifest(root, manifest, summary) {
  const file = path.join(root, MANIFEST);
  const temp = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temp, file); // atomic: an interrupted run leaves the old manifest or the new one, never half of either
  summary.written.push(toPosix(MANIFEST));
}

// --- Files --------------------------------------------------------------------------------------------------

/** Relative paths of the files under `dir`, posix-style and sorted. */
function listFiles(dir) {
  const files = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(toPosix(path.relative(dir, full)));
    }
  })(dir);
  return files.sort();
}

function packagedSkills() {
  const skillsDir = path.join(PACKAGE_DIR, "skills");
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const dir = path.join(skillsDir, name);
      const files = listFiles(dir);
      const hashes = Object.fromEntries(files.map((relPath) => [relPath, sha256(fs.readFileSync(path.join(dir, relPath)))]));
      return { name, dir, files, hashes };
    });
}

function writeFile(root, file, content, summary) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  summary.written.push(toPosix(path.relative(root, file)));
}

/** Removes `dir` and then its parents while they are empty, never `root` itself. */
function removeEmptyDirs(root, dir) {
  for (let current = dir; current.startsWith(root + path.sep); current = path.dirname(current)) {
    if (!fs.existsSync(current) || fs.readdirSync(current).length > 0) return;
    fs.rmdirSync(current);
  }
}

function removeFile(root, file, summary) {
  fs.rmSync(file, { force: true });
  summary.removed.push(toPosix(path.relative(root, file)));
  removeEmptyDirs(root, path.dirname(file));
}

// --- Install ------------------------------------------------------------------------------------------------

/**
 * Installs the packaged skills into <root>/.claude/skills and the rules block into <root>/CLAUDE.md, and records
 * both in the manifest. A file the user changed is never overwritten or deleted without `force`; its skill is
 * skipped as a whole. Every check that can refuse the run happens before the first write.
 */
function install({ root, mode = "copy", force = false }) {
  const previous = readManifest(root);
  const rulesPath = path.join(root, RULES_FILE);
  const currentRules = readIfExists(rulesPath, "utf8");
  const nextRules = applyRulesBlock(currentRules ?? "", fs.readFileSync(path.join(PACKAGE_DIR, "rules", RULES_FILE), "utf8"));
  const summary = { written: [], removed: [], skipped: [], warnings: [] };
  const previousSkills = previous?.files.skills ?? {};
  const packaged = packagedSkills();
  const skills = {};

  for (const skill of packaged) {
    const target = path.join(root, SKILLS_DIR, skill.name);
    const tracked = own(previousSkills, skill.name);
    const trackedHash = (relPath) => (tracked ? own(tracked.contentHashes, relPath) : undefined);
    const writes = [];
    const deletes = [];
    const edited = [];
    for (const relPath of skill.files) {
      const onDisk = hashOf(path.join(target, relPath));
      if (onDisk === skill.hashes[relPath]) continue;
      if (onDisk !== null && onDisk !== trackedHash(relPath)) edited.push(relPath);
      writes.push(relPath);
    }
    for (const relPath of tracked?.files ?? []) {
      if (Object.hasOwn(skill.hashes, relPath)) continue;
      const onDisk = hashOf(path.join(target, relPath));
      if (onDisk === null) continue;
      if (onDisk !== trackedHash(relPath)) edited.push(relPath);
      deletes.push(relPath);
    }
    if (edited.length > 0 && !force) {
      summary.skipped.push({ skill: skill.name, files: edited.sort() });
      if (tracked) skills[skill.name] = tracked;
      continue;
    }
    for (const relPath of deletes) removeFile(root, path.join(target, relPath), summary);
    for (const relPath of writes) {
      writeFile(root, path.join(target, relPath), fs.readFileSync(path.join(skill.dir, relPath)), summary);
    }
    skills[skill.name] = { files: skill.files, contentHashes: skill.hashes };
  }

  // Skills that left the package: delete what is still as installed, keep (and stop managing) what the user edited.
  const shipped = new Set(packaged.map((skill) => skill.name));
  for (const [name, tracked] of Object.entries(previousSkills)) {
    if (shipped.has(name)) continue;
    const kept = [];
    for (const relPath of tracked.files) {
      const file = path.join(root, SKILLS_DIR, name, relPath);
      const onDisk = hashOf(file);
      if (onDisk === null) continue;
      if (onDisk !== own(tracked.contentHashes, relPath) && !force) kept.push(relPath);
      else removeFile(root, file, summary);
    }
    if (kept.length > 0) {
      summary.warnings.push(`skill ${name} left the package; kept your edited ${kept.join(", ")}, no longer managed`);
    }
  }

  const nextBlock = blockOf(nextRules);
  const currentBlock = currentRules === null ? null : blockOf(currentRules);
  const recordedHash = previous?.files.rules?.blockHash;
  if (currentBlock !== null && recordedHash !== undefined && sha256(currentBlock) !== recordedHash && currentBlock !== nextBlock) {
    summary.warnings.push(`${RULES_FILE}: hand edits inside the managed block were replaced`);
  }
  if (nextRules !== currentRules) writeFile(root, rulesPath, nextRules, summary);

  const manifest = {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    manifestVersion: MANIFEST_VERSION,
    mode,
    installedAt: new Date().toISOString(),
    files: {
      skills: Object.fromEntries(Object.keys(skills).sort().map((name) => [name, skills[name]])),
      rules: {
        file: RULES_FILE,
        blockHash: sha256(nextBlock),
        createdFile: currentRules === null || (previous?.files.rules?.createdFile ?? false),
      },
    },
  };
  // Nothing new: keep the old manifest, installedAt included, so a repeated install leaves git status clean.
  const unchanged =
    previous !== null &&
    JSON.stringify({ ...previous, installedAt: null }) === JSON.stringify({ ...manifest, installedAt: null });
  if (!unchanged) writeManifest(root, manifest, summary);
  return summary;
}

// --- Uninstall ----------------------------------------------------------------------------------------------

/**
 * Removes what the manifest says was installed: files still as installed (every one with `force`), the rules
 * block, and CLAUDE.md itself only when the install created it and nothing else is left in it. Reads the
 * manifest alone, so any version of the package can uninstall any other. Returns null when there is no manifest.
 */
function uninstall({ root, force = false }) {
  const manifest = readManifest(root);
  if (manifest === null) return null;
  const rulesPath = path.join(root, RULES_FILE);
  const currentRules = readIfExists(rulesPath, "utf8");
  const nextRules = currentRules === null ? null : removeRulesBlock(currentRules);
  const summary = { written: [], removed: [], kept: [], warnings: [] };
  const keptSkills = {};

  for (const [name, tracked] of Object.entries(manifest.files.skills)) {
    const kept = [];
    for (const relPath of tracked.files) {
      const file = path.join(root, SKILLS_DIR, name, relPath);
      const onDisk = hashOf(file);
      if (onDisk === null) continue;
      if (onDisk !== own(tracked.contentHashes, relPath) && !force) kept.push(relPath);
      else removeFile(root, file, summary);
    }
    if (kept.length > 0) {
      summary.kept.push({ skill: name, files: kept });
      const contentHashes = Object.fromEntries(kept.map((relPath) => [relPath, tracked.contentHashes[relPath]]));
      keptSkills[name] = { files: kept, contentHashes };
    }
  }

  if (currentRules !== null && nextRules !== currentRules) {
    const recordedHash = manifest.files.rules?.blockHash;
    if (recordedHash !== undefined && sha256(blockOf(currentRules)) !== recordedHash) {
      summary.warnings.push(`${RULES_FILE}: the managed block had hand edits; removed it anyway`);
    }
    if (manifest.files.rules?.createdFile && nextRules.trim() === "") removeFile(root, rulesPath, summary);
    else writeFile(root, rulesPath, nextRules, summary);
  }

  if (summary.kept.length > 0) {
    // Keep a manifest for what is left, so a later forced run can finish the job.
    writeManifest(root, { ...manifest, files: { skills: keptSkills, rules: null } }, summary);
  } else {
    removeFile(root, path.join(root, MANIFEST), summary);
  }
  return summary;
}

// --- CLIs ---------------------------------------------------------------------------------------------------

const LABEL = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;

const INSTALL_USAGE = `Usage: 10x-ai-toolkit [--force]

Copies the skills to .claude/skills/ and the rules block to CLAUDE.md in the current
directory (or PROJECT_ROOT), and records both in ${toPosix(MANIFEST)}.

  --force   also overwrite skills you edited locally
`;

const UNINSTALL_USAGE = `Usage: 10x-ai-toolkit-uninstall [--force]

Removes what ${toPosix(MANIFEST)} records from the current directory
(or PROJECT_ROOT). Files you edited stay unless you pass --force.

  --force   also remove files you edited locally
`;

/** The message for expected failures, the stack for bugs. */
function describe(error) {
  return error instanceof ToolkitError || String(error.code).startsWith("ERR_PARSE_ARGS") ? error.message : error.stack;
}

function report(stderr, summary) {
  for (const { skill, files } of summary.skipped ?? []) {
    stderr.write(`${LABEL}: skipped skill ${skill}, edited locally: ${files.join(", ")} (rerun with --force to overwrite)\n`);
  }
  for (const { skill, files } of summary.kept ?? []) {
    stderr.write(`${LABEL}: kept edited files of skill ${skill}: ${files.join(", ")} (rerun with --force to remove)\n`);
  }
  for (const warning of summary.warnings) stderr.write(`${LABEL}: warning: ${warning}\n`);
}

/** install.js: exit 1 on any failure in copy mode; a postinstall only warns, so it never breaks `npm install`. */
function runInstall(argv, { env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  let mode = "copy";
  try {
    const { values } = parseArgs({
      args: argv,
      options: { force: { type: "boolean" }, postinstall: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    });
    if (values.help) {
      stdout.write(INSTALL_USAGE);
      return 0;
    }
    if (values.postinstall) mode = "postinstall";
    const target = resolveRoot({ mode, env, cwd });
    if (target.skip) {
      stdout.write(`${LABEL}: postinstall skipped, ${target.skip}\n`);
      return 0;
    }
    const summary = install({ root: target.root, mode, force: Boolean(values.force) });
    const changes = summary.written.length + summary.removed.length;
    const outcome = changes === 0 ? "already up to date" : `${summary.written.length} written, ${summary.removed.length} removed`;
    stdout.write(`${LABEL}: ${target.root} (${mode}): ${outcome}\n`);
    report(stderr, summary);
    return 0;
  } catch (error) {
    if (mode === "postinstall") {
      stderr.write(`${LABEL}: postinstall warning: ${describe(error)}\n`);
      return 0;
    }
    stderr.write(`${LABEL}: ${describe(error)}\n`);
    return 1;
  }
}

/** uninstall.js: exit 1 on any failure; no manifest is not a failure. */
function runUninstall(argv, { env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const { values } = parseArgs({ args: argv, options: { force: { type: "boolean" }, help: { type: "boolean", short: "h" } } });
    if (values.help) {
      stdout.write(UNINSTALL_USAGE);
      return 0;
    }
    const { root } = resolveRoot({ mode: "copy", env, cwd });
    const summary = uninstall({ root, force: Boolean(values.force) });
    if (summary === null) {
      stdout.write(`${LABEL}: no ${toPosix(MANIFEST)} in ${root}, nothing to uninstall\n`);
      return 0;
    }
    stdout.write(`${LABEL}: ${root}: ${summary.removed.length} removed, ${summary.written.length} rewritten\n`);
    report(stderr, summary);
    return 0;
  } catch (error) {
    stderr.write(`${LABEL}: ${describe(error)}\n`);
    return 1;
  }
}

module.exports = {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  ToolkitError,
  applyRulesBlock,
  removeRulesBlock,
  resolveRoot,
  install,
  uninstall,
  runInstall,
  runUninstall,
};
