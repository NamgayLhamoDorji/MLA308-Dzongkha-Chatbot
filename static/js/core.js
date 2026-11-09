/* Shared helpers for every page: DOM, API, toasts, dialogs, settings, small formatting tools.
   All other scripts hang their pieces on the single global `DZ`. */
const DZ = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const TIB = /[ༀ-࿿]/;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* ---------- icons (one consistent line style) ---------- */
  const PATHS = {
    home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
    chat: 'M4 5h16v11H9l-5 4z',
    doc: 'M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h5',
    folder: 'M3 6h6l2 2h10v11H3z',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
    gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.4-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.2-.8.2-1.2z',
    help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17h.01',
    menu: 'M4 6h16M4 12h16M4 18h16',
    plus: 'M12 5v14M5 12h14',
    send: 'M12 19V6M6 11l6-6 6 6',
    copy: 'M8 8h11v12H8zM5 16V4h11',
    download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
    sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
    moon: 'M20 14A8 8 0 019.5 4 8 8 0 1020 14z',
    upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
    search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
    check: 'M5 12l5 5 9-10',
    x: 'M6 6l12 12M18 6L6 18',
    chevron: 'M15 6l-6 6 6 6',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
    clip: 'M16.5 9.5l-6.4 6.4a4 4 0 01-5.7-5.7l7-7a2.7 2.7 0 013.8 3.8l-7 7a1.3 1.3 0 01-1.9-1.9l6.3-6.3',
    sparkle: 'M12 3l2 5.5L19.5 10 14 12l-2 5.5L10 12l-5.5-2L10 8.5zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    out: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
    translate: 'M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M12 5c-1 4-4 7-8 9M13 20l4-9 4 9M14.5 17h5',
  };
  function icon(name, size) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
    if (size) { s.style.width = s.style.height = size + 'px'; }
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', PATHS[name] || PATHS.doc); s.append(p);
    return s;
  }
  function btn(cls, label, ic, onclick) {
    const b = el('button', 'btn ' + cls); b.type = 'button';
    if (ic) b.append(icon(ic)); if (label) b.append(document.createTextNode(label));
    if (onclick) b.onclick = onclick; return b;
  }

  /* ---------- API ---------- */
  async function api(path, opt = {}) {
    const o = { credentials: 'same-origin', headers: {} };
    if (opt.json !== undefined) { o.method = opt.method || 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.json); }
    else if (opt.body) { o.method = 'POST'; o.body = opt.body; }
    else if (opt.method) o.method = opt.method;
    const r = await fetch(path, o);
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && !opt.quiet) { DZ.onSignedOut && DZ.onSignedOut(); throw new Error('Please sign in.'); }
    if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong.');
    return data;
  }

  /* ---------- toasts and dialogs ---------- */
  function toast(msg, kind) {
    const t = el('div', 'toast ' + (kind || ''), msg); $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 6500 : 3200);
  }
  function openModal(title, body, footer, cls) {
    const back = el('div', 'modal-back'), m = el('div', 'modal ' + (cls || '')); m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    const h = el('header'); h.append(el('h3', null, title));
    const x = el('button', 'icon-btn'); x.setAttribute('aria-label', 'Close'); x.append(icon('x')); h.append(x);
    const b = el('div', 'mbody'); b.append(body); m.append(h, b);
    const f = footer ? el('footer') : null; if (f) { f.append(...footer); m.append(f); }
    back.append(m);
    const prev = document.activeElement;
    const close = () => { back.remove(); document.removeEventListener('keydown', key); prev && prev.focus && prev.focus(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    x.onclick = close; back.onmousedown = (e) => { if (e.target === back) close(); }; document.addEventListener('keydown', key);
    document.body.append(back); (m.querySelector('[autofocus]') || x).focus();
    return { close, body: b, modal: m };
  }
  function confirmDialog(title, message, okLabel) {
    return new Promise((resolve) => {
      const body = el('p', null, message); body.style.margin = 0;
      let done = false;
      const ok = btn('primary danger-solid', okLabel || 'Delete'), no = btn('', 'Cancel');
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const md = openModal(title, body, [no, ok], 'small');
      ok.style.background = 'var(--danger)'; ok.style.borderColor = 'var(--danger)';
      ok.onclick = () => { finish(true); md.close(); }; no.onclick = () => { finish(false); md.close(); };
      md.modal.querySelector('.icon-btn').addEventListener('click', () => finish(false));
      new MutationObserver(() => { if (!document.body.contains(md.modal)) finish(false); }).observe(document.body, { childList: true });
      no.focus();
    });
  }

  /* ---------- settings kept in this browser ---------- */
  const DEFAULTS = { theme: 'system', zoom: 1.15, fmt: 'detailed', lang: 'dz', understood: '1' };
  function pref(k) { try { const v = localStorage.getItem('dz.' + k); return v == null ? DEFAULTS[k] : v; } catch { return DEFAULTS[k]; } }
  function setPref(k, v) { try { localStorage.setItem('dz.' + k, String(v)); } catch {} }
  function applyTheme() {
    const t = pref('theme'), r = document.documentElement;
    if (t === 'light' || t === 'dark') r.dataset.theme = t; else delete r.dataset.theme;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const b = $('#theme-btn'); if (b) { b.textContent = ''; b.append(icon(dark ? 'sun' : 'moon')); }
  }
  function applyZoom() { document.documentElement.style.setProperty('--zoom', Math.min(1.8, Math.max(0.9, parseFloat(pref('zoom')) || 1.15))); }

  /* ---------- text tools ---------- */
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000), now = new Date();
    let h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0'); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    const time = h + ':' + m + ' ' + ap;
    const sameDay = d.toDateString() === now.toDateString();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay) return 'Today, ' + time;
    if (d.toDateString() === y.toDateString()) return 'Yesterday, ' + time;
    return d.getDate() + ' ' + MON[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '') + ', ' + time;
  }
  const ext = (name) => { const m = /\.([A-Za-z0-9]+)$/.exec(name || ''); return m ? m[1].toUpperCase() : 'FILE'; };
  const FMT = { brief: 'Brief', detailed: 'Detailed', bullets: 'Bullet points', points: 'Key points', auto: 'Summary' };
  const pick = (m, lang) => (lang === 'en' && m.en ? m.en : m.text) || '';

  /* A summary as readable blocks: paragraphs, or a diamond-bulleted list for bullet formats. */
  function renderSummary(m, lang, fmt) {
    const txt = pick(m, lang), isDz = lang !== 'en' && TIB.test(txt);
    const box = el('div', 'prose' + (isDz ? ' dz' : ''));
    const lines = txt.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (fmt === 'bullets' || fmt === 'points') {
      const ul = el('ul'); lines.forEach((l) => ul.append(el('li', null, l))); box.append(ul);
    } else lines.forEach((l) => box.append(el('p', null, l)));
    return box;
  }
  async function copyText(text, button) {
    try { await navigator.clipboard.writeText(text); toast('Copied to the clipboard', 'ok'); if (button) flash(button, 'Copied'); }
    catch { toast('Copying is blocked in this browser. Select the text and copy it by hand.', 'error'); }
  }
  function flash(button, label) {
    const keep = [...button.childNodes]; button.textContent = label;
    setTimeout(() => { button.textContent = ''; button.append(...keep); }, 1200);
  }
  function download(name, text) {
    const safe = (name || 'summary').replace(/\.[A-Za-z0-9]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    const a = el('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' })); a.download = safe + '.txt';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  /* Upload with a real progress bar (fetch cannot report upload progress). */
  function upload(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest(), fd = new FormData(); fd.append('file', file);
      x.open('POST', url); x.withCredentials = true;
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let d = {}; try { d = JSON.parse(x.responseText); } catch {}
        if (x.status === 401) { DZ.onSignedOut && DZ.onSignedOut(); reject(new Error('Please sign in.')); }
        else if (x.status >= 200 && x.status < 300) resolve(d); else reject(new Error(typeof d.detail === 'string' ? d.detail : 'The upload failed.'));
      };
      x.onerror = () => reject(new Error('The upload failed. Check that the server is running.'));
      x.send(fd);
    });
  }
  const ACCEPT = '.pdf,.docx,.txt,.md';
  const SUPPORTED = /\.(pdf|docx|txt|md)$/i;

  function empty(iconName, title, text, action) {
    const e = el('div', 'empty'); const ic = el('div', 'em-ic'); ic.append(icon(iconName)); e.append(ic, el('h3', null, title), el('p', null, text));
    if (action) e.append(action); return e;
  }
  function docBadge(d) {
    if (d.status === 'error') return el('span', 'badge bad', 'Failed');
    if (d.status !== 'ready') { const b = el('span', 'badge busy'); b.append(el('i', 'spin'), document.createTextNode(' Processing')); return b; }
    return d.summaries ? el('span', 'badge ok', 'Summarized' + (d.summaries > 1 ? ' (' + d.summaries + ')' : '')) : el('span', 'badge', 'Not summarized');
  }

  /* ---------- tiny router: #/page/arg/arg ---------- */
  const pages = {}; let current = null;
  function register(name, page) { pages[name] = page; }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function route() {
    if (!DZ.user) return;
    const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    const name = pages[parts[0]] ? parts[0] : 'dashboard', page = pages[name], params = parts.slice(1);
    if (current && current.destroy) { try { current.destroy(); } catch {} }
    current = page;
    const view = $('#view'); view.textContent = ''; view.scrollTop = 0;
    $('#page-title').textContent = page.title; document.title = page.title + ' | Dzongkha AI';
    document.body.classList.remove('nav');
    document.querySelectorAll('#nav .nav-item').forEach((a) => a.classList.toggle('active', a.dataset.page === (page.nav || name)));
    try { page.render(view, params); } catch (e) { console.error(e); view.append(empty('help', 'This page could not load', e.message || String(e))); }
  }
  addEventListener('hashchange', route);

  return { $, el, icon, btn, TIB, api, toast, openModal, confirmDialog, pref, setPref, applyTheme, applyZoom, fmtDate, ext, FMT, pick, renderSummary,
           copyText, download, upload, ACCEPT, SUPPORTED, empty, docBadge, register, go, route, user: null, onSignedOut: null };
})();
