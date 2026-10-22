(function () {
  var labelsEl = document.getElementById('report-labels');
  var L = labelsEl ? JSON.parse(labelsEl.textContent) : {};
  var STORAGE_KEY = 'html-report-draft:' + location.pathname;
  var SELECTOR = 'main .card, main .item > div:not(.id), main td, main th, main .callout, main .lead, main .kicker, main > ul > li, main > ol > li, main > p, main h1, main h2, main h3, main pre, main blockquote, .meta div, main footer';
  var editMode = false, dirty = false, original = {}, modified = new Set();
  var els = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
  els.forEach(function (el, i) { el.setAttribute('data-edit-id', 'e' + i); original['e' + i] = el.innerHTML; });
  var $ = function (id) { return document.getElementById(id); };

  // ── sanitizer ─────────────────────────────────────────────────────────────
  // Every route by which foreign markup can reach this page's live DOM — paste,
  // drag-and-drop, and restoring a draft from localStorage — passes through
  // here. Allow-list of tags and attributes; no event handlers, no scriptable
  // URLs. `class` is allowed everywhere so the report's own styling survives a
  // save/restore round-trip.
  var ALLOWED = {
    A: ['href', 'title'], ABBR: ['title'], B: [], BLOCKQUOTE: [], BR: [], CODE: [], DD: [], DEL: [],
    DIV: [], DL: [], DT: [], EM: [], H1: [], H2: [], H3: [], H4: [], H5: [], H6: [], HR: [], I: [],
    IMG: ['src', 'alt', 'title', 'width', 'height'], INS: [], KBD: [], LI: [], MARK: [], OL: ['start'],
    P: [], PRE: [], S: [], SMALL: [], SPAN: [], STRONG: [], SUB: [], SUP: [], TABLE: [], TBODY: [],
    TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan', 'scope'], THEAD: [], TR: [], U: [], UL: []
  };
  var DROP_WHOLE = /^(SCRIPT|STYLE|IFRAME|FRAME|OBJECT|EMBED|APPLET|LINK|META|BASE|FORM|INPUT|BUTTON|TEXTAREA|SELECT|OPTION|AUDIO|VIDEO|SOURCE|TRACK|CANVAS|SVG|MATH|TEMPLATE|NOSCRIPT|PORTAL)$/;

  function safeUrl(u, allowDataImage) {
    // strip whitespace/controls first: "java\nscript:" is a scheme too
    var v = String(u).replace(/[\u0000-\u0020\u00a0]/g, '').toLowerCase();
    if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/.test(v)) return true;
    return !/^[a-z0-9.+-]*:/.test(v) || /^(https?|mailto|tel|ftp):/.test(v);
  }

  function sanitize(htmlStr) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(htmlStr == null ? '' : htmlStr);  // inert: no script runs, no resource loads
    (function walk(node) {
      var child = node.firstChild;
      while (child) {
        var next = child.nextSibling;
        if (child.nodeType === 8) {                          // comment
          child.parentNode.removeChild(child);
        } else if (child.nodeType === 1) {
          var tag = child.tagName.toUpperCase();
          if (!Object.prototype.hasOwnProperty.call(ALLOWED, tag)) {
            if (DROP_WHOLE.test(tag)) {
              child.parentNode.removeChild(child);           // drop element AND its contents
            } else {
              var moved = child.firstChild;                  // unwrap unknown formatting, keep text
              while (child.firstChild) node.insertBefore(child.firstChild, child);
              child.parentNode.removeChild(child);
              if (moved) next = moved;                       // re-walk what we just hoisted
            }
          } else {
            var extra = ALLOWED[tag];
            Array.prototype.slice.call(child.attributes).forEach(function (at) {
              var n = at.name.toLowerCase();
              if (n === 'class') return;
              if (extra.indexOf(n) === -1) { child.removeAttribute(at.name); return; }
              if ((n === 'href' || n === 'src') && !safeUrl(at.value, n === 'src')) child.removeAttribute(at.name);
            });
            walk(child);
          }
        }
        child = next;
      }
    })(tpl.content);
    return tpl.innerHTML;
  }

  function textToHtml(t) {
    var d = document.createElement('div'); d.textContent = String(t == null ? '' : t);
    return d.innerHTML.replace(/\r?\n/g, '<br>');
  }

  function insertHtml(h) {
    try {
      if (document.execCommand && document.execCommand('insertHTML', false, h)) return;
    } catch (err) {}
    var sel = window.getSelection(); if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0); range.deleteContents();
    var tpl = document.createElement('template'); tpl.innerHTML = h;
    var last = tpl.content.lastChild;
    range.insertNode(tpl.content);
    if (last) { range.setStartAfter(last); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); }
  }

  function takeover(e, dt) {
    if (!editMode || !dt) return;
    var el = e.target && e.target.closest ? e.target.closest('[data-edit-id]') : null;
    if (!el) return;
    e.preventDefault();
    var rich = '';
    try { rich = dt.getData('text/html'); } catch (err) {}
    insertHtml(rich ? sanitize(rich) : textToHtml(dt.getData('text/plain')));
    track({ target: el });
  }

  function setStatus(t) { $('saveStatus').textContent = t; }
  function updateCount() {
    var c = $('editCount'); c.textContent = modified.size;
    c.classList.toggle('dirty', dirty && modified.size > 0);
  }
  function toggle(on) {
    editMode = (on === undefined) ? !editMode : on;
    document.body.classList.toggle('edit-mode', editMode);
    $('editToolbar').classList.toggle('active', editMode);
    var b = $('editToggleBtn'); b.classList.toggle('editing', editMode);
    b.textContent = editMode ? L.editing : L.edit;
    els.forEach(function (el) { el.contentEditable = editMode ? 'true' : 'false'; });
  }
  function track(e) {
    var el = e.target.closest ? e.target.closest('[data-edit-id]') : null; if (!el) return;
    var id = el.getAttribute('data-edit-id');
    if (el.innerHTML !== original[id]) { modified.add(id); el.setAttribute('data-modified', 'true'); dirty = true; }
    else { modified.delete(id); el.removeAttribute('data-modified'); }
    updateCount(); if (dirty && modified.size) setStatus(L.unsaved);
  }
  function collect() {
    var edits = {}; modified.forEach(function (id) {
      var el = document.querySelector('[data-edit-id="' + id + '"]'); if (el) edits[id] = sanitize(el.innerHTML); });
    return edits;
  }
  function save(silent) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ts: Date.now(), count: modified.size, edits: collect() }));
    } catch (err) {
      // quota exceeded, or storage blocked (private window, site-data policy).
      // Stay dirty so the leave-guard still fires — the edits only exist in this DOM.
      updateCount(); setStatus(L.savefail); return false;
    }
    dirty = false; updateCount();
    if (!silent) setStatus(L.saved + new Date().toLocaleTimeString());
    return true;
  }
  function restore() {
    var raw = null; try { raw = localStorage.getItem(STORAGE_KEY); } catch (err) {}
    if (!raw) return;
    var data; try { data = JSON.parse(raw); } catch (err) { return; }
    if (!data.edits || !Object.keys(data.edits).length) return;
    var q = L.restoreq.replace('{date}', new Date(data.ts).toLocaleString()).replace('{n}', data.count);
    if (!confirm(q)) return;
    Object.keys(data.edits).forEach(function (id) {
      var el = document.querySelector('[data-edit-id="' + id + '"]');
      if (el) { el.innerHTML = sanitize(data.edits[id]); modified.add(id); el.setAttribute('data-modified', 'true'); }
    });
    dirty = false; updateCount(); setStatus(L.restored + ' (' + data.count + L.edits + ')');
  }
  function reset() {
    if (!confirm(L.resetq)) return;
    modified.forEach(function (id) {
      var el = document.querySelector('[data-edit-id="' + id + '"]');
      if (el) { el.innerHTML = original[id]; el.removeAttribute('data-modified'); }
    });
    modified.clear(); dirty = false; try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
    updateCount(); setStatus(L.nodraft);
  }
  function exportHtml() {
    save(true);
    var doc = document.documentElement.cloneNode(true);
    doc.querySelector('body').classList.remove('edit-mode');
    Array.prototype.forEach.call(doc.querySelectorAll('[contenteditable]'), function (el) { el.removeAttribute('contenteditable'); });
    var tb = doc.querySelector('#editToolbar'); if (tb) tb.classList.remove('active');
    var bt = doc.querySelector('#editToggleBtn'); if (bt) { bt.classList.remove('editing'); bt.textContent = L.edit; }
    var html = '<!doctype html>\n' + doc.outerHTML;
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    var base = (location.pathname.split('/').pop() || 'report').replace(/\.html?$/i, '');
    var file = base + '-edited-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.html';
    var blob = new Blob([html], { type: 'text/html' }), url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = file; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    alert(L.exported.replace('{n}', modified.size).replace('{file}', file));
  }

  $('editToggleBtn').addEventListener('click', function () { toggle(); });
  $('btnExit').addEventListener('click', function () { toggle(false); });
  $('btnSave').addEventListener('click', function () { save(false); });
  $('btnExport').addEventListener('click', exportHtml);
  $('btnReset').addEventListener('click', reset);
  document.addEventListener('input', track);
  document.addEventListener('paste', function (e) { takeover(e, e.clipboardData); }, true);
  document.addEventListener('drop', function (e) { takeover(e, e.dataTransfer); }, true);
  window.addEventListener('beforeunload', function (e) { if (dirty && modified.size) { e.preventDefault(); e.returnValue = L.leaveq; } });
  window.addEventListener('keydown', function (e) { if (editMode && (e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(false); } });
  restore();
})();
