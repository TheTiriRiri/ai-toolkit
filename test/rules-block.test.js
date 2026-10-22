"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { applyRulesBlock, removeRulesBlock } = require("../lib/toolkit");

const BEGIN = "<!-- BEGIN @thetiriri/10x-ai-toolkit -->";
const END = "<!-- END @thetiriri/10x-ai-toolkit -->";
const RULES = "# Rules\n\n- One sentence per commit.\n";
const BLOCK = `${BEGIN}\n# Rules\n\n- One sentence per commit.\n${END}`;

test("appends the block after existing notes, separated by one blank line", () => {
  assert.equal(applyRulesBlock("# My notes\n", RULES), `# My notes\n\n${BLOCK}\n`);
});

test("terminates notes that lack a final newline before appending the block", () => {
  assert.equal(applyRulesBlock("# My notes", RULES), `# My notes\n\n${BLOCK}\n`);
});

test("an empty file gets the block alone", () => {
  assert.equal(applyRulesBlock("", RULES), `${BLOCK}\n`);
});

test("replaces only the managed block and keeps the text around it", () => {
  const existing = `# Before\n\n${BEGIN}\nold rules\n${END}\n\n# After\n`;
  assert.equal(applyRulesBlock(existing, RULES), `# Before\n\n${BLOCK}\n\n# After\n`);
});

test("applying the same rules twice changes nothing the second time", () => {
  const once = applyRulesBlock("# My notes\n", RULES);
  assert.equal(applyRulesBlock(once, RULES), once);
});

test("refuses rules that carry a package marker of their own", () => {
  assert.throws(() => applyRulesBlock("# My notes\n", `${RULES}${END}\n# smuggled\n`), /marker/);
  assert.throws(() => applyRulesBlock("# My notes\n", `${BEGIN}\n${RULES}`), /marker/);
});

const BROKEN_FILES = [
  ["only a BEGIN marker", `# Notes\n${BEGIN}\nrules\n`],
  ["only an END marker", `# Notes\nrules\n${END}\n`],
  ["END before BEGIN", `${END}\nrules\n${BEGIN}\n`],
  ["two blocks", `${BEGIN}\na\n${END}\n${BEGIN}\nb\n${END}\n`],
];

for (const [label, content] of BROKEN_FILES) {
  test(`refuses to apply rules to a file with ${label}`, () => {
    assert.throws(() => applyRulesBlock(content, RULES), /marker/);
  });

  test(`refuses to remove the block from a file with ${label}`, () => {
    assert.throws(() => removeRulesBlock(content), /marker/);
  });
}

for (const original of ["# My notes\n", "# My notes\n\n", "", "\n", "a\r\nb\r\n"]) {
  test(`removing the block restores ${JSON.stringify(original)} byte for byte`, () => {
    assert.equal(removeRulesBlock(applyRulesBlock(original, RULES)), original);
  });
}

test("removing the block leaves notes that lacked a final newline newline-terminated", () => {
  assert.equal(removeRulesBlock(applyRulesBlock("# My notes", RULES)), "# My notes\n");
});

test("a file without markers is returned unchanged by removal", () => {
  assert.equal(removeRulesBlock("# Only my notes\n"), "# Only my notes\n");
});

test("notes written after the block survive its removal with a single blank line between sections", () => {
  assert.equal(removeRulesBlock(`# Before\n\n${BLOCK}\n\n# After\n`), "# Before\n\n# After\n");
  assert.equal(removeRulesBlock(`# Before\n\n${BLOCK}\n# Added later\n`), "# Before\n\n# Added later\n");
});

test("a block at the top of the file is removed together with the blank line under it", () => {
  assert.equal(removeRulesBlock(`${BLOCK}\n\n# Notes\n`), "# Notes\n");
});
