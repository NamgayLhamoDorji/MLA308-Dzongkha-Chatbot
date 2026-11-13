/* Translate: Dzongkha <-> English text. */
(() => {
  const { el, icon, btn, api, toast, copyText } = DZ;
  DZ.register('translate', {
    title: 'Translate', nav: 'translate',
    render(root) {
      const page = el('div', 'page'), h = el('div', 'page-head'), g = el('div', 'grow');
      g.append(el('h2', null, 'Translate'), el('p', null, 'Type or paste Dzongkha or English. The language is detected for you.'));
      h.append(g); page.append(h);

      let target = 'auto';
      const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Translate into');
      [['auto', 'Auto'], ['dz', 'To Dzongkha'], ['en', 'To English']].forEach(([k, l]) => {
        const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', k === target);
        b.onclick = () => { target = k; seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
        seg.append(b);
      });

      const grid = el('div', 'set-grid');
      const inCard = el('section', 'card set-card'), outCard = el('section', 'card set-card');
      const ta = el('textarea', 'input'); ta.rows = 10; ta.placeholder = 'Type or paste text here…'; ta.setAttribute('aria-label', 'Text to translate'); ta.style.width = '100%'; ta.style.resize = 'vertical';
      ta.addEventListener('input', () => { ta.classList.toggle('dz', /[ༀ-࿿]/.test(ta.value)); });
      const count = el('div', null, ''); count.style.cssText = 'font-size:.8rem;opacity:.7;margin-top:6px';
      ta.addEventListener('input', () => { count.textContent = ta.value.length + ' / 3000'; });
      inCard.append(el('h3', null, 'Your text'), ta, count);

      const out = el('div', 'preview'); out.style.minHeight = '220px'; out.style.whiteSpace = 'pre-wrap';
      const outP = el('p', null, 'The translation appears here.'); outP.style.opacity = '.6'; out.append(outP);
      const dirLbl = el('div', null, ''); dirLbl.style.cssText = 'font-size:.85rem;opacity:.75;margin-bottom:6px';
      outCard.append(el('h3', null, 'Translation'), dirLbl, out);

      const go = btn('primary', 'Translate'); go.type = 'button';
      const copy = btn('', 'Copy'); copy.type = 'button'; copy.disabled = true;
      const clear = btn('', 'Clear'); clear.type = 'button';
      const bar = el('div'); bar.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0'; bar.append(seg, go, copy, clear);

      let last = '';
      const run = async () => {
        const text = ta.value.trim();
        if (!text) { toast('Type or paste some text first.'); return; }
        go.disabled = true; go.textContent = 'Translating…'; outP.textContent = 'Translating…'; outP.style.opacity = '.6'; outP.className = '';
        try {
          const r = await api('/api/translate', { json: { text, target } });
          last = r.text; outP.textContent = r.text; outP.style.opacity = '1';
          outP.className = r.target === 'dz' ? 'dz' : '';
          dirLbl.textContent = r.direction === 'dz-en' ? 'Dzongkha → English' : r.direction === 'en-dz' ? 'English → Dzongkha' : 'The text is already in that language.';
          copy.disabled = false;
        } catch (e) {
          outP.textContent = 'Could not translate. ' + (e.message || 'Please try again.'); outP.style.opacity = '.8';
        } finally { go.disabled = false; go.textContent = 'Translate'; }
      };
      go.onclick = run;
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(); });
      copy.onclick = () => copyText(last);
      clear.onclick = () => { ta.value = ''; last = ''; count.textContent = ''; dirLbl.textContent = ''; outP.textContent = 'The translation appears here.'; outP.style.opacity = '.6'; outP.className = ''; copy.disabled = true; ta.classList.remove('dz'); ta.focus(); };

      grid.append(inCard, outCard); page.append(bar, grid); root.append(page);
    },
  });
})();