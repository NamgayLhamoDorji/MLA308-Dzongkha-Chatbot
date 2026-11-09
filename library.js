/* My Documents, Saved Summaries and Chat History: searchable lists of the user's own saved work. */
(() => {
  const { el, icon, btn, api, toast, confirmDialog, go, fmtDate, ext } = DZ;
  const norm = (s) => (s || '').toLowerCase();
  const head = (title, sub, ...actions) => {
    const h = el('div', 'page-head'), g = el('div', 'grow'); g.append(el('h2', null, title), el('p', null, sub)); h.append(g, ...actions); return h;
  };
  const searchBox = (ph, onInput) => {
    const w = el('label', 'search'), i = el('input', 'input'); i.type = 'search'; i.placeholder = ph; i.setAttribute('aria-label', ph);
    w.append(icon('search'), i); i.oninput = () => onInput(i.value); return w;
  };
  const segment = (items, value, onPick, label) => {
    const s = el('div', 'seg'); s.setAttribute('role', 'group'); s.setAttribute('aria-label', label);
    items.forEach(([k, l]) => { const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', k === value); b.onclick = () => { s.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); onPick(k); }; s.append(b); });
    return s;
  };

  /* ============ My Documents ============ */
  DZ.register('documents', {
    title: 'My Documents', nav: 'documents',
    async render(root) {
      const page = el('div', 'page'); root.append(page);
      page.append(head('My Documents', 'Every file you have uploaded.', btn('primary', 'Upload document', 'upload', () => go('#/summarizer'))));
      let docs = [], q = '', status = 'all', type = 'all';
      const tb = el('div', 'toolbar'), host = el('div');
      tb.append(searchBox('Search documents', (v) => { q = norm(v); draw(); }),
        segment([['all', 'All'], ['yes', 'Summarized'], ['no', 'Not summarized']], 'all', (v) => { status = v; draw(); }, 'Filter by summary status'));
      const ts = el('select', 'select'); ts.setAttribute('aria-label', 'Filter by file type');
      [['all', 'All types'], ['PDF', 'PDF'], ['DOCX', 'Word'], ['TXT', 'TXT'], ['MD', 'Markdown']].forEach(([v, l]) => ts.append(new Option(l, v)));
      ts.onchange = () => { type = ts.value; draw(); }; tb.append(ts);
      page.append(tb, host);

      function draw() {
        host.textContent = '';
        const list = docs.filter((d) => (!q || norm(d.name).includes(q)) && (status === 'all' || (status === 'yes') === d.summaries > 0) && (type === 'all' || ext(d.name) === type));
        if (!docs.length) { host.append(DZ.empty('folder', 'No documents yet', 'Upload a PDF, Word or text file to get started.', btn('primary', 'Upload document', 'upload', () => go('#/summarizer')))); return; }
        if (!list.length) { host.append(DZ.empty('search', 'No matching documents', 'Try another search or clear the filters.')); return; }
        const card = el('div', 'card table-card'), t = el('table', 'tbl');
        const th = el('thead'), hr = el('tr'); ['Name', 'Type', 'Uploaded', 'Summary', ''].forEach((h) => hr.append(el('th', null, h))); th.append(hr);
        const tbd = el('tbody');
        list.forEach((d) => {
          const tr = el('tr'), n = el('td'), nm = el('div', 'nm'), ic = el('div', 'r-ic'); ic.append(icon('doc'));
          const tx = el('div'); const b = el('b', null, d.name); b.title = d.name;
          tx.append(b, el('small', null, (d.pages > 1 ? d.pages + ' pages · ' : '') + d.words.toLocaleString() + ' words')); nm.append(ic, tx); n.append(nm);
          const ty = el('td'); ty.append(el('span', 'badge', ext(d.name)));
          const up = el('td', null, fmtDate(d.created)), st = el('td'); st.append(DZ.docBadge(d));
          const ac = el('td'), a = el('div', 'acts-cell');
          const ready = d.status === 'ready';
          const v = btn('sm', 'View document', 'eye', () => go('#/summarizer/' + d.id)); v.disabled = d.status === 'error' && false;
          const s = btn('sm', 'View summary', 'list', () => go('#/summarizer/' + d.id)); s.disabled = !d.summaries;
          const x = btn('sm danger', '', 'trash', async () => {
            if (!(await confirmDialog('Delete document', 'Delete "' + d.name + '"? Saved summaries are kept.'))) return;
            try { await api('/api/docs/' + d.id, { method: 'DELETE' }); docs = docs.filter((z) => z.id !== d.id); toast('Document deleted', 'ok'); draw(); } catch (e) { toast(e.message, 'error'); }
          }); x.title = 'Delete document'; x.setAttribute('aria-label', 'Delete ' + d.name);
          a.append(v, s, x); ac.append(a); tr.append(n, ty, up, st, ac); tbd.append(tr);
        });
        t.append(th, tbd); card.append(t); host.append(card);
      }
      try { docs = await api('/api/docs'); draw(); } catch (e) { host.append(DZ.empty('help', 'Could not load documents', e.message)); }
    },
  });

  /* ============ Saved Summaries ============ */
  DZ.register('summaries', {
    title: 'Saved Summaries', nav: 'summaries',
    async render(root) {
      const page = el('div', 'page'); root.append(page);
      page.append(head('Saved Summaries', 'Summaries you saved from the document summarizer.'));
      let items = [], q = '';
      const tb = el('div', 'toolbar'), host = el('div'); tb.append(searchBox('Search saved summaries', (v) => { q = norm(v); draw(); })); page.append(tb, host);
      const text = (s, lang) => (lang === 'en' && s.en ? s.en : s.text);

      function view(s) {
        let lang = DZ.pref('lang');
        const body = el('div'), draw2 = () => { body.textContent = ''; body.append(DZ.renderSummary({ text: s.text, en: s.en }, lang, s.fmt)); };
        const seg = segment([['dz', 'Dzongkha'], ['en', 'English']], lang, (k) => { lang = k; draw2(); }, 'Summary language'); seg.style.marginBottom = '12px';
        const wrap = el('div'); wrap.append(seg, body); draw2();
        const copy = btn('', 'Copy', 'copy', (e) => DZ.copyText(text(s, lang), e.currentTarget)), dl = btn('', 'Download', 'download', () => DZ.download(s.doc_name + ' summary', text(s, lang)));
        DZ.openModal(s.doc_name, wrap, [copy, dl]);
      }

      function draw() {
        host.textContent = '';
        if (!items.length) { host.append(DZ.empty('bookmark', 'No saved summaries yet', 'Generate a summary, then choose Save summary to keep it here.', btn('primary', 'Summarize a document', 'doc', () => go('#/summarizer')))); return; }
        const list = items.filter((s) => !q || norm(s.doc_name).includes(q) || norm(s.text).includes(q) || norm(s.en).includes(q));
        if (!list.length) { host.append(DZ.empty('search', 'No matching summaries', 'Try a different search.')); return; }
        const grid = el('div', 'cards');
        list.forEach((s) => {
          const c = el('article', 'card scard'), top = el('div', 's-top');
          const h = el('h3', null, s.doc_name); h.title = s.doc_name; top.append(h, el('span', 'badge', DZ.FMT[s.fmt] || 'Summary'));
          const ex = el('div', 'excerpt' + (DZ.TIB.test(s.text) ? ' dz' : ''), s.text.replace(/\n+/g, ' '));
          const f = el('div', 's-foot'); f.append(el('span', 'date', fmtDate(s.created)));
          f.append(btn('sm', 'Read', 'eye', () => view(s)));
          const o = btn('sm', 'Original', 'doc', () => go('#/summarizer/' + s.doc_id));
          if (s.chat_id == null) { o.disabled = true; o.title = 'The original document was deleted'; } f.append(o);
          f.append(btn('sm', '', 'copy', (e) => DZ.copyText(text(s, DZ.pref('lang')), e.currentTarget)), btn('sm', '', 'download', () => DZ.download(s.doc_name + ' summary', text(s, DZ.pref('lang')))));
          const del = btn('sm danger', '', 'trash', async () => {
            if (!(await confirmDialog('Delete saved summary', 'Remove this saved summary? The document is not affected.'))) return;
            try { await api('/api/summaries/' + s.id, { method: 'DELETE' }); items = items.filter((z) => z.id !== s.id); toast('Saved summary deleted', 'ok'); draw(); } catch (e) { toast(e.message, 'error'); }
          });
          [...f.querySelectorAll('button')].slice(3, 5).forEach((b, i) => { b.title = i ? 'Download' : 'Copy'; b.setAttribute('aria-label', i ? 'Download summary' : 'Copy summary'); });
          del.title = 'Delete'; del.setAttribute('aria-label', 'Delete saved summary'); f.append(del);
          c.append(top, ex, f); grid.append(c);
        });
        host.append(grid);
      }
      try { items = await api('/api/summaries'); draw(); } catch (e) { host.append(DZ.empty('help', 'Could not load saved summaries', e.message)); }
    },
  });

  /* ============ Chat History ============ */
  DZ.register('history', {
    title: 'Chat History', nav: 'history',
    async render(root) {
      const page = el('div', 'page'); root.append(page);
      page.append(head('Chat History', 'Your earlier conversations.', btn('primary', 'New conversation', 'plus', () => go('#/chat'))));
      let chats = [], q = '';
      const tb = el('div', 'toolbar'), host = el('div'); tb.append(searchBox('Search conversations', (v) => { q = norm(v); draw(); })); page.append(tb, host);
      function draw() {
        host.textContent = '';
        if (!chats.length) { host.append(DZ.empty('chat', 'No conversations yet', 'Start a conversation and it will be saved here.', btn('primary', 'Start chatting', 'chat', () => go('#/chat')))); return; }
        const list = chats.filter((c) => !q || norm(c.title).includes(q));
        if (!list.length) { host.append(DZ.empty('search', 'No matching conversations', 'Try a different search.')); return; }
        const card = el('div', 'card list');
        list.forEach((c) => {
          const r = el('div', 'row-item'), i = el('div', 'r-ic'); i.append(icon(c.docs ? 'doc' : 'chat'));
          const m = el('div', 'r-main'); m.append(el('div', 'r-title', c.title), el('div', 'r-sub', fmtDate(c.updated) + (c.docs ? ' · ' + c.docs + (c.docs > 1 ? ' files' : ' file') : '')));
          const del = btn('sm danger', '', 'trash', async () => {
            if (!(await confirmDialog('Delete conversation', 'This deletes the conversation and any files attached to it.'))) return;
            try { await api('/api/chats/' + c.id, { method: 'DELETE' }); chats = chats.filter((z) => z.id !== c.id); toast('Conversation deleted', 'ok'); draw(); } catch (e) { toast(e.message, 'error'); }
          }); del.title = 'Delete conversation'; del.setAttribute('aria-label', 'Delete conversation');
          r.append(i, m, btn('sm', 'Open', null, () => go('#/chat/' + c.id)), del); card.append(r);
        });
        host.append(card);
      }
      try { chats = await api('/api/chats'); draw(); } catch (e) { host.append(DZ.empty('help', 'Could not load conversations', e.message)); }
    },
  });
})();
