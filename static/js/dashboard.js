/* Dashboard: welcome banner, the two main features, and recent activity from real data. */
(() => {
  const { el, icon, btn, api, fmtDate, go } = DZ;

  /* A small dzong: sloped wall, windows, central tower with a gilded roof. Drawn, not an image file. */
  function dzongSvg() {
    const w = document.createElement('div');
    w.innerHTML = `<svg class="dzong" viewBox="0 0 420 250" role="img" aria-label="Illustration of a Bhutanese dzong">
      <g fill="none" stroke="#f3dca0" stroke-width="1.4" stroke-linejoin="round" opacity=".95">
        <path d="M10 232 L40 150 H380 L410 232Z" fill="#8a2a3d"/>
        <path d="M40 150 H380" stroke-width="3"/>
        <rect x="60" y="112" width="300" height="38" fill="#fbf3e2" stroke="none"/>
        <rect x="60" y="126" width="300" height="9" fill="#6d1b2c" stroke="none"/>
        <path d="M52 112 H368 L356 100 H64Z" fill="#b8923f" stroke="none"/>
        <rect x="165" y="52" width="90" height="60" fill="#fbf3e2" stroke="none"/>
        <rect x="165" y="76" width="90" height="10" fill="#6d1b2c" stroke="none"/>
        <path d="M150 52 H270 L252 34 H168Z" fill="#b8923f" stroke="none"/>
        <path d="M186 34 H234 L222 20 H198Z" fill="#d2af62" stroke="none"/>
        <path d="M210 20 V8 M204 12 H216" stroke="#f3dca0" stroke-width="2"/>
        <g fill="#3f0e1b" stroke="none">
          <rect x="78" y="116" width="10" height="8"/><rect x="108" y="116" width="10" height="8"/><rect x="138" y="116" width="10" height="8"/>
          <rect x="272" y="116" width="10" height="8"/><rect x="302" y="116" width="10" height="8"/><rect x="332" y="116" width="10" height="8"/>
          <rect x="186" y="58" width="9" height="13"/><rect x="206" y="58" width="9" height="13"/><rect x="226" y="58" width="9" height="13"/>
          <path d="M196 232 V204 a14 14 0 0 1 28 0 V232Z"/>
        </g>
        <g fill="#3f0e1b" stroke="none" opacity=".55">
          <rect x="82" y="168" width="14" height="10"/><rect x="122" y="168" width="14" height="10"/><rect x="284" y="168" width="14" height="10"/><rect x="324" y="168" width="14" height="10"/>
          <rect x="102" y="198" width="14" height="10"/><rect x="304" y="198" width="14" height="10"/>
        </g>
      </g></svg>`;
    return w.firstChild;
  }

  function feature(kind, title, text, label, ic, hash) {
    const c = el('div', 'feature ' + kind);
    const i = el('div', 'f-ic'); i.append(icon(ic));
    const b = btn('', label, null, () => go(hash));
    c.append(i, el('h3', null, title), el('p', null, text), b);
    const corner = icon(ic); corner.setAttribute('class', 'i corner'); corner.style.strokeWidth = 1.2; c.append(corner);
    c.style.cursor = 'pointer'; c.onclick = (e) => { if (e.target.closest('button')) return; go(hash); };
    return c;
  }

  function item(ic, title, sub, ts, onOpen, label) {
    const r = el('div', 'row-item'); const i = el('div', 'r-ic'); i.append(icon(ic));
    const m = el('div', 'r-main'); const t = el('div', 'r-title', title); m.append(t, el('div', 'r-sub', sub + ' · ' + fmtDate(ts)));
    r.append(i, m, btn('sm', label || 'Open', null, onOpen)); return r;
  }

  DZ.register('dashboard', {
    title: 'Dashboard', nav: 'dashboard',
    async render(root) {
      const page = el('div', 'page'); root.append(page);
      const hero = el('section', 'hero');
      const left = el('div');
      left.append(el('p', 'greet', 'སྐུ་གཟུགས་བཟང་པོ།'), el('h2', null, 'Welcome to Dzongkha AI'),
        el('p', null, 'Your intelligent assistant for Dzongkha communication and document understanding.'));
      hero.append(left, dzongSvg()); page.append(hero);

      const feats = el('section', 'features');
      feats.append(
        feature('chat', 'Chat with Dzongkha AI', 'Ask questions, receive answers and communicate naturally in Dzongkha.', 'Start Chatting', 'chat', '#/chat'),
        feature('docs', 'Dzongkha Document Summarizer', 'Upload documents and generate meaningful summaries in Dzongkha.', 'Summarize a Document', 'doc', '#/summarizer'));
      page.append(feats);

      const stats = el('div', 'stats'), act = el('section', 'activity');
      page.append(stats, act);
      const head = el('div', 'act-head'); head.append(el('h3', null, 'Recent activity'));
      const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Filter activity');
      const card = el('div', 'card list'); act.append(head, card);
      card.append(el('div', 'empty', 'Loading...'));

      let data;
      try {
        const [chats, docs, saved] = await Promise.all([api('/api/chats'), api('/api/docs'), api('/api/summaries')]);
        data = { chats, docs, saved };
      } catch (e) { card.textContent = ''; card.append(DZ.empty('help', 'Could not load your activity', e.message)); return; }

      for (const [n, label] of [[data.chats.length, 'conversations'], [data.docs.length, 'documents'], [data.saved.length, 'saved summaries']]) {
        const s = el('div', 'stat'); s.append(el('b', null, String(n)), el('span', 'muted', label)); stats.append(s);
      }

      const all = [];
      data.chats.forEach((c) => all.push({ kind: 'chat', ts: c.updated, node: () => item('chat', c.title, 'Conversation', c.updated, () => go('#/chat/' + c.id)) }));
      data.docs.forEach((d) => {
        all.push({ kind: 'doc', ts: d.created, node: () => item('doc', d.name, 'Uploaded ' + DZ.ext(d.name), d.created, () => go('#/summarizer/' + d.id), 'Open') });
        if (d.last_summary) all.push({ kind: 'sum', ts: d.last_summary, node: () => item('list', d.name, d.summaries + (d.summaries > 1 ? ' summaries generated' : ' summary generated'), d.last_summary, () => go('#/summarizer/' + d.id), 'View summary') });
      });
      data.saved.forEach((s) => all.push({ kind: 'sum', ts: s.created, node: () => item('bookmark', s.doc_name, 'Saved ' + (DZ.FMT[s.fmt] || 'summary').toLowerCase(), s.created, () => go('#/summaries'), 'View') }));
      all.sort((a, b) => b.ts - a.ts);

      let filter = 'all';
      const draw = () => {
        card.textContent = '';
        const list = all.filter((a) => filter === 'all' || a.kind === filter).slice(0, 8);
        if (!list.length) { card.append(DZ.empty('clock', 'Nothing here yet', 'Start a chat or upload a document and it will show up here.')); return; }
        list.forEach((a) => card.append(a.node()));
      };
      [['all', 'All'], ['chat', 'Chats'], ['doc', 'Documents'], ['sum', 'Summaries']].forEach(([k, l]) => {
        const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', k === filter);
        b.onclick = () => { filter = k; seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); }; seg.append(b);
      });
      head.append(seg); draw();
    },
  });
})();