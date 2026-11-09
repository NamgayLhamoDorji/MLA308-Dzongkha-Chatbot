/* Document summarizer: upload, original text next to the Dzongkha summary, formats, save, ask questions.
   Every action here uses the existing API (upload, messages) plus the document endpoints. */
(() => {
  const { el, icon, btn, api, toast, confirmDialog, go, pref, setPref, fmtDate, ext } = DZ;
  let S = null;
  const stop = () => { if (S) { clearTimeout(S.timer); S.dead = true; } };
  const FORMATS = [['brief', 'Brief'], ['detailed', 'Detailed'], ['bullets', 'Bullet points'], ['points', 'Key points']];

  DZ.register('summarizer', {
    title: 'Document Summarizer', nav: 'summarizer', destroy: stop,
    render(root, params) { stop(); S = { dead: false, timer: null }; const page = el('div', 'page'); root.append(page); params[0] ? docView(page, Number(params[0])) : landing(page); },
  });

  /* ============ no document yet: the upload area ============ */
  async function landing(page) {
    const head = el('div', 'page-head'); const g = el('div', 'grow');
    g.append(el('h2', null, 'Dzongkha Document Summarizer'), el('p', null, 'Upload a document and read its summary in Dzongkha.')); head.append(g); page.append(head);

    const drop = el('div', 'drop'), ic = el('div', 'big-ic'); ic.append(icon('upload'));
    const file = el('input'); file.type = 'file'; file.accept = DZ.ACCEPT; file.hidden = true;
    const up = btn('primary', 'Upload document', 'upload', () => file.click());
    const fm = el('div', 'fmts'); ['PDF', 'Word (.docx)', 'TXT', 'Markdown (.md)'].forEach((f) => fm.append(el('span', 'badge', f)));
    const box = el('div', 'upl'); box.hidden = true;
    drop.append(ic, el('h3', null, 'Drag a document here'), el('p', null, 'or choose a file from your computer. Files up to 25 MB. Scanned PDFs without selectable text cannot be read.'), up, fm, box, file);
    page.append(drop);

    async function start(f) {
      if (!f) return;
      if (!DZ.SUPPORTED.test(f.name)) { toast('Only PDF, Word (.docx), TXT and MD files are supported.', 'error'); return; }
      up.disabled = true; box.hidden = false; box.textContent = '';
      const top = el('div', 'u-top'), pct = el('span', 'muted', '0%'); top.append(el('span', null, f.name), pct);
      const bar = el('div', 'bar'), fill = el('i'); bar.append(fill);
      box.append(top, bar, el('div', 'muted', ext(f.name) + ' · ' + (f.size / 1048576 >= 1 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB')));
      try {
        const c = await api('/api/chats', { method: 'POST', json: {} });
        const r = await DZ.upload('/api/chats/' + c.id + '/upload', f, (p) => { fill.style.width = Math.round(p * 100) + '%'; pct.textContent = Math.round(p * 100) + '%'; if (p >= 1) { bar.classList.add('indet'); fill.style.width = ''; pct.textContent = 'Reading the file...'; } });
        if (!S.dead) go('#/summarizer/' + r.id);
      } catch (e) { toast(e.message, 'error'); box.hidden = true; up.disabled = false; }
    }
    file.onchange = (e) => { start(e.target.files[0]); e.target.value = ''; };
    let depth = 0;
    drop.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('over'); });
    drop.addEventListener('dragover', (e) => e.preventDefault());
    drop.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; drop.classList.remove('over'); start(e.dataTransfer.files[0]); });

    try {
      const docs = (await api('/api/docs')).slice(0, 4);
      if (S.dead || !docs.length) return;
      const sec = el('section', 'recent-docs'); sec.append(el('h3', null, 'Recent documents'));
      const card = el('div', 'card list');
      docs.forEach((d) => {
        const r = el('div', 'row-item'), i = el('div', 'r-ic'); i.append(icon('doc'));
        const m = el('div', 'r-main'); m.append(el('div', 'r-title', d.name), el('div', 'r-sub', ext(d.name) + ' · ' + fmtDate(d.created)));
        r.append(i, m, DZ.docBadge(d), btn('sm', 'Open', null, () => go('#/summarizer/' + d.id))); card.append(r);
      });
      sec.append(card); page.append(sec);
    } catch {}
  }

  /* ============ one document ============ */
  async function docView(page, docId) {
    const s = S; Object.assign(s, { doc: null, chat: null, saved: new Map(), fmt: pref('fmt'), lang: pref('lang'), para: 0, pick: null });
    if (!FORMATS.some((f) => f[0] === s.fmt)) s.fmt = 'detailed';
    page.append(el('div', 'empty', 'Loading document...'));
    try { s.doc = await api('/api/docs/' + docId); } catch (e) { page.textContent = ''; page.append(DZ.empty('doc', 'Document not found', 'It may have been deleted.', btn('primary', 'Upload a document', 'upload', () => go('#/summarizer')))); return; }
    if (s.dead) return;
    try { (await api('/api/summaries')).forEach((x) => s.saved.set(x.message_id, x.id)); } catch {}
    page.textContent = '';
    const d = s.doc;

    /* header */
    const head = el('div', 'doc-head'), di = el('div', 'd-ic'); di.append(icon('doc'));
    const dm = el('div', 'd-main'), meta = el('div', 'meta');
    dm.append(el('h2', null, d.name), meta);
    const ha = el('div'); ha.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    ha.append(btn('', 'New document', 'upload', () => go('#/summarizer')), btn('', 'Open in chat', 'chat', () => go('#/chat/' + d.chat_id)),
      btn('danger', 'Delete', 'trash', async () => {
        if (!(await confirmDialog('Delete document', 'The file and its text are removed. Saved summaries are kept.'))) return;
        try { await api('/api/docs/' + d.id, { method: 'DELETE' }); toast('Document deleted', 'ok'); go('#/documents'); } catch (e) { toast(e.message, 'error'); }
      }));
    head.append(di, dm, ha); page.append(head);

    const proc = el('div', 'card proc'); proc.hidden = true; page.append(proc);

    /* panes */
    const mtabs = el('div', 'seg tabs-m');
    const panes = el('div', 'panes'); panes.dataset.tab = 'sum';
    [['orig', 'Original'], ['sum', 'Summary']].forEach(([k, l]) => { const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', k === 'sum'); b.onclick = () => { panes.dataset.tab = k; mtabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); }; mtabs.append(b); });

    const orig = el('section', 'card pane orig'), oh = el('header');
    oh.append(el('h3', null, 'Original document'), el('span', 'badge', ext(d.name)));
    const ob = el('div', 'p-body' + (DZ.TIB.test(d.text.slice(0, 600)) ? ' dz' : '')); ob.textContent = d.text; ob.tabIndex = 0; ob.setAttribute('aria-label', 'Text of ' + d.name);
    orig.append(oh, ob);
    if (d.truncated) orig.append(el('div', 'sum-meta', 'Only the first part is shown here. The whole document is used for summaries and answers.'));

    const sp = el('section', 'card pane sumpane'), sh = el('header'); sh.append(el('h3', null, 'Summary'));
    const lang = el('div', 'seg'); lang.setAttribute('role', 'group'); lang.setAttribute('aria-label', 'Summary language');
    [['dz', 'Dzongkha'], ['en', 'English']].forEach(([k, l]) => { const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', k === s.lang); b.onclick = () => { s.lang = k; setPref('lang', k); lang.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawSummary(); }; lang.append(b); });
    sh.append(lang);

    const ctl = el('div', 'controls'), r1 = el('div', 'c-row'), r2 = el('div', 'c-row');
    const fseg = el('div', 'seg'); fseg.setAttribute('role', 'group'); fseg.setAttribute('aria-label', 'Summary format');
    FORMATS.forEach(([k, l]) => { const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', k === s.fmt); b.onclick = () => { s.fmt = k; setPref('fmt', k); fseg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); plabel.hidden = k !== 'detailed'; }; fseg.append(b); });
    r1.append(fseg);
    const plabel = el('label'), psel = el('select', 'select'); plabel.append('Paragraphs'); psel.setAttribute('aria-label', 'Number of paragraphs');
    psel.append(new Option('Automatic', 0)); for (let i = 1; i <= 6; i++) psel.append(new Option(String(i), i));
    psel.onchange = () => { s.para = Number(psel.value); }; plabel.append(psel); plabel.hidden = s.fmt !== 'detailed';
    const gen = btn('primary', 'Generate summary', 'sparkle'); r2.append(plabel, gen); ctl.append(r1, r2);

    const out = el('div', 'sum-out'), smeta = el('div', 'sum-meta'), sact = el('div', 'sum-actions');
    sp.append(sh, ctl, out, smeta, sact);
    panes.append(orig, sp); page.append(mtabs, panes);

    /* questions about the document */
    const qa = el('section', 'card qa'), qh = el('header'); qh.append(el('h3', null, 'Ask about this document'), el('p', null, 'Ask in Dzongkha or English. Answers come back in Dzongkha.'));
    const thread = el('div', 'qa-thread'), qf = el('div', 'qa-form'), qi = el('textarea'); qi.rows = 1; qi.placeholder = 'Ask a question about this document'; qi.setAttribute('aria-label', 'Question about the document');
    const ask = btn('primary', 'Ask', 'send'); qf.append(qi, ask); qa.append(qh, thread, qf); page.append(qa);

    /* ----- drawing ----- */
    const summaries = () => (s.chat ? s.chat.messages : []).filter((m) => m.role === 'assistant' && m.fmt && m.doc_id === d.id);
    const docNow = () => (s.chat ? s.chat.docs.find((x) => x.id === d.id) : null) || d;

    function drawHead() {
      const x = docNow(); meta.textContent = '';
      meta.append(el('span', 'badge', ext(d.name)));
      if (d.pages > 1) meta.append(el('span', null, d.pages + ' pages'));
      meta.append(el('span', null, d.words.toLocaleString() + ' words'), el('span', null, 'Uploaded ' + fmtDate(d.created)));
      if (d.empty_pages) { const w = el('span', 'badge bad', d.empty_pages + ' page' + (d.empty_pages > 1 ? 's' : '') + ' without text'); meta.append(w); }
      const ready = x.status === 'ready';
      proc.hidden = ready;
      if (!ready) {
        proc.textContent = '';
        if (x.status === 'error') { proc.append(el('b', null, 'This file could not be processed'), el('span', 'muted', x.error)); }
        else { const t = el('div'); t.style.cssText = 'display:flex;gap:10px;align-items:center'; t.append(el('i', 'spin'), el('b', null, 'Preparing the document'), el('span', 'muted', x.progress || 'Reading...')); const b = el('div', 'bar indet'); b.append(el('i')); proc.append(t, b); }
      }
      const busy = summaries().some((m) => m.status === 'pending');
      gen.disabled = !ready || busy; ask.disabled = !ready;
    }

    function drawSummary() {
      const list = summaries();
      out.textContent = ''; smeta.textContent = ''; sact.textContent = '';
      if (!list.length) {
        const x = docNow();
        out.append(DZ.empty('sparkle', 'No summary yet', x.status === 'ready' ? 'Choose a format, then select Generate summary.' : 'The summary tools unlock when the document is ready.'));
        return;
      }
      let idx = s.pick != null ? list.findIndex((m) => m.id === s.pick) : -1; if (idx < 0) idx = list.length - 1;
      const m = list[idx]; s.pick = m.id;
      if (list.length > 1) {
        const sel = el('select', 'select'); sel.setAttribute('aria-label', 'Choose a summary version'); sel.style.cssText = 'margin:12px 16px 0;align-self:flex-start';
        list.forEach((v, i) => sel.append(new Option((i + 1) + '. ' + (DZ.FMT[v.fmt] || 'Summary') + ' · ' + fmtDate(v.created), v.id)));
        sel.value = m.id; sel.onchange = () => { s.pick = Number(sel.value); drawSummary(); }; sp.insertBefore(sel, out); s.sel && s.sel.remove(); s.sel = sel;
      } else if (s.sel) { s.sel.remove(); s.sel = null; }
      if (m.status === 'pending') {
        const p = el('div', 'pending'), dd = el('span', 'dots'); dd.append(el('i'), el('i'), el('i')); p.append(dd, el('span', null, (m.progress || 'Working') + '...')); out.append(p); return;
      }
      if (m.status === 'error') {
        out.append(el('p', 'err', m.text)); sact.append(btn('', 'Try again', 'refresh', () => regen(m))); return;
      }
      out.append(DZ.renderSummary(m, s.lang, m.fmt));
      smeta.append(el('span', 'badge', DZ.FMT[m.fmt] || 'Summary'), el('span', null, fmtDate(m.created)));
      const text = DZ.pick(m, s.lang);
      sact.append(btn('sm', 'Copy', 'copy', (e) => DZ.copyText(text, e.currentTarget)), btn('sm', 'Download', 'download', () => DZ.download(d.name + ' summary', text)), btn('sm', 'Regenerate', 'refresh', () => regen(m)));
      const saved = s.saved.has(m.id);
      const sv = btn('sm' + (saved ? ' gold' : ''), saved ? 'Saved' : 'Save summary', saved ? 'check' : 'bookmark', async () => {
        sv.disabled = true;
        try {
          if (s.saved.has(m.id)) { await api('/api/summaries/' + s.saved.get(m.id), { method: 'DELETE' }); s.saved.delete(m.id); toast('Removed from saved summaries', 'ok'); }
          else { const r = await api('/api/summaries', { json: { message_id: m.id } }); s.saved.set(m.id, r.id); toast('Summary saved', 'ok'); }
        } catch (e) { toast(e.message, 'error'); }
        drawSummary();
      });
      sact.append(sv);
    }

    function drawThread() {
      const msgs = s.chat ? s.chat.messages : [], items = [];
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i], nx = msgs[i + 1];
        if (m.role === 'user' && nx && nx.role === 'assistant' && nx.fmt) { i++; continue; }
        items.push(m);
      }
      const sig = JSON.stringify(items.map((m) => [m.id, m.status, m.progress, m.text, s.lang]));
      if (thread.dataset.sig === sig) return; thread.dataset.sig = sig;
      const down = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
      thread.textContent = ''; thread.hidden = !items.length;
      for (const m of items) {
        const n = el('div', 'msg ' + m.role + (m.status === 'error' ? ' error' : '')); const body = el('div', 'body');
        if (m.role === 'assistant') { const a = el('div', 'av', 'DA'); a.setAttribute('aria-hidden', 'true'); n.append(a); }
        if (m.status === 'pending') { const p = el('div', 'pending'), dd = el('span', 'dots'); dd.append(el('i'), el('i'), el('i')); p.append(dd, el('span', null, (m.progress || 'Thinking') + '...')); body.append(p); }
        else {
          body.append(el('div', 'text' + (m.role === 'assistant' && DZ.TIB.test(m.text) ? ' dz' : ''), m.text));
          if (m.role === 'assistant' && m.status === 'done') { const a = el('div', 'acts'), c = el('button'); c.type = 'button'; c.append(icon('copy'), document.createTextNode('Copy')); c.onclick = () => DZ.copyText(m.text, c); a.append(c); body.append(a); }
        }
        n.append(body); thread.append(n);
      }
      if (down || items.length) thread.scrollTop = thread.scrollHeight;
    }

    /* ----- data ----- */
    async function load() {
      if (s.dead) return;
      s.chat = await api('/api/chats/' + d.chat_id); if (s.dead) return;
      drawHead(); drawSummary(); drawThread();
      const x = docNow(), busy = s.chat.messages.some((m) => m.status === 'pending') || x.status === 'queued' || x.status === 'processing';
      clearTimeout(s.timer); if (busy) s.timer = setTimeout(() => load().catch(() => {}), 1500);
    }
    async function regen(m) {
      try { await api('/api/messages/' + m.id + '/regenerate', { method: 'POST', json: {} }); s.pick = m.id; await load(); } catch (e) { toast(e.message, 'error'); }
    }
    gen.onclick = async () => {
      gen.disabled = true;
      try {
        const r = await api('/api/chats/' + d.chat_id + '/messages', { json: { text: '', action: 'summarize', format: s.fmt, paragraphs: s.fmt === 'detailed' ? s.para : 0, doc_id: d.id } });
        s.pick = r.id; panes.dataset.tab = 'sum'; mtabs.querySelectorAll('button').forEach((x, i) => x.setAttribute('aria-pressed', i === 1)); await load();
      } catch (e) { toast(e.message, 'error'); gen.disabled = false; }
    };
    const doAsk = async () => {
      const text = qi.value.trim(); if (!text) return; ask.disabled = true;
      try { qi.value = ''; qi.style.height = ''; await api('/api/chats/' + d.chat_id + '/messages', { json: { text, action: 'chat', doc_id: d.id } }); await load(); } catch (e) { toast(e.message, 'error'); }
      ask.disabled = false; qi.focus();
    };
    ask.onclick = doAsk;
    qi.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doAsk(); } });
    qi.addEventListener('input', () => { qi.style.height = 'auto'; qi.style.height = Math.min(qi.scrollHeight, 140) + 'px'; });
    drawHead(); drawSummary(); thread.hidden = true;
    try { await load(); } catch (e) { toast(e.message, 'error'); }
  }
})();