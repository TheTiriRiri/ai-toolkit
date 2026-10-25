# Working rules (@thetiririri/ai-toolkit)

These rules come from the `@thetiririri/ai-toolkit` package, which keeps them in this block of the file. To change them, edit `rules/CLAUDE.md` in the toolkit repository and publish a new version: edits inside the block are replaced on the next install. Notes outside the block are yours and survive every install.

## Skills from this package

| When | Use |
| --- | --- |
| Reviewing a diff, a branch or a pull request before merge | `/code-review` |
| Turning a report, review or plan into a standalone HTML page | `/html-report` |

## Working rules

- Commit messages are one sentence with no body and no AI attribution: no `Co-Authored-By` trailer and no "Generated with" line.
- Never run `curl` or `wget` (not even against localhost), never start ad-hoc HTTP servers, and never download tools or images (`npx -y <new tool>`, `uvx`, `pip install`, Docker pulls, release tarballs) without asking first. When a tool is missing, skip the step and say so.
- Secrets never pass through the chat. When a command needs one, write a gitignored script that polls the clipboard (`xclip -selection clipboard -o` on Linux) until a value with the expected prefix appears, pipes it to the command without printing it, and clears the clipboard; the user runs it with `!`. A secret pasted into the chat counts as leaked.
- Ask before every `git push`, `gh repo create`, `gh secret set` and `gh auth refresh`, one at a time, and above all before pushing a release tag: a published package version can never be reused.
- Pin third-party GitHub Actions to a full commit SHA with the tag in a comment, as in `uses: actions/checkout@<sha> # v7.0.1`.
- When a rule here conflicts with this repository's own instructions, the repository wins; say so and propose a change to the toolkit.
