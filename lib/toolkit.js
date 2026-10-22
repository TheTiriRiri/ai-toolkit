"use strict";
// Shared logic of the installer and the uninstaller: the managed block in the consumer's CLAUDE.md,
// the install manifest and the project root. install.js and uninstall.js are thin CLIs over this module.
const path = require("node:path");

const PACKAGE_DIR = path.join(__dirname, "..");
const { name: PACKAGE_NAME } = require(path.join(PACKAGE_DIR, "package.json"));

const BEGIN = `<!-- BEGIN ${PACKAGE_NAME} -->`;
const END = `<!-- END ${PACKAGE_NAME} -->`;
const RULES_FILE = "CLAUDE.md";

/** An expected failure: the CLIs print its message without a stack trace. */
class ToolkitError extends Error {}

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

module.exports = {
  PACKAGE_NAME,
  ToolkitError,
  applyRulesBlock,
  removeRulesBlock,
};
