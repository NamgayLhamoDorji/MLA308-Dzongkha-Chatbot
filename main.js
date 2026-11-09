/* Start-up: sign in, build the sidebar, wire the top bar, start the router. */
(() => {
  const { $, el, icon, api, go, pref, setPref } = DZ;
  const NAV = [['dashboard', 'Dashboard', 'home'], ['chat', 'Chat with AI', 'chat'], ['summarizer', 'Document Summarizer', 'doc'],
               ['documents', 'My Documents', 'folder'], ['summaries', 'Saved Summaries', 'bookmark'], ['history', 'Chat History', 'clock'],
               ['settings', 'Settings', 'gear'], ['help', 'Help', 'help']];

  function buildNav() {
    const nav = $('#nav'); nav.textContent = '';
    NAV.forEach(([page, label, ic], i) => {
      if (i === 6) nav.append(el('div', 'nav-sep'));
      const a = el('a', 'nav-item'); a.href = '#/' + page; a.dataset.page = page; a.title = label; a.append(icon(ic), el('span', 'lbl', label)); nav.append(a);
    });
    const spacer = el('div'); spacer.style.flex = '1'; nav.append(spacer);
    const c = el('button', 'nav-item collapse-btn'); c.type = 'button'; c.title = 'Collapse or expand the sidebar'; c.setAttribute('aria-label', 'Collapse or expand the sidebar');
    c.append(icon('chevron'), el('span', 'lbl', 'Collapse'));
    c.onclick = () => { const on = document.body.classList.toggle('collapsed'); setPref('collapsed', on ? 1 : 0); };
    nav.append(c);
  }

  /* sign in / create account */
  let mode = 'in';
  function setMode(m) {
    mode = m; $('#tab-in').setAttribute('aria-pressed', m === 'in'); $('#tab-up').setAttribute('aria-pressed', m === 'up');
    $('#authgo').textContent = m === 'in' ? 'Sign in' : 'Create account'; $('#p').autocomplete = m === 'in' ? 'current-password' : 'new-password'; $('#autherr').textContent = '';
  }
  $('#tab-in').onclick = () => setMode('in'); $('#tab-up').onclick = () => setMode('up');
  $('#authform').onsubmit = async (e) => {
    e.preventDefault(); $('#authgo').disabled = true; $('#autherr').textContent = '';
    try { const r = await api(mode === 'in' ? '/api/login' : '/api/register', { json: { username: $('#u').value, password: $('#p').value }, quiet: true }); $('#p').value = ''; enter(r.username); }
    catch (err) { $('#autherr').textContent = err.message; }
    $('#authgo').disabled = false;
  };

  function showAuth() { $('#app').hidden = true; $('#auth').hidden = false; DZ.user = null; $('#u').focus(); }
  function enter(username) {
    DZ.user = username; $('#auth').hidden = true; $('#app').hidden = false;
    $('#uname').textContent = username; $('#uav').textContent = username[0];
    if (!location.hash) location.hash = '#/dashboard'; else DZ.route();
  }
  DZ.onSignedOut = showAuth;
  DZ.signOut = async () => { await api('/api/logout', { method: 'POST', quiet: true }).catch(() => {}); location.hash = '#/dashboard'; showAuth(); };

  /* top bar */
  $('#menu-btn').append(icon('menu')); $('#set-btn').append(icon('gear'));
  $('#menu-btn').onclick = () => document.body.classList.add('nav'); $('#scrim').onclick = () => document.body.classList.remove('nav');
  $('#profile').onclick = () => DZ.confirmDialog('Sign out', 'Sign out of Dzongkha AI?', 'Sign out').then((ok) => ok && DZ.signOut());
  $('#theme-btn').onclick = () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    setPref('theme', dark ? 'light' : 'dark'); DZ.applyTheme();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', DZ.applyTheme);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.remove('nav'); });

  if (pref('collapsed') === '1') document.body.classList.add('collapsed');
  DZ.applyTheme(); DZ.applyZoom(); buildNav();
  (async () => { try { const m = await api('/api/me', { quiet: true }); enter(m.username); } catch { showAuth(); } })();
})();
