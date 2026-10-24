# @thetiririri/10x-ai-toolkit

My AI artifacts for Claude Code in one npm package on GitHub Packages: the `code-review` and `html-report` skills, plus working rules that the installer appends to the `CLAUDE.md` of the consumer repository.

## Why GitHub Packages

The recipients are my own repositories on one GitHub account and the agent sessions working in them, so I choose Model 1 from lesson M5L4. It costs one `publishConfig` field in `package.json` and one read-only PAT, while AWS CodeArtifact or an API of my own with a CLI would be infrastructure without a recipient.

## Contents

| In the package | In the consumer | What it is |
| --- | --- | --- |
| `skills/code-review/` | `.claude/skills/code-review/` | change review: six criteria on a 1–10 scale, a `pass`/`fail` verdict computed from the scores, a summary |
| `skills/html-report/` | `.claude/skills/html-report/` | a Markdown report turned into a standalone HTML page |
| `rules/CLAUDE.md` | a block between markers in `CLAUDE.md` | working rules |

The installer also writes `.claude/.10x-ai-toolkit-manifest.json` with the version, the install mode and the hash of every installed file.

## Installing in a consumer repository

1. The committed `.npmrc` holds only the scope mapping, no token:

   ```
   @thetiririri:registry=https://npm.pkg.github.com
   ```

2. Reading needs a PAT (classic) with the `read:packages` scope, because the npm registry of GitHub Packages does not accept fine-grained tokens. The token goes into `~/.npmrc` as `//npm.pkg.github.com/:_authToken=…`, never into the repository and never through chat.
3. Install from the repository root, always with a pinned version, because the npx cache can serve a stale copy:

   ```bash
   npx --yes @thetiririri/10x-ai-toolkit@0.1.3
   ```

4. Commit the installed files (`.claude/skills/`, the manifest, `CLAUDE.md`). In copy mode the artifacts travel with the repository, to CI and to cloud sessions too.

An update is the same command with a newer version. A skill changed locally is skipped with a warning, and the bin then exits with code 2 (a failure is code 1), so a script cannot take an incomplete update for a successful one. `--force` overwrites such a skill with the packaged version.

Uninstalling works from the manifest alone, so it does not need `node_modules`:

```bash
npx --yes -p @thetiririri/10x-ai-toolkit@0.1.3 10x-ai-toolkit-uninstall
```

An install after an uninstall writes the manifest anew, so even at the same version at least `installedAt` changes in it.

The drift gate in the consumer's CI installs the version recorded in the manifest with `--force` and checks that the tree stayed clean. In GitHub Actions npm gets the token only through `actions/setup-node` with `registry-url` and `scope`; `NODE_AUTH_TOKEN` alone does nothing without them. The `GH_PKG_TOKEN` secret is a PAT (classic) with `read:packages`:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
- uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
  with:
    node-version: 22
    registry-url: https://npm.pkg.github.com
    scope: "@thetiririri"
- name: Reinstall the recorded toolkit version and fail on drift
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GH_PKG_TOKEN }}
  run: |
    version=$(node -p 'require("./.claude/.10x-ai-toolkit-manifest.json").version')
    npx --yes "@thetiririri/10x-ai-toolkit@$version" --force
    drift=$(git status --porcelain -- .claude/skills CLAUDE.md .claude/.10x-ai-toolkit-manifest.json)
    if [ -n "$drift" ]; then echo "$drift"; exit 1; fi
```

Without `--force` the bin would stop at a locally changed skill with code 2 and the step would fail without a list of differences; with `--force` it overwrites the skill, and `git status` shows what drifted. The gate uses `git status` rather than `git diff --exit-code` because the install restores a deleted skill file as untracked, and `git diff` does not see untracked files. For the same reason `.claude/skills/` and the manifest must be in the repository and outside `.gitignore`: an ignored directory hides drift from `git status`. To ignore `.claude/settings.local.json`, put that file alone in `.gitignore`, not the whole `.claude/` directory.

CI can also do without a PAT. In the package settings, under "Manage Actions access", add the consumer repository with the Read role; the workflow then gets `permissions: { contents: read, packages: read }` and `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. This route comes from GitHub's documentation; `ai-review-lab` uses a PAT, and a local install needs the PAT anyway.

## How the installer works

- **Markers.** The rules sit in `CLAUDE.md` between `<!-- BEGIN @thetiririri/10x-ai-toolkit -->` and `<!-- END @thetiririri/10x-ai-toolkit -->`. Each marker stands on a line of its own, and a marker quoted inside a sentence is not a marker. Every install replaces only this block, and notes outside it stay. An unpaired or repeated marker stops the install before a single file changes, and rules that contain a marker are refused. The block takes the file's line endings (CRLF or LF), so converting the line endings of the whole file is neither a hand edit of the block nor drift.
- **Manifest.** The uninstaller removes only the files in the manifest, and only those whose hash matches; changed ones stay unless you pass `--force`. `CLAUDE.md` is removed only when the install created it and nothing but the block is left in it. The consumer's `.npmrc` and `package.json` are never touched. An unreadable manifest, a path in it that leads outside `.claude/skills/`, or a symlink through which a write or delete would leave the project directory stops both scripts before any file changes. A link inside the project (e.g. `CLAUDE.md` → `AGENTS.md`) works normally.
- **Idempotence.** A second install of the same version changes no byte, `installedAt` in the manifest included, so `git status` stays clean.
- **Target directory.** Through `npx` (copy mode) the package installs into the current directory and refuses when it does not look like a project: no `.git`, `package.json`, `.claude/` or `CLAUDE.md`. As a dependency (`npm install`), `postinstall` installs into the project above `node_modules`, and a global install does nothing. `PROJECT_ROOT` points at the target directory in both modes (a relative path counts from the directory where `npx` or `npm install` was run), with one exception: in the npx cache `postinstall` always skips, because the bin installs right after it. A failure in `postinstall` is only a warning, so that it does not break `npm install`. npm 7+ hides the output of `postinstall`, though (it shows only with `--foreground-scripts`), so problems such as a skipped skill are reported only by the bin run through `npx`.

## Skill name collisions in Claude Code

- The project `code-review` replaces the built-in `/code-review`, and the built-in review stays available under the `/review` alias.
- A personal skill wins over a project one: on a machine with `~/.claude/skills/html-report`, `/html-report` runs that copy, not the packaged one.

## Releasing a new version

1. Change `skills/`, `rules/` or `lib/` and commit on `main`.
2. `npm version patch -m "Release %s."` (or `minor`) creates the version commit and the `vX.Y.Z` tag.
3. `git push origin main --follow-tags`. Pushing the tag **publishes** the version. GitHub Packages rejects publishing the same version again (409), so a fix is always a new version.

The workflow `.github/workflows/publish-10x-ai-toolkit.yml` validates every push and PR, and publishes only from a `v*` tag. Before publishing it checks that the tag equals the `package.json` version and points at a commit on `main`, warns when no packaged file changed since the previous tag, and skips a version that is already published. It publishes with `GITHUB_TOKEN`, and only the publish job has `packages: write`.

## Development

The package has no dependencies and no lockfile, and needs Node 22 or newer.

```bash
npm test           # node:test tests
npm run validate   # skill frontmatter, rules without markers, syntax, tests and the exact npm pack file list
```
