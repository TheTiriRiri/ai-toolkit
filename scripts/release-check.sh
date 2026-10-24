#!/usr/bin/env bash
# Gate of the publish job, which runs for v* tags only. Fails when the tag is not v<package.json version> or not
# on main, warns when no packaged file changed since the previous tag (a version bump alone is not a change), and writes
# publish=false to $GITHUB_OUTPUT when the version is already in the registry, so a re-run skips instead of 409.
# Usage: bash scripts/release-check.sh <tag>
set -euo pipefail
cd "$(dirname "$0")/.."
export npm_config_update_notifier=false

tag=${1:?usage: release-check.sh <tag>}
name=$(node -p 'require("./package.json").name')
version=$(node -p 'require("./package.json").version')

if [ "$tag" != "v$version" ]; then
  echo "::error::tag $tag does not match package.json version $version; tag the release as v$version" >&2
  exit 1
fi

# Ancestry, not equality: a re-run after main moved on must still pass. origin/main comes from fetch-depth: 0.
if ! git merge-base --is-ancestor "$tag" origin/main 2>/dev/null; then
  echo "::error::tag $tag is not on origin/main; release from a commit of main" >&2
  exit 1
fi

without_version() {
  node -e 'const pkg = JSON.parse(require("node:fs").readFileSync(0, "utf8")); delete pkg.version; process.stdout.write(JSON.stringify(pkg));'
}

previous=$(git describe --tags --abbrev=0 --match 'v*' "$tag^" 2>/dev/null || true)
if [ -n "$previous" ]; then
  mapfile -t packaged < <(node -e 'for (const entry of require("./package.json").files) console.log(entry)')
  if git diff --quiet "$previous" "$tag" -- "${packaged[@]}" &&
    [ "$(git show "$previous:package.json" | without_version)" = "$(git show "$tag:package.json" | without_version)" ]; then
    echo "::warning::no packaged file changed since $previous, so $tag republishes the same content"
  fi
fi

# npm view prints the version once it is published, nothing for a known package without that version, and fails
# with E404 for a package the registry does not know: compare the output, never trust the exit code alone.
published=$(npm view "$name@$version" version 2>/dev/null || true)
if [ "$published" = "$version" ]; then
  echo "::notice::$name@$version is already published; nothing to do"
  decision=false
else
  decision=true
fi
echo "publish=$decision" | tee -a "${GITHUB_OUTPUT:-/dev/null}"
