/* Shared shell for app.90s6.com: one Supabase client, one sign in, one nav bar.
   Pages call App.onSession((session, profile) => ...) and never touch the gate. */
(() => {
  'use strict';

  const cfg = window.APP_CONFIG;
  if (!cfg || !window.supabase) { console.error('App: config.js or supabase-js missing'); return; }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...kids); return n; };

  const listeners = [];
  const beforeOut = [];
  let session = null, profile = null, state = 'unknown', notice = '';

  // ---------- Sign in gate ----------
  const gate = el('div', { id: 'appGate' });
  gate.innerHTML = `
    <div class="box">
      <h2>90S6 App</h2>
      <p id="apLead">Sign in to continue.</p>
      <form id="apForm" novalidate>
        <label for="apEmail">Email</label><input id="apEmail" type="email" autocomplete="email">
        <label for="apPass">Password</label><input id="apPass" type="password" autocomplete="current-password">
        <button class="primary" type="submit">Sign in</button>
      </form>
      <p id="apMsg" role="status"></p>
    </div>`;
  document.body.append(gate);

  const msg = (t, err) => { const m = $('apMsg'); m.textContent = t || ''; m.className = err ? 'err' : ''; };
  const busy = on => gate.querySelectorAll('button').forEach(b => (b.disabled = on));

  $('apForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('apEmail').value.trim(), password = $('apPass').value;
    if (!email || !password) return msg('Enter your email and password.', true);
    busy(true); msg('Signing in...');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    busy(false); msg(error ? error.message : '', !!error);
  });

  // ---------- Nav bar ----------
  const nav = el('header', { id: 'appNav', hidden: true });
  nav.innerHTML = `
    <a class="brand" href="/">90S6 App</a>
    <nav><a href="/work-board/">Work Board</a><a href="/admin/" id="apAdminLink" hidden>Admin</a><a href="/profile/">My Profile</a></nav>
    <span class="who" id="apWho"></span>
    <button type="button" id="apOut">Sign out</button>`;
  document.body.prepend(nav);
  nav.querySelectorAll('nav a').forEach(a => {
    if (location.pathname.startsWith(a.getAttribute('href'))) a.setAttribute('aria-current', 'page');
  });
  $('apOut').addEventListener('click', () => signOut());

  function renderNav() {
    nav.hidden = state !== 'in';
    if (state !== 'in') return;
    $('apAdminLink').hidden = !profile.is_admin;
    $('apWho').textContent = profile.full_name || profile.email || '';
  }

  // ---------- Session handling ----------
  const emit = () => listeners.forEach(cb => cb(state === 'in' ? session : null, state === 'in' ? profile : null));

  async function handle(s) {
    if (!s) {
      session = null; profile = null; state = 'out';
      gate.hidden = false; $('apForm').hidden = false; msg(notice, !!notice); notice = '';
      renderNav(); emit(); return;
    }
    if (session && session.user.id === s.user.id) { session = s; return; } // token refresh
    session = s;
    $('apForm').hidden = true; gate.hidden = false; msg('Loading your account...');
    const { data, error } = await sb.from('profiles')
      .select('id,email,full_name,is_admin,is_superuser,disabled,tour_completed_at').eq('id', s.user.id).maybeSingle();
    if (error || !data || data.disabled) {
      notice = data && data.disabled ? 'This account is disabled. Contact your administrator.' : 'Could not load your account. Try again.';
      session = null;
      await sb.auth.signOut();
      return;
    }
    profile = data; state = 'in';
    sb.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', s.user.id).then(() => {});
    try {
      if (sessionStorage.getItem('ap-sess') !== s.user.id) {
        sessionStorage.setItem('ap-sess', s.user.id);
        sb.rpc('log_event', { p_action: 'auth.sign_in' }).then(() => {});
      }
    } catch (e) {}
    gate.hidden = true; renderNav(); emit();
  }

  // Defer out of the callback: awaiting supabase calls inside it can deadlock
  sb.auth.onAuthStateChange((_event, s) => setTimeout(() => handle(s), 0));

  let signingOut = false;
  async function signOut() {
    if (signingOut) return;
    signingOut = true;
    const out = $('apOut');
    out.disabled = true;
    out.textContent = 'Signing out...';
    // Saving the current board should not indefinitely block account sign-out.
    await Promise.race([
      Promise.allSettled(beforeOut.map(f => Promise.resolve().then(f))),
      new Promise(resolve => setTimeout(resolve, 2500))
    ]);
    try {
      // Local scope avoids waiting for a network sign-out request.
      const { error } = await sb.auth.signOut({ scope: 'local' });
      if (error) throw error;
      session = null; profile = null; state = 'out';
      gate.hidden = false; $('apForm').hidden = false; renderNav(); emit();
      try { sessionStorage.removeItem('ap-sess'); } catch (e) {}
      try {
        Object.keys(localStorage)
          .filter(k => k === 'work-chunks-board-v1' || k.startsWith('wc-'))
          .forEach(k => localStorage.removeItem(k));
      } catch (e) {}
      location.replace('/');
    } catch (e) {
      out.disabled = false;
      out.textContent = 'Sign out';
      signingOut = false;
      alert('Could not sign out: ' + (e.message || e));
    }
  }

  window.App = {
    sb,
    signOut,
    onBeforeSignOut: cb => beforeOut.push(cb),
    onSession(cb) {
      listeners.push(cb);
      if (state !== 'unknown') cb(state === 'in' ? session : null, state === 'in' ? profile : null);
    }
  };
})();
