---
name: html-report
description: Use when the user wants a report, findings write-up, review, plan or analysis delivered as a standalone .html page (e.g. "zapisz do .html", "save as HTML I can send to the PO", "zrób wersję PL i EN", "add an edit mode like the ERP viewer") — from a Markdown file or from content just written in chat.
user-invocable: true
---

# html-report

Markdown → **one self-contained HTML file** with a fixed report design (hero + meta cards, TOC, numbered finding cards, ID-tagged items, badges, callouts, scrollable tables, OS-following light/dark, A4 print) and a built-in **Edit Mode** (in-browser editing, localStorage draft, restore on reload, export edited copy). File paths in the text become links that are verified against the filesystem.

**Core rule: write Markdown, run the script, never hand-write the page or a new generator.** Without the script an agent needed a bespoke 45 KB generator, 32 tool calls and ~18 min for one page that matched nothing else; with it, one command per language and an identical design every time.

## When to use

- A report / analysis / plan / review must leave the chat as `.html` ("a page I can send", "printable", "with edit mode", "PL + EN").
- NOT for web apps, live dashboards, slides, or when the user asks for an Artifact.

## Workflow

1. **Source = Markdown, named after the subject.** The output name is what the reader sees: `<topic-or-ticket-slug>.md` → `.html` (never `sample`, `report`, `output`). Existing `.md` with a good name → use it; scratch/chat content → write it to that name where the HTML should live. Keep the source language. Move any trailing "generated on…" line into front matter `footer:`.
2. **Apply the conventions** (table below); copy the skeleton of [example.md](example.md).
3. **Build:**
   ```bash
   python3 .claude/skills/html-report/build_report.py <slug>.md --root <repo root> [--lang en|pl] [--link-base URL] [--strict] [--theme NAME]
   ```
   `--theme` layers `report-<name>.css` over the default look. Available:
   | theme | look | reach for it when |
   |---|---|---|
   | `engineering` | spec-sheet: auto-numbered sections, hairline rules, single teal accent, no shadows | technical / architecture reports |
   | `paper` | warm cream canvas, serif headings, booktabs tables, no panel fills | decision records, PO-facing write-ups, long reading |
   | `blueprint` | pure monochrome, faint drafting grid, right-aligned figures, dotted TOC leaders | port maps, dependency matrices, table-heavy pages |
   | `tui` | Gruvbox, box borders, `.meta` as a status bar, `[!]` callout labels | runbooks, ops timelines, DevOps requests |
   | `catppuccin` | official Latte / Mocha, `##` heading markers, tree-shaped TOC | code reviews, bug write-ups, many code spans |
   | `riviera` | 1930s travel poster: sand, navy, terracotta, postcard cards | retros, summaries meant to be enjoyed |
   | `brutal` | 3px borders, hard offset shadows, flat saturated states | short reviews and checklists, under ~3 pages |

   Every theme carries its own light, dark and print palettes; all pass WCAG AA on the fixture. Themes are auto-discovered from the skill dir, so a new look is a new `report-*.css` file and **never** an edit to `report.css`, which is the shared default and would restyle every past report. Only pass a theme when the user asks for one. To restyle an already-built HTML whose `.md` is gone, append the theme file inside its existing `<style>` block rather than hand-editing rules.
   `--root` = directory `path/file.ext:12-34` spans resolve against. Link modes (the build prints which): `--link-base https://<gitlab>/<grp>/<repo>/-/blob/<branch>/` → real URLs with working `#L` anchors, use it whenever the file leaves the machine (only valid when `--root` is a single git repo — in a multi-repo workspace the paths span several repos, so keep relative links and say so); otherwise links are relative (valid only while the file stays in the tree) or absolute when the output is far outside `--root` (dead anywhere else). `--lang` overrides front matter `lang`.
4. **Act on the build report.** `MISSING:` = path absent under `--root` (left as plain code) → fix the path, or mark it intentional with `` `?path/file.py` `` (rendered as code, unverified). `RANGE:` = cited lines past end of file → **open the file and cite the real span; never clamp to EOF.** Exit 2 = unbalanced HTML → fix the Markdown (raw HTML / unclosed fence). Use `--strict` so leftovers fail the build.
5. **Second language only when asked:** translate into `<slug>_pl.md` / `<slug>_en.md`, build with `--lang`, cross-link both with `--pair HREF=LABEL` (HREF relative to the output file; overrides front matter `pair:`). Translate prose, badge text, status, labels, callouts; keep IDs (A1/B2), code spans, paths, product and person names. Say the translation is unreviewed.
6. **Report back** in one place: file path(s) + size; MISSING/RANGE = 0; link mode used (and that relative/absolute links are dead in an e-mailed copy — use `--link-base` for that); Edit Mode caveats: the browser cannot overwrite the file (durable result = exported copy), drafts live in that browser for that file location (a mailed or exported copy starts clean), the PL/EN cross-link only works when both files sit together. No commit, no Artifact unless asked.

Verification beyond the built-in structural check is optional and only on request: serve the output dir with `python3 -m http.server 8765 --bind 127.0.0.1 &` (Playwright MCP refuses `file://`), stop it with `kill <pid>` — not `pkill -f`, which matches your own shell. Headless Chrome on a dark-GTK host renders dark by default; force `--blink-settings=preferredColorScheme=1` for a light shot (`0` is dark).

Needs `markdown-it-py` (`pip install markdown-it-py`); `pyyaml` optional.

`theme-preview.md` is the theme fixture: it exercises every construct the builder can emit. Build it with each theme after touching `report.css` or adding a theme — it is the only page that shows the whole surface at once.

## Markdown conventions

| You write | You get |
|---|---|
| Front matter `title`, `subtitle`, `kicker`, `date`, `owner`, `scope`, `status`, `meta: {Label: value}`, `lang`, `footer`, `pair` | Hero + meta cards. Value prefixed `!warn ` / `!ok ` / `!bad ` / `!part ` / `!info ` renders as a badge (`status: "!warn STOPPED — awaiting answers"`). No `title` → first `# H1` is promoted. |
| `## Heading` | Section + TOC entry (auto; `--no-toc` to skip) |
| ` ```cards ` … `### Title` + body … ` ``` ` | Grid of numbered finding cards (`cards nonum` = no numbers) |
| ` ```items ` … `- **A1** **Title.** body` … ` ``` ` | ID-tagged item list (proposals, questions, risks); title optional; continuation lines indented 2 spaces |
| `[[ok:exists]]` `[[bad:none]]` `[[part:partial]]` `[[warn:risk]]` `[[info:PO]]` | Coloured pill badges |
| `> [!STOP]` / `> [!WARNING]` / `> [!OK]` / `> [!NOTE]` + text | Callout (red / amber / green / neutral) |
| `` `dir/file.ext:12-34` `` inline code (needs a `/` and extension) | Verified link with `#L12-34`; unresolved → plain code + MISSING; `` `?dir/file.ext` `` → plain code, unverified |
| GFM table | Scrollable table, `th scope="col"` |
| Register ID (`D-01`, `OP-44`, `R-50`, `A3-10`) leading a table row or a bold list item | Anchor `id="ref-<ID>"` at that definition; every mention elsewhere becomes a cross-link (`--no-refs` to skip). Only IDs that got an anchor are linked, so `AC-3` or `F8-2` stay plain unless they are defined the same way. **First definition wins** — a table row beats a bold list item, and among equals the earliest one; put the canonical register first if you care where mentions land. A competing later definition is left as plain text, never linked to its rival. |

Keep `cards` / `items` fences at top level of a section (not inside lists or quotes).

## Edit Mode

Foreign markup entering the page — paste, drag-and-drop, restoring a draft — is run through an allow-list sanitizer (no scripts, event handlers or scriptable URLs) before it touches the live DOM; drafts are stored sanitized too.

Always on. Floating button → toolbar: change counter, **Save draft** (localStorage, Ctrl+S), **Export HTML** (`<name>-edited-<timestamp>.html`, edits baked in, Edit Mode kept), **Reset**, **Exit**; restore prompt on reload; unsaved-changes guard; hidden in print. Editable: headings, paragraphs, cards, items, table cells incl. headers, callouts, meta cards, footer.

## Common mistakes

| Mistake | Fix |
|---|---|
| Writing a bespoke generator or hand-crafted HTML "because the request is a bit different" | Extend the Markdown, not the tooling; the script already covers header, TOC, cards, items, badges, callouts, links, edit mode, validation. |
| Paths as prose ("see ingestion.py line 58") | Code-span form `` `platform/x/ingestion.py:58` `` → verified link. |
| "Fixing" a RANGE by clamping to the file length | Read the file; cite the real span. |
| Delivering with MISSING/RANGE lines in the output | Each is a wrong reference for the reader — fix, or `?`-mark as intentional. |
| Relative links in a file that will be e-mailed | Build with `--link-base` (GitLab blob URL). |
| Translating by editing the built `.html` | Translate the `.md`, rebuild; otherwise the pair drifts. |
| Inventing output names (`report.en.html`, `sample.html`) | `<slug>.html` + `<slug>_pl.html` / `_en.html`, cross-linked via `--pair`. |

`/html-report <source.md> [--root DIR] [--lang pl|en]` — treat `$ARGUMENTS` as build arguments; with no source file, first write the chat content to Markdown (step 1).
