/* Settings (kept in this browser) and Help. */
(() => {
  const { el, icon, btn, pref, setPref, applyTheme, applyZoom, FMT } = DZ;
  const seg = (items, value, onPick, label) => {
    const s = el('div', 'seg'); s.setAttribute('role', 'group'); s.setAttribute('aria-label', label);
    items.forEach(([k, l]) => { const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', k === value); b.onclick = () => { s.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); onPick(k); }; s.append(b); });
    return s;
  };
  const row = (title, sub, control) => { const r = el('div', 'set-row'), l = el('div', 'l'); l.append(el('b', null, title), el('span', null, sub)); r.append(l, control); return r; };

  DZ.register('settings', {
    title: 'Settings', nav: 'settings',
    render(root) {
      const page = el('div', 'page'), h = el('div', 'page-head'), g = el('div', 'grow');
      g.append(el('h2', null, 'Settings'), el('p', null, 'These choices are saved in this browser.')); h.append(g); page.append(h);
      const grid = el('div', 'set-grid');

      const look = el('section', 'card set-card'); look.append(el('h3', null, 'Appearance'));
      look.append(row('Theme', 'Light, dark, or follow your device.', seg([['system', 'Device'], ['light', 'Light'], ['dark', 'Dark']], pref('theme'), (v) => { setPref('theme', v); applyTheme(); }, 'Theme')));
      const range = el('input'); range.type = 'range'; range.min = 0.9; range.max = 1.8; range.step = 0.05; range.value = pref('zoom'); range.setAttribute('aria-label', 'Dzongkha text size'); range.style.width = '180px';
      const prev = el('div', 'preview'); const pv = el('p', 'dz', 'ཀུན་ལ་བཀྲ་ཤིས་བདེ་ལེགས།'); prev.append(pv);
      range.oninput = () => { setPref('zoom', range.value); applyZoom(); };
      look.append(row('Dzongkha text size', 'Changes the size of answers and summaries.', range), prev);

      const sum = el('section', 'card set-card'); sum.append(el('h3', null, 'Summaries and chat'));
      sum.append(row('Default summary format', 'Used when you open a document.', seg(Object.entries(FMT).filter(([k]) => k !== 'auto'), pref('fmt'), (v) => setPref('fmt', v), 'Default summary format')));
      sum.append(row('Default summary language', 'Which language a summary shows first.', seg([['dz', 'Dzongkha'], ['en', 'English']], pref('lang'), (v) => setPref('lang', v), 'Default summary language')));
      const sw = el('label', 'switch'), cb = el('input'); cb.type = 'checkbox'; cb.checked = pref('understood') === '1'; cb.setAttribute('aria-label', 'Show how your question was understood');
      cb.onchange = () => setPref('understood', cb.checked ? '1' : '0'); sw.append(cb, el('i'));
      sum.append(row('Show how a question was understood', 'Under a Dzongkha question, shows the English it was translated to.', sw));

      const acc = el('section', 'card set-card'); acc.append(el('h3', null, 'Account'));
      acc.append(row('Signed in as', DZ.user || '', btn('', 'Sign out', 'out', () => DZ.signOut())));
      grid.append(look, sum, acc); page.append(grid); root.append(page);
    },
  });

  DZ.register('help', {
    title: 'Help', nav: 'help',
    render(root) {
      const page = el('div', 'page'), h = el('div', 'page-head'), g = el('div', 'grow');
      g.append(el('h2', null, 'Help'), el('p', null, 'How Dzongkha AI works and how to get good results.')); h.append(g); page.append(h);
      const grid = el('div', 'help-grid');
      const card = (t, node) => { const c = el('section', 'card help-card'); c.append(el('h3', null, t), node); grid.append(c); };
      const ul = (tag, items) => { const u = el(tag); items.forEach((i) => u.append(el('li', null, i))); return u; };
      card('How an answer is made', ul('ol', ['Your Dzongkha question is translated to English.', 'A language model on this computer answers in English.', 'The answer is translated back to Dzongkha.', 'Use Show English under an answer to compare both versions.']));
      card('Summarizing a document', ul('ol', ['Open Document Summarizer and upload a file.', 'Wait until the document is ready.', 'Choose a format and select Generate summary.', 'Copy, download or save the summary, or ask questions about the document below it.']));
      card('Supported files', ul('ul', ['PDF with selectable text. Scanned pages need OCR first.', 'Word (.docx)', 'Plain text (.txt) and Markdown (.md)', 'Up to 25 MB per file.']));
      card('Getting better results', ul('ul', ['Ask one thing at a time, in short sentences.', 'Check names, dates and numbers. Translation can change them.', 'Long documents take a few minutes. Progress shows while you wait.', 'Use Regenerate if an answer reads badly. The wording changes each time.']));
      card('Shortcuts', ul('ul', ['Enter sends a message. Shift+Enter adds a new line.', 'Drag a file onto the chat or the upload area.', 'The arrow at the bottom of the sidebar collapses it to icons.']));
      const about = el('div'); about.append(el('p', null, 'Dzongkha AI is a university project. Dzongkha translation uses free translation models and may contain mistakes. Please have important text checked by a Dzongkha speaker.'));
      card('About', about);
      page.append(grid); root.append(page);
    },
  });
})();
