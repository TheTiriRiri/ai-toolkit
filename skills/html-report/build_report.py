#!/usr/bin/env python3
"""Build a self-contained HTML report (design system + Edit Mode) from Markdown.

Usage:
  build_report.py SOURCE.md [-o OUT.html] [--root DIR] [--lang en|pl]
                  [--no-toc] [--no-links] [--pair HREF=LABEL]

See SKILL.md for the Markdown conventions (front matter, ```cards, ```items,
[[kind:text]] badges, > [!STOP] callouts, `path/file.ext:12-34` links).
"""
from __future__ import annotations

import argparse
from collections import Counter
import datetime as _dt
import html
import html.parser
import json
import os
import pathlib
import re
import sys

try:
    from markdown_it import MarkdownIt
    from markdown_it.renderer import RendererHTML
except ImportError:  # pragma: no cover
    sys.exit("markdown-it-py is required: pip install markdown-it-py")

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

HERE = pathlib.Path(__file__).resolve().parent
CSS = (HERE / "report.css").read_text(encoding="utf-8")
EDIT_JS = (HERE / "edit-mode.js").read_text(encoding="utf-8")
THEMES = sorted(p.stem[len("report-"):] for p in HERE.glob("report-*.css"))


def theme_css(theme: str | None) -> str:
    """Extra stylesheet appended after the base CSS, so it wins on cascade order."""
    if not theme:
        return ""
    f = HERE / f"report-{theme}.css"
    if not f.exists():
        raise SystemExit(f"unknown theme {theme!r}; available: {', '.join(THEMES) or '(none)'}")
    return "\n" + f.read_text(encoding="utf-8")

LABELS = {
    "en": dict(
        toc="Contents", date="Date", owner="Owner", scope="Scope", status="Status",
        generated="generated", edit="✏️ Edit Mode", editing="✏️ Editing…", exit="✕ Exit Edit Mode",
        save="💾 Save draft", export="⬇️ Export HTML", reset="↺ Reset",
        nodraft="No saved draft", unsaved="⚠️ Unsaved changes", saved="✅ Draft saved at ",
        savefail="⚠️ Could not save — browser storage is full or blocked. Use Export HTML to keep your edits.",
        restored="📁 Draft restored", edits=" edited section(s)",
        restoreq="Found a saved draft from {date} with {n} edited section(s).\n\nRestore it?",
        resetq="Reset all edits and clear the saved draft? This cannot be undone.",
        leaveq="You have unsaved edits. Save the draft before leaving?",
        exported="Exported {n} edited section(s) to {file}.\nThe file keeps Edit Mode and can be shared.",
        hint="Click any card, paragraph or table cell to edit. Changes stay in this browser until you Save; Export downloads a copy with your edits baked in.",
    ),
    "pl": dict(
        toc="Spis treści", date="Data", owner="Właściciel", scope="Zakres", status="Status",
        generated="wygenerowano", edit="✏️ Tryb edycji", editing="✏️ Edytujesz…", exit="✕ Wyjdź z edycji",
        save="💾 Zapisz szkic", export="⬇️ Eksportuj HTML", reset="↺ Resetuj",
        nodraft="Brak zapisanego szkicu", unsaved="⚠️ Niezapisane zmiany", saved="✅ Szkic zapisany o ",
        savefail="⚠️ Nie udało się zapisać — pamięć przeglądarki pełna lub zablokowana. Użyj Eksportuj HTML, żeby zachować zmiany.",
        restored="📁 Szkic przywrócony", edits=" zmienionych sekcji",
        restoreq="Znaleziono szkic z {date} z {n} zmienionymi sekcjami.\n\nPrzywrócić?",
        resetq="Zresetować wszystkie zmiany i usunąć zapisany szkic? Operacja nieodwracalna.",
        leaveq="Masz niezapisane zmiany. Zapisać szkic przed wyjściem?",
        exported="Wyeksportowano {n} zmienionych sekcji do {file}.\nPlik zachowuje tryb edycji i można go przekazać dalej.",
        hint="Kliknij kartę, akapit lub komórkę tabeli, aby edytować. Zmiany żyją w tej przeglądarce do momentu Zapisu; Eksport pobiera kopię z wprowadzonymi zmianami.",
    ),
}

BADGE_KINDS = ("ok", "bad", "part", "warn", "info")
CALLOUT_CLASS = {"STOP": "stop", "WARNING": "warn", "WARN": "warn", "OK": "ok", "NOTE": "", "INFO": ""}
PATH_RE = re.compile(r"^(?P<path>[\w.@~-]+(?:/[\w.@~-]+)+\.[A-Za-z0-9]{1,8})(?::(?P<lines>\d+(?:-\d+)?))?$")


# ── front matter ────────────────────────────────────────────────────────────

def split_front_matter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    m = re.match(r"^---[ \t]*\n(.*?)\n---[ \t]*\n?", text, flags=re.S)
    if not m:
        return {}, text
    raw, body = m.group(1), text[m.end():]
    if yaml is not None:
        meta = yaml.safe_load(raw) or {}
    else:  # minimal "key: value" fallback
        meta = {}
        for line in raw.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"').strip("'")
    return (meta if isinstance(meta, dict) else {}), body


# ── markdown renderer with custom fences ────────────────────────────────────

def make_md() -> MarkdownIt:
    md = MarkdownIt("commonmark").enable("table").enable("strikethrough")

    def fence_rule(self, tokens, idx, options, env):
        tok = tokens[idx]
        info = tok.info.strip().split()
        kind = info[0] if info else ""
        if kind == "cards":
            return render_cards(md, tok.content, nonum="nonum" in info)
        if kind == "items":
            return render_items(md, tok.content)
        return RendererHTML.fence(self, tokens, idx, options, env)

    md.add_render_rule("fence", fence_rule)
    return md


def render_cards(md: MarkdownIt, content: str, nonum: bool = False) -> str:
    chunks = re.split(r"(?m)^###\s+", content.strip())
    out = ['<div class="cards">']
    n = 0
    for chunk in chunks:
        if not chunk.strip():
            continue
        n += 1
        title, _, body = chunk.partition("\n")
        num = "" if nonum else f'<div class="num">{n}</div>'
        out.append(f'<div class="card">{num}<h4>{md.renderInline(title.strip())}</h4>{md.render(body.strip())}</div>')
    out.append("</div>")
    return "\n".join(out)


def render_items(md: MarkdownIt, content: str) -> str:
    raw_items = re.split(r"(?m)^[-*]\s+", content.strip())
    out = ['<div class="items">']
    for raw in raw_items:
        raw = raw.strip()
        if not raw:
            continue
        # de-indent continuation lines
        raw = "\n".join(line[2:] if line.startswith("  ") else line for line in raw.splitlines())
        m = re.match(r"^\*\*(?P<id>[^*]+)\*\*\s*(?P<rest>.*)$", raw, flags=re.S)
        item_id, rest = (m.group("id").strip(), m.group("rest")) if m else ("•", raw)
        t = re.match(r"^\*\*(?P<title>[^*]+)\*\*\s*(?P<body>.*)$", rest, flags=re.S)
        if t:
            head = f"<h4>{md.renderInline(t.group('title').strip())}</h4>"
            body = md.render(t.group("body").strip())
        else:
            head, body = "", md.render(rest.strip())
        out.append(f'<div class="item"><div class="id">{html.escape(item_id)}</div><div>{head}{body}</div></div>')
    out.append("</div>")
    return "\n".join(out)


# ── post-processing ─────────────────────────────────────────────────────────

def badges(h: str) -> str:
    kinds = "|".join(BADGE_KINDS)
    return re.sub(rf"\[\[({kinds}):([^\]]+)\]\]", lambda m: f'<span class="b {m.group(1)}">{m.group(2)}</span>', h)


def callouts(h: str) -> str:
    def repl(m):
        cls = CALLOUT_CLASS.get(m.group(1).upper(), "")
        classes = f"callout {cls}".strip()
        inner = re.sub(r"^\s*(<br\s*/?>|\n)", "", m.group(2))
        return f'<div class="{classes}"><p>{inner}</div>'
    return re.sub(r"<blockquote>\s*<p>\[!(\w+)\]\s*(.*?)</blockquote>", repl, h, flags=re.S)


def wrap_tables(h: str) -> str:
    h = h.replace("<th>", '<th scope="col">')
    return re.sub(r"<table>(.*?)</table>", r'<div class="scroll"><table>\1</table></div>', h, flags=re.S)


def slugify(text: str) -> str:
    s = re.sub(r"<[^>]+>", "", text)
    s = re.sub(r"[^\w\s-]", "", s.lower()).strip()
    return re.sub(r"[\s_]+", "-", s)[:60] or "section"


def add_heading_ids(h: str) -> tuple[str, list[tuple[str, str]]]:
    toc: list[tuple[str, str]] = []
    seen: set[str] = set()

    def repl(m):
        level, inner = m.group(1), m.group(2)
        base = slugify(inner)
        slug, i = base, 2
        while slug in seen:
            slug, i = f"{base}-{i}", i + 1
        seen.add(slug)
        if level == "2":
            toc.append((slug, inner))
        return f'<h{level} id="{slug}">{inner}</h{level}>'

    return re.sub(r"<h([23])>(.*?)</h\1>", repl, h, flags=re.S), toc


def link_paths(h: str, root: pathlib.Path, out_dir: pathlib.Path, link_base: str | None = None):
    if link_base:
        prefix = link_base.rstrip("/") + "/"
        mode = f"base {prefix}"
    else:
        rel_root = os.path.relpath(root, out_dir).replace(os.sep, "/")
        if rel_root.count("../") > 3:  # output far outside root: relative link is unreadable, use absolute
            prefix = root.as_posix().rstrip("/") + "/"
            mode = "absolute (output is far outside --root; dead off this machine)"
        else:
            prefix = "" if rel_root == "." else rel_root.rstrip("/") + "/"
            mode = f"relative to {prefix or './'} (valid while the file stays in the tree)"
    linked: list[str] = []
    missing: list[str] = []
    range_warnings: list[str] = []
    line_counts: dict[str, int] = {}

    def file_lines(path: str) -> int:
        if path not in line_counts:
            try:
                with open(root / path, "rb") as fh:
                    line_counts[path] = sum(1 for _ in fh)
            except OSError:
                line_counts[path] = -1
        return line_counts[path]

    def repl(m):
        text = html.unescape(m.group(1))
        if text.startswith("?"):  # `?path/file.py` = intentionally unverified (e.g. "this file does not exist")
            return f"<code>{m.group(1)[1:]}</code>"
        pm = PATH_RE.match(text)
        if not pm:
            return m.group(0)
        path, lines = pm.group("path"), pm.group("lines")
        if not (root / path).exists():
            missing.append(text)
            return m.group(0)
        frag = ""
        if lines:
            last = int(lines.split("-")[-1])
            total = file_lines(path)
            if 0 < total < last:
                range_warnings.append(f"{text}  (file has only {total} lines)")
            frag = f"#L{lines}"
        linked.append(text)
        return f'<a class="p" href="{prefix}{path}{frag}">{m.group(1)}</a>'

    return re.sub(r"<code>([^<]+)</code>", repl, h), linked, missing, range_warnings, mode


REF_ID = r"[A-Z]{1,3}[0-9]?-[0-9]{1,3}"
REF_MENTION_RE = re.compile(rf"\b({REF_ID})\b")
REF_DEF_STRONG_RE = re.compile(rf"(<tr>\s*<td[^>]*>\s*)<strong>({REF_ID})</strong>")
REF_DEF_PLAIN_RE = re.compile(rf"(<tr>\s*<td[^>]*>\s*)({REF_ID})(?=\s*</td>)")
REF_DEF_LI_RE = re.compile(rf"(<li>\s*)<strong>({REF_ID})</strong>")
REF_SKIP_TAGS = {"a", "code", "pre", "script", "style", "h1", "h2", "h3", "h4", "h5", "h6"}


def link_refs(h: str) -> tuple[str, int, int]:
    """Anchor register IDs (D-01, OP-44, R-50, A3-10) at their definition and link every mention.

    A definition is the leading cell of a table row — the shape canonical registers use — or,
    for IDs that never head a row, a leading bold list item. Only IDs that got an anchor are
    linked, so incidental matches (AC-3, F8-2) stay plain text.
    """
    anchors: dict[str, str] = {}

    def claim(pattern: re.Pattern, wrap: bool) -> None:
        def repl(m):
            rid = m.group(2)
            # A losing definition-shaped occurrence is marked, not linked: sending the reader
            # from one definition of an ID to a competing one would be worse than plain text.
            attr = f'data-refdef="{rid}"' if rid in anchors else f'id="ref-{rid}"'
            anchors.setdefault(rid, pattern.pattern)
            tag = f"<strong {attr}>{rid}</strong>" if wrap else f"<span {attr}>{rid}</span>"
            return m.group(1) + tag
        nonlocal h
        h = pattern.sub(repl, h)

    claim(REF_DEF_STRONG_RE, True)
    claim(REF_DEF_PLAIN_RE, False)
    claim(REF_DEF_LI_RE, True)

    links = 0
    depth = 0
    skip_text = False
    out: list[str] = []

    def repl_mention(m):
        nonlocal links
        rid = m.group(1)
        if rid not in anchors:
            return m.group(0)
        links += 1
        return f'<a class="r" href="#ref-{rid}">{rid}</a>'

    for tok in re.split(r"(<[^>]+>)", h):
        if tok.startswith("<") and tok.endswith(">"):
            tm = re.match(r"</?\s*([A-Za-z][A-Za-z0-9]*)", tok)
            name = tm.group(1).lower() if tm else ""
            if name in REF_SKIP_TAGS and not tok.endswith("/>"):
                depth = depth + 1 if not tok.startswith("</") else max(0, depth - 1)
            skip_text = 'id="ref-' in tok or "data-refdef=" in tok
        else:
            if tok and depth == 0 and not skip_text:
                tok = REF_MENTION_RE.sub(repl_mention, tok)
            skip_text = False
        out.append(tok)
    return "".join(out), len(anchors), links


# ── page assembly ───────────────────────────────────────────────────────────

def meta_cards(meta: dict, L: dict) -> str:
    entries: list[tuple[str, str]] = []
    for key in ("date", "owner", "scope", "status"):
        if meta.get(key) is not None:
            entries.append((L[key], str(meta[key])))
    extra = meta.get("meta") or {}
    if isinstance(extra, dict):
        entries.extend((str(k), str(v)) for k, v in extra.items())
    if not entries:
        return ""
    cells = []
    for label, value in entries:
        bm = re.match(r"^!(ok|bad|part|warn|info)\s+(.*)$", value, flags=re.S)
        val = f'<b class="b {bm.group(1)}">{html.escape(bm.group(2))}</b>' if bm else f"<b>{html.escape(value)}</b>"
        cells.append(f"<div><span>{html.escape(label)}</span>{val}</div>")
    return '<div class="meta">' + "".join(cells) + "</div>"


def hero(meta: dict, md: MarkdownIt, L: dict) -> str:
    parts = ['<header class="hero">']
    if meta.get("kicker"):
        parts.append(f'<p class="kicker">{md.renderInline(str(meta["kicker"]))}</p>')
    parts.append(f'<h1>{md.renderInline(str(meta.get("title", "Report")))}</h1>')
    if meta.get("subtitle"):
        parts.append(f'<p class="lead">{md.renderInline(str(meta["subtitle"]))}</p>')
    parts.append(meta_cards(meta, L))
    parts.append("</header>")
    return "\n".join(parts)


def toc_html(toc: list[tuple[str, str]], L: dict) -> str:
    if len(toc) < 2:
        return ""
    lis = "".join(f'<li><a href="#{slug}">{inner}</a></li>' for slug, inner in toc)
    return f'<div class="toc"><b>{L["toc"]}</b><ol>{lis}</ol></div>'


def footer_html(meta: dict, L: dict, pair: str | None, md: MarkdownIt) -> str:
    bits = []
    if meta.get("footer"):
        bits.append(md.renderInline(str(meta["footer"])))
    else:
        title = html.escape(str(meta.get("title", "")))
        bits.append(f"{title} · {L['generated']} {_dt.date.today().isoformat()}")
    pair = pair or meta.get("pair")
    if pair:
        href, _, label = str(pair).partition("=")
        bits.append(f'<a href="{html.escape(href.strip())}">{html.escape(label.strip() or href.strip())}</a>')
    return "<footer>" + " · ".join(bits) + "</footer>"


def edit_ui(L: dict) -> str:
    return f"""
<button class="edit-toggle" id="editToggleBtn" type="button">{L['edit']}</button>
<div class="edit-toolbar" id="editToolbar" role="toolbar">
  <span class="edit-count" id="editCount">0</span><span>{L['edits']}</span>
  <button type="button" id="btnSave">{L['save']}</button>
  <button type="button" id="btnExport">{L['export']}</button>
  <button type="button" id="btnReset">{L['reset']}</button>
  <button type="button" id="btnExit">{L['exit']}</button>
  <span class="status" id="saveStatus">{L['nodraft']}</span>
  <span class="hint">{L['hint']}</span>
</div>
<script id="report-labels" type="application/json">{json.dumps(L, ensure_ascii=False)}</script>
<script>
{EDIT_JS}
</script>"""


def build(source: pathlib.Path, out: pathlib.Path, root: pathlib.Path, lang: str | None,
          toc_on: bool, links_on: bool, pair: str | None, link_base: str | None = None,
          theme: str | None = None, refs_on: bool = True) -> dict:
    meta, body_md = split_front_matter(source.read_text(encoding="utf-8"))
    lang = (lang or str(meta.get("lang") or "en")).lower()
    L = LABELS.get(lang, LABELS["en"])
    md = make_md()

    if "title" not in meta:  # promote the first H1
        m = re.search(r"(?m)^#\s+(.+)$", body_md)
        if m:
            meta["title"] = m.group(1).strip()
            body_md = body_md.replace(m.group(0), "", 1)

    body = md.render(body_md)
    body = badges(callouts(wrap_tables(body)))
    body, toc = add_heading_ids(body)
    linked, missing, ranges, link_mode = [], [], [], "disabled"
    if links_on:
        body, linked, missing, ranges, link_mode = link_paths(body, root, out.parent, link_base)
    ref_anchors = ref_links = 0
    if refs_on:
        body, ref_anchors, ref_links = link_refs(body)

    page = f"""<!doctype html>
<html lang="{html.escape(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(str(meta.get("title", "Report")))}</title>
<style>
{CSS}{theme_css(theme)}
</style>
</head>
<body>
<main>
{hero(meta, md, L)}
{toc_html(toc, L) if toc_on else ""}
{body}
{footer_html(meta, L, pair, md)}
</main>
{edit_ui(L)}
</body>
</html>
"""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return dict(out=out, bytes=len(page.encode("utf-8")), lang=lang, toc=len(toc),
                linked=linked, missing=missing, ranges=ranges, link_mode=link_mode,
                ref_anchors=ref_anchors, ref_links=ref_links,
                unbalanced=check_balance(page))


# ── validation ──────────────────────────────────────────────────────────────

class _Balance(html.parser.HTMLParser):
    VOID = {"meta", "br", "img", "hr", "input", "link", "source", "wbr", "col"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.errors: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in self.VOID:  # `<hr />` fires start+end; the start was never pushed
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.errors.append(f"unexpected </{tag}> at line {self.getpos()[0]} (open: {self.stack[-3:]})")


def check_balance(page: str) -> list[str]:
    p = _Balance()
    p.feed(page)
    return p.errors + ([f"unclosed: {p.stack}"] if p.stack else [])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=pathlib.Path)
    ap.add_argument("-o", "--out", type=pathlib.Path, help="output .html (default: next to source)")
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path.cwd(),
                    help="directory that `path/file.ext` references are resolved against (default: cwd)")
    ap.add_argument("--lang", choices=sorted(LABELS), help="UI language (default: front matter `lang`, else en)")
    ap.add_argument("--no-toc", action="store_true")
    ap.add_argument("--no-links", action="store_true", help="do not turn `path:lines` code spans into links")
    ap.add_argument("--no-refs", action="store_true",
                    help="do not anchor register IDs (D-01, OP-44, R-50) at their definition row "
                         "and cross-link every mention")
    ap.add_argument("--pair", help="HREF=LABEL link to the other-language version, shown in the footer "
                                   "(HREF relative to the output file; overrides front matter `pair`)")
    ap.add_argument("--link-base", help="URL prefix for path links, e.g. https://gitlab.example.com/grp/repo/-/blob/develop/ "
                                        "— makes links work off this machine and #L anchors jump to the line")
    ap.add_argument("--strict", action="store_true", help="exit 1 when any MISSING or RANGE remains")
    ap.add_argument("--theme", choices=THEMES or None,
                    help="extra stylesheet layered on the default look "
                         f"(available: {', '.join(THEMES) or 'none installed'})")
    a = ap.parse_args(argv)

    out = a.out or a.source.with_suffix(".html")
    r = build(a.source, out.resolve(), a.root.resolve(), a.lang, not a.no_toc, not a.no_links, a.pair, a.link_base,
              a.theme, not a.no_refs)

    print(f"wrote {r['out']} ({r['bytes']:,} bytes, lang={r['lang']}, toc={r['toc']} sections, "
          f"theme={a.theme or 'default'})")
    print(f"links: {r['link_mode']}")
    print(f"path links: {len(r['linked'])} resolved, {len(set(r['missing']))} NOT found under {a.root.resolve()}, "
          f"{len(set(r['ranges']))} line-range problems")
    for p, n in Counter(r["missing"]).items():
        print(f"  MISSING: {p}" + (f"  (x{n})" if n > 1 else ""))
    for p, n in Counter(r["ranges"]).items():
        print(f"  RANGE:   {p}" + (f"  (x{n})" if n > 1 else ""))
    if not a.no_refs:
        print(f"id cross-refs: {r['ref_anchors']} anchored, {r['ref_links']} mentions linked")
    if r["unbalanced"]:
        print("HTML STRUCTURE ERRORS:")
        for e in r["unbalanced"]:
            print(f"  {e}")
        return 2
    print("html structure: OK")
    if a.strict and (r["missing"] or r["ranges"]):
        print("STRICT: unresolved references above — fix them before delivering")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
