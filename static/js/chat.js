/* Chat with Dzongkha AI. Uses the existing chat API: conversations, messages, attached files. */
(() => {
  const { $, el, icon, btn, api, toast, confirmDialog, go, pref, setPref, applyZoom } = DZ;
  let S = null;   // state of the open page

  function stop() { if (S) { clearTimeout(S.timer); S.dead = true; } const v = document.querySelector('#view'); if (v) v.style.overflow = ''; }

  DZ.register('chat', {
    title: 'Chat with AI', nav: 'chat',
    destroy: stop,
    async render(root, params) {
      S = { chats: [], cur: params[0] ? Number(params[0]) : null, chat: null, timer: null, uploading: [], showEn: new Set(), dead: false };
      const s = S, q = (sel) => root.querySelector(sel);
      const page = el('div', 'chatpage'); root.style.overflow = 'hidden'; root.append(page);

      /* ----- conversation list ----- */
      const convs = el('aside', 'convs');
      const nb = btn('primary', 'New conversation', 'plus', () => { page.classList.remove('show-convs'); go('#/chat'); });
      const sec = el('div', 'sec', 'Conversations'), list = el('div', 'list-scroll');
      convs.append(nb, sec, list);

      /* ----- conversation ----- */
      const main = el('section', 'chatmain');
      const bar = el('div', 'chat-bar');
      const tog = el('button', 'icon-btn conv-toggle'); tog.style.display = 'none'; tog.setAttribute('aria-label', 'Show conversations'); tog.append(icon('list'));
      tog.onclick = () => page.classList.toggle('show-convs');
      const title = el('div', 't', 'New conversation');
      const zm = btn('sm', 'A−'), zp = btn('sm', 'A+'); zm.title = 'Smaller text'; zp.title = 'Larger text';
      zm.setAttribute('aria-label', 'Smaller text'); zp.setAttribute('aria-label', 'Larger text');
      const setZ = (d) => { setPref('zoom', Math.round(Math.min(1.8, Math.max(0.9, (parseFloat(pref('zoom')) || 1.15) + d)) * 100) / 100); applyZoom(); };
      zm.onclick = () => setZ(-0.1); zp.onclick = () => setZ(0.1);
      const clr = btn('sm danger', 'Clear', 'trash'); clr.title = 'Clear conversation';
      bar.append(tog, title, zm, zp, clr);

      const scroll = el('div', 'scroll'), welcome = el('div', 'welcome'), msgs = el('div'); msgs.id = 'msgs';
      scroll.append(welcome, msgs);

      const wrap = el('div', 'composer-wrap'), comp = el('div', 'composer'), chips = el('div', 'chips');
      const row = el('div', 'crow');
      const attach = el('button', 'icon-btn'); attach.type = 'button'; attach.title = 'Attach a PDF, Word or text file'; attach.setAttribute('aria-label', 'Attach a file'); attach.append(icon('clip'));
      const input = el('textarea'); input.rows = 1; input.placeholder = 'Ask in Dzongkha or English'; input.setAttribute('aria-label', 'Message');
      const sum = btn('sm', 'Summarize', 'doc'); sum.hidden = true; sum.title = 'Summarize the attached document';
      const send = el('button', 'icon-btn send'); send.type = 'button'; send.title = 'Send'; send.setAttribute('aria-label', 'Send'); send.append(icon('send'));
      row.append(attach, input, sum, send); comp.append(chips, row);
      wrap.append(comp, el('div', 'hint', 'Answers are translated, so check names and numbers. Enter sends, Shift+Enter adds a new line.'));
      const file = el('input'); file.type = 'file'; file.accept = DZ.ACCEPT; file.multiple = true; file.hidden = true;
      const veil = el('div', 'dropveil', 'Drop a file to attach it'); veil.hidden = true;
      main.append(bar, scroll, wrap, file, veil);
      page.append(convs, main);

      /* ----- welcome and suggested prompts ----- */
      const mk = el('div', 'mark', 'ཇ'); mk.setAttribute('aria-hidden', 'true');
      welcome.append(mk, el('h2', null, 'How can I help today?'), el('p', null, 'Write in Dzongkha or English. Every answer comes back in Dzongkha.'));
      const starters = el('div', 'starters');
      const st = (ic, t, d, fn) => { const b = el('button', 'starter'); b.type = 'button'; const i = el('div', 's-ic'); i.append(icon(ic)); const x = el('div'); x.append(el('b', null, t), el('span', null, d)); b.append(i, x); b.onclick = fn; return b; };
      const fill = (text) => { input.value = text; grow(); input.focus(); input.setSelectionRange(text.length, text.length); };
      starters.append(
        st('chat', 'Ask a question in Dzongkha', 'Type it in Dzongkha script, or in English.', () => input.focus()),
        st('sparkle', 'Explain a topic in simple Dzongkha', 'For example, how rain is formed.', () => fill('Explain how rain is formed in simple words.')),
        st('doc', 'Help me understand a document', 'Attach a PDF, Word or text file.', () => file.click()),
        st('translate', 'Translate this text', 'Add your text after the colon.', () => fill('Translate this into Dzongkha: ')));
      welcome.append(starters);

      /* ----- data ----- */
      const nearBottom = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140;
      const toBottom = () => { scroll.scrollTop = scroll.scrollHeight; };

      async function loadChats() { s.chats = await api('/api/chats'); drawList(); }
      function drawList() {
        list.textContent = '';
        if (!s.chats.length) { list.append(el('div', 'sec', 'No conversations yet')); return; }
        for (const c of s.chats) {
          const r = el('div', 'conv' + (c.id === s.cur ? ' active' : ''));
          const o = el('button', 'open', c.title); o.title = c.title; o.onclick = () => { page.classList.remove('show-convs'); go('#/chat/' + c.id); };
          const d = el('button', 'del'); d.title = 'Delete conversation'; d.setAttribute('aria-label', 'Delete conversation'); d.append(icon('trash', 15));
          d.onclick = async () => {
            if (!(await confirmDialog('Delete conversation', 'This deletes the conversation and any files attached to it.'))) return;
            try { await api('/api/chats/' + c.id, { method: 'DELETE' }); toast('Conversation deleted', 'ok'); if (s.cur === c.id) go('#/chat'); else await loadChats(); } catch (e) { toast(e.message, 'error'); }
          };
          r.append(o, d); list.append(r);
        }
      }
      async function loadChat(scrollDown) {
        if (s.cur == null || s.dead) return;
        const id = s.cur, data = await api('/api/chats/' + id);
        if (id !== s.cur || s.dead) return;
        const was = nearBottom(); s.chat = data; title.textContent = data.title;
        drawMsgs(); drawDocs();
        if (scrollDown || was) toBottom();
        const busy = data.messages.some((m) => m.status === 'pending') || data.docs.some((d) => d.status === 'queued' || d.status === 'processing');
        clearTimeout(s.timer);
        if (busy) s.timer = setTimeout(() => loadChat(false).catch(() => {}), 1500); else loadChats().catch(() => {});
      }

      /* ----- messages ----- */
      function fillMsg(node, m) {
        node.className = 'msg ' + m.role + (m.status === 'error' ? ' error' : ''); node.textContent = '';
        if (m.role === 'assistant') { const a = el('div', 'av', 'ཇ'); a.setAttribute('aria-hidden', 'true'); node.append(a); }
        const body = el('div', 'body');
        if (m.status === 'pending') {
          const p = el('div', 'pending'), d = el('span', 'dots'); d.append(el('i'), el('i'), el('i'));
          p.append(d, el('span', null, (m.progress || 'Thinking') + '...')); body.append(p);
        } else {
          const useEn = s.showEn.has(m.id) && m.en, txt = useEn ? m.en : m.text;
          body.append(el('div', 'text' + (!useEn && DZ.TIB.test(txt) && m.role === 'assistant' ? ' dz' : ''), txt));
          if (m.role === 'user' && m.en && m.en !== m.text && pref('understood') === '1') body.append(el('div', 'note', 'Understood as: ' + m.en));
          if (m.role === 'assistant') {
            const a = el('div', 'acts');
            if (m.status === 'done') {
              const c = el('button'); c.type = 'button'; c.append(icon('copy'), document.createTextNode('Copy')); c.onclick = () => DZ.copyText(txt, c); a.append(c);
              const r = el('button'); r.type = 'button'; r.append(icon('refresh'), document.createTextNode('Regenerate'));
              r.onclick = async () => { try { await api('/api/messages/' + m.id + '/regenerate', { method: 'POST', json: {} }); await loadChat(true); } catch (e) { toast(e.message, 'error'); } };
              a.append(r);
              if (m.en) { const t = el('button', null, useEn ? 'Show Dzongkha' : 'Show English'); t.type = 'button'; t.onclick = () => { useEn ? s.showEn.delete(m.id) : s.showEn.add(m.id); drawMsgs(); }; a.append(t); }
            } else {
              const r = el('button'); r.type = 'button'; r.append(icon('refresh'), document.createTextNode('Try again'));
              r.onclick = async () => { try { await api('/api/messages/' + m.id + '/regenerate', { method: 'POST', json: {} }); await loadChat(true); } catch (e) { toast(e.message, 'error'); } };
              a.append(r);
            }
            body.append(a);
          }
        }
        node.append(body);
      }
      function drawMsgs() {
        const list = s.chat ? s.chat.messages : [], ids = new Set(list.map((m) => String(m.id)));
        [...msgs.children].forEach((n) => { if (!ids.has(n.dataset.id)) n.remove(); });
        for (const m of list) {
          let n = msgs.querySelector('[data-id="' + m.id + '"]');
          if (!n) { n = el('div'); n.dataset.id = m.id; msgs.append(n); }
          const sig = [m.status, m.progress, m.text, m.en, s.showEn.has(m.id), pref('understood')].join('␟');
          if (n.dataset.sig !== sig) { n.dataset.sig = sig; fillMsg(n, m); }
        }
        welcome.hidden = list.length > 0; clr.hidden = list.length === 0;
      }

      /* ----- attached files ----- */
      function drawDocs() {
        chips.textContent = '';
        const docs = s.chat ? s.chat.docs : [], last = docs.map((d) => d.status).lastIndexOf('ready');
        docs.forEach((d, i) => {
          const c = el('div', 'chip'); c.append(el('span', 'fn', d.name));
          let meta = '', cls = 'meta';
          if (d.status === 'error') { meta = d.error; cls += ' bad'; }
          else if (d.status !== 'ready') meta = d.progress || 'Reading...';
          else {
            meta = (d.pages > 1 ? d.pages + ' pages, ' : '') + d.words.toLocaleString() + ' words';
            if (i !== last) { meta += '. Older file, not used'; c.style.opacity = '.6'; }
            if (d.empty_pages) { meta += '. ' + d.empty_pages + ' page' + (d.empty_pages > 1 ? 's have' : ' has') + ' no text (scanned images?)'; cls += ' warn'; }
          }
          c.append(el('span', cls, meta));
          if (d.status === 'ready') { const o = el('button', null, 'Open'); o.type = 'button'; o.title = 'Open in the document summarizer'; o.onclick = () => go('#/summarizer/' + d.id); c.append(o); }
          const x = el('button'); x.type = 'button'; x.title = 'Remove file'; x.setAttribute('aria-label', 'Remove file'); x.append(icon('x', 14));
          x.onclick = async () => { try { await api('/api/docs/' + d.id, { method: 'DELETE' }); loadChat(false); } catch (e) { toast(e.message, 'error'); } };
          c.append(x); chips.append(c);
        });
        for (const n of s.uploading) { const c = el('div', 'chip'); c.append(el('span', 'fn', n), el('span', 'meta', 'Uploading...')); chips.append(c); }
        sum.hidden = !docs.some((d) => d.status === 'ready'); chips.hidden = !chips.children.length;
      }
      async function ensureChat() {
        if (s.cur != null) return;
        const c = await api('/api/chats', { method: 'POST', json: {} });
        s.cur = c.id; s.chat = { id: c.id, title: c.title, messages: [], docs: [] };
        history.replaceState(null, '', '#/chat/' + c.id); await loadChats();
      }
      async function uploadFiles(files) {
        for (const f of files) {
          if (!DZ.SUPPORTED.test(f.name)) { toast(f.name + ': only PDF, Word (.docx), TXT and MD files are supported.', 'error'); continue; }
          try {
            await ensureChat(); s.uploading.push(f.name); drawDocs();
            await DZ.upload('/api/chats/' + s.cur + '/upload', f);
            toast(f.name + ' attached', 'ok');
          } catch (e) { toast(f.name + ': ' + e.message, 'error'); }
          s.uploading = s.uploading.filter((n) => n !== f.name);
        }
        await loadChat(false);
      }
      attach.onclick = () => file.click();
      file.onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ''; };
      let depth = 0;
      main.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; veil.hidden = false; } });
      main.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
      main.addEventListener('dragover', (e) => e.preventDefault());
      main.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; veil.hidden = true; if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]); });

      /* ----- sending ----- */
      async function post(action) {
        const text = input.value.trim();
        if (action === 'chat' && !text) return;
        send.disabled = true;
        try {
          await ensureChat(); input.value = ''; grow();
          await api('/api/chats/' + s.cur + '/messages', { json: { text, action, paragraphs: 0 } });
          await loadChat(true);
        } catch (e) { toast(e.message, 'error'); }
        send.disabled = false; input.focus();
      }
      send.onclick = () => post('chat'); sum.onclick = () => post('summarize');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); post('chat'); } });
      function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 190) + 'px'; }
      input.addEventListener('input', grow);
      clr.onclick = async () => {
        if (s.cur == null || !(await confirmDialog('Clear conversation', 'All messages in this conversation will be deleted. Attached files stay.', 'Clear'))) return;
        try { await api('/api/chats/' + s.cur + '/messages', { method: 'DELETE' }); toast('Conversation cleared', 'ok'); await loadChat(true); await loadChats(); } catch (e) { toast(e.message, 'error'); }
      };

      /* ----- start ----- */
      drawMsgs(); drawDocs(); clr.hidden = true;
      try { await loadChats(); if (s.cur != null) await loadChat(true); } catch (e) { toast(e.message, 'error'); }
      if (s.cur != null && !s.chat) { toast('That conversation was not found.', 'error'); go('#/chat'); return; }
      if (!matchMedia('(pointer: coarse)').matches) input.focus();
    },
  });
})();
