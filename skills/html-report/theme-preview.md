---
title: Theme Preview — every construct
kicker: FIXTURE · html-report · all themes
subtitle: A single page exercising every element the builder can emit, so a theme can be checked against the whole surface in one screenshot.
date: 2026-09-03
owner: theme QA
scope: hero · meta · toc · cards · items · badges · callouts · tables · code · quotes
status: "!warn LONG STATUS — checks that a wrapping badge stays inside its meta tile"
meta:
  Themes: "7 available"
  Base: "report.css (17 vars)"
  Modes: "!ok light · dark · print"
  Fixture: "!info not a theme — name does not match report-*.css"
lang: en
footer: Fixture page. Rebuild after any change to report.css.
---

## 1. Headings and prose

Body copy sets the baseline. This paragraph is long enough to show the measure a theme imposes on `main`, the line-height it inherits, and how an inline `code span` and a [plain link](https://example.com) sit inside running text. A theme that widens the measure past roughly 80 characters makes long reports tiring to read.

### A third-level heading

Text under `h3`. Themes that number sections must not number this one.

#### A fourth-level heading

`h4` is the same element the builder uses for card and item titles, so whatever it gets here also lands there.

- An unordered list item.
- A second item, with a longer run of text so that wrapping behaviour inside lists is visible next to the paragraph above it.
- A third item containing `inline code`.

1. First ordered item.
2. Second ordered item.

<span class="small">Small text uses the `.small` class and should read as secondary without disappearing.</span>

---

The rule above is an `hr`.

## 2. Cards

```cards
### Numbered card
The number is a real text node in `div.num`, not a CSS counter. A theme replacing it with a counter must hide the original text rather than assume it is absent.

### Card with a list
Body content is full markdown, so a card can hold structure:

- first point
- second point

### Card with a long title that wraps onto two lines to test heading rhythm
Enough body text to make the card taller than its neighbours, so the grid's equal-height behaviour is visible.
```

Below is the same fence with `nonum` — same classes, no `div.num`.

```cards nonum
### Unnumbered card
Used for lists of concepts where an index would imply a ranking that does not exist.

### Second unnumbered card
Two are enough to show the grid.
```

## 3. Items and badges

```items
- **A1** **Item with a title.** The identifier sits in its own column at a fixed width. Continuation text wraps under the title, not under the id.
- **A2** **Item whose title is noticeably longer than the first one.** Body text follows. A second sentence keeps the block tall enough to see vertical rhythm against A1.
- **B1** Item with no title at all — the body starts immediately after the id.
- Item with no id either, which the builder renders with a bullet placeholder.
```

All five badge kinds inline: [[ok:ok]] [[bad:bad]] [[part:part]] [[warn:warn]] [[info:info]] — and one with longer text, [[info:awaiting architect sign-off]], to check padding on a wide pill.

## 4. Tables

| Service | Port | State | Owner | Notes |
|---|---|---|---|---|
| orchestrator | 8000 | [[ok:up]] | core | LangGraph coordinator, sole entry point for agents |
| asset-service | 8083 | [[ok:up]] | platform | 13 routers; migrations under `alembic/versions/` |
| mcp-monday | 8093 | [[bad:absent]] | — | no compose service; hostname resolves to nothing |
| ai-central | 8088 | [[part:degraded]] | platform | guardrails on, PII blocking currently rejects email addresses |
| agent-chat | 8085 | [[warn:check]] | agents | mounts under a different prefix than the orchestrator calls |

A second table with a list inside a cell, and a first column long enough to test the `nowrap` the base applies to it:

| Area | Findings |
|---|---|
| Ingestion | <ul><li>full-snapshot upsert</li><li>no watermark</li></ul> |
| Scheduling | Nothing found in compose, manifests or code. |

## 5. Code, quotes and callouts

A fenced block:

```bash
python3 build_report.py theme-preview.md \
  --root ~/.claude/skills/html-report \
  --theme paper --strict
```

A block quote, which is a different element from a callout:

> Quoted text uses `blockquote`. Themes that restyle callouts should decide deliberately whether the quote follows or stays neutral.

All four callout kinds follow. Note that the label word is never in the DOM — it exists only as a class.

> [!NOTE]
> A `NOTE` produces a bare `class="callout"` with no state class at all. If a theme only styles the three coloured variants, this one keeps the base look.

> [!OK]
> An `OK` callout. Confirmations and green-path notes land here.

> [!WARNING]
> A `WARNING` callout. This is the workhorse — most gotchas in real reports use it, so it must stay readable at length.

> [!STOP]
> A `STOP` callout is the loudest thing on the page and should read as a hard blocker.

## 6. Paths and links

A resolving path link renders as `html-report/report.css` and a line-scoped one as `html-report/report.css:1-2`. An intentionally unverified path stays plain code: `?does/not/exist.py`.
