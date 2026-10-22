#!/usr/bin/env bash
# Pre-publish checks of the package: skill frontmatter, the rules file, script syntax and the exact contents
# of the tarball. `npm run validate` runs this and then the tests; CI runs `npm run validate`.
set -euo pipefail
cd "$(dirname "$0")/.."
export npm_config_update_notifier=false

fail() {
  echo "::error::$*" >&2
  exit 1
}

name=$(node -p 'require("./package.json").name')

shopt -s nullglob
dirs=(skills/*/)
[ ${#dirs[@]} -gt 0 ] || fail "no skills in skills/"
for dir in "${dirs[@]}"; do
  skill=$(basename "$dir")
  file="${dir}SKILL.md"
  case "$skill" in
    10x-* | pack-init | setup-cicd | tf-registry | caveman | humanizer | no-ai-slop | planning-with-files | bt-audio | whisper-lang)
      fail "skills/$skill is a course, community or machine-specific skill and must not ship" ;;
  esac
  [ -f "$file" ] || fail "$file is missing"
  [ "$(head -n 1 "$file")" = "---" ] || fail "$file has no YAML frontmatter"
  frontmatter=$(sed -n '2,/^---$/p' "$file")
  declared=$(printf '%s\n' "$frontmatter" | sed -n 's/^name:[[:space:]]*//p' | head -n 1 | tr -d "\"'")
  [ "$declared" = "$skill" ] || fail "$file: frontmatter name '$declared' does not match the directory '$skill'"
  printf '%s\n' "$frontmatter" | grep -Eq '^description:[[:space:]]*[^[:space:]]' || fail "$file: frontmatter has no description"
  if grep -Fq '~/.claude/skills' "$file"; then
    fail "$file points at ~/.claude/skills; installed skills live in .claude/skills of the repository"
  fi
done

[ -f rules/CLAUDE.md ] || fail "rules/CLAUDE.md is missing"
if grep -Fq -e "<!-- BEGIN $name -->" -e "<!-- END $name -->" rules/CLAUDE.md; then
  fail "rules/CLAUDE.md contains a $name marker; the installer adds the markers itself"
fi

for script in install.js uninstall.js lib/*.js; do
  node --check "$script" 2>/dev/null || fail "$script does not parse"
done

# The tarball must hold exactly what "files" names, and everything the bins need at install time.
PACK_JSON=$(npm pack --dry-run --json --ignore-scripts) node -e '
  const fs = require("node:fs");
  const pkg = require("./package.json");
  const packed = JSON.parse(process.env.PACK_JSON)[0].files.map((file) => file.path);
  const covers = (entry, file) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry);
  const bins = Object.values(pkg.bin).map((bin) => bin.replace(/^\.\//, ""));
  const skills = fs.readdirSync("skills").map((skill) => `skills/${skill}/SKILL.md`);
  const problems = [];
  for (const file of packed) {
    if (file !== "package.json" && !pkg.files.some((entry) => covers(entry, file))) {
      problems.push(`${file} is packed but not listed in "files"`);
    }
    if (/(^|\/)__pycache__\/|\.pyc$/.test(file)) problems.push(`${file} is Python bytecode`);
  }
  for (const entry of pkg.files) {
    if (!packed.some((file) => covers(entry, file))) problems.push(`"files" entry ${entry} is not in the tarball`);
  }
  for (const file of [...bins, "lib/toolkit.js", "rules/CLAUDE.md", ...skills]) {
    if (!packed.includes(file)) problems.push(`${file} is needed at install time but is not in the tarball`);
  }
  for (const bin of bins) {
    if (!fs.readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node\n")) problems.push(`${bin} lacks the node shebang`);
  }
  for (const problem of problems) console.error(`::error::${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`npm pack: ${packed.length} files, exactly the "files" entries`);
'
echo "validate: ${#dirs[@]} skill(s), rules and scripts OK"
