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
  let session = null, profile = null, state = 'unknown', notice = ''; let tenantMemberships = [], activeTenantId = null; let features = {}, organizationFeatures = {}, tenantUserFeatures = {}; const featureNames=['portfolio_management','work_board','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator']; const hasFeature=k=>!!profile?.is_admin || (features[k] !== false && organizationFeatures[k] !== false && tenantUserFeatures[k] !== false);

  const tenantRole = (id = activeTenantId) => tenantMemberships.find(m => m.tenant_id === id)?.role || null;
  const isTenantAdmin = (id = activeTenantId) => !!profile?.is_admin || tenantRole(id) === 'tenant_admin';
  const canCreateResources = (id = activeTenantId) => !!profile?.is_admin || ['tenant_admin','superuser'].includes(tenantRole(id));
  function setActiveTenant(id) {
    if (!tenantMemberships.some(m => m.tenant_id === id)) throw new Error('Not a member of this tenant');
    activeTenantId = id;
    sessionStorage.setItem('90s6-active-tenant:' + profile.id, id);
    location.reload();
  }

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
    <div class="ap-nav-top">
      <a class="brand" href="/" aria-label="90S6 home">90S6<span class="ap-brand-accent"> App</span></a>
      <div class="ap-nav-account">
        <div class="ap-org-control"><span class="ap-org-label">ORGANIZATION</span><span class="ap-org-icon" aria-hidden="true">▦</span><select id="apTenantSelect" aria-label="Active organization"></select><span id="apTenantName" class="ap-tenant-name" hidden></span><span id="apOrgChevron" class="ap-org-chevron" aria-hidden="true">⌄</span></div>
        <div class="ap-user-menu"><button type="button" id="apUserButton" aria-expanded="false" aria-controls="apUserDropdown" aria-label="Account menu"><span id="apAvatar" class="ap-avatar">U</span><span class="who" id="apWho"></span><span class="ap-user-chevron" aria-hidden="true">⌄</span></button>
          <div id="apUserDropdown" class="ap-user-dropdown" hidden><a href="/profile/">My Profile</a><button type="button" id="apOut">Sign out</button></div>
        </div>
      </div>
    </div>
    <div class="ap-nav-bottom"><nav aria-label="Main navigation"><a href="/">Home</a><a href="/portfolio-management/">Portfolio Management</a><a href="/work-board/">Work Board</a><a href="/training/">Training</a><a href="/prompts/">Prompt Library</a><a href="/knowledge-base/">Knowledge Base</a><a href="/content-studio/" id="apStudioLink" hidden>Content Studio</a><a href="/tenant-admin/" id="apTenantAdminLink" hidden>Organization Admin</a><a href="/admin/" id="apAdminLink" hidden>Global Admin</a></nav></div>`;
  document.body.prepend(nav);
  nav.querySelectorAll('nav a').forEach(a => {
    if (location.pathname.startsWith(a.getAttribute('href'))) a.setAttribute('aria-current', 'page');
  });
  $('apOut').addEventListener('click', () => signOut());
  $('apUserButton').addEventListener('click', () => { const menu=$('apUserDropdown');menu.hidden=!menu.hidden;$('apUserButton').setAttribute('aria-expanded',String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!e.target.closest('#appNav .ap-user-menu')) { $('apUserDropdown').hidden=true;$('apUserButton').setAttribute('aria-expanded','false'); } });
  document.addEventListener('keydown', e => { if(e.key==='Escape'){$('apUserDropdown').hidden=true;$('apUserButton').setAttribute('aria-expanded','false');} });
  $('apTenantSelect').addEventListener('change', e => setActiveTenant(e.target.value));

  function renderNav() {
    nav.hidden = state !== 'in';
    if (state !== 'in') return;
    $('apAdminLink').hidden = !profile.is_admin;
    $('apTenantAdminLink').hidden = !isTenantAdmin(); // Tenant Admin UI pending authorization-aware implementation.
    const tenantSelect = $('apTenantSelect');
    tenantSelect.replaceChildren();
    for (const m of tenantMemberships) { const o = document.createElement('option'); o.value=m.tenant_id; o.textContent=m.tenants?.name || m.tenant_id; tenantSelect.append(o); }
    tenantSelect.value=activeTenantId || '';
    const multipleOrgs=tenantMemberships.length>1;
    tenantSelect.hidden=!multipleOrgs;
    $('apTenantName').hidden=multipleOrgs;
    $('apTenantName').textContent=tenantMemberships.find(m=>m.tenant_id===activeTenantId)?.tenants?.name || (profile.is_admin?'Global Administration':'No organization');
    $('apOrgChevron').hidden=!multipleOrgs;
    $('apStudioLink').hidden = !(hasFeature('content_studio') && (profile.is_admin || profile.is_superuser || profile.is_content_creator));
    [['/portfolio-management/','portfolio_management'],['/work-board/','work_board'],['/training/','training'],['/prompts/','prompt_library'],['/knowledge-base/','knowledge_base']].forEach(([href,key])=>{const a=nav.querySelector('a[href="'+href+'"]');if(a)a.hidden=!hasFeature(key)});
    $('apWho').textContent = profile.full_name || profile.email || '';
    $('apAvatar').textContent=(profile.full_name || profile.email || 'U').split(/[\\s@]+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('');
  }

  // ---------- Session handling ----------
  const emit = () => listeners.forEach(cb => cb(state === 'in' ? session : null, state === 'in' ? profile : null));

  async function handle(s) {
    if (!s) {
      const signedOutUserId = session?.user?.id;
      session = null; profile = null; tenantMemberships=[]; activeTenantId=null; state = 'out';
      gate.hidden = false; $('apForm').hidden = false; msg(notice, !!notice); notice = '';
      renderNav(); emit(); return;
    }
    if (session && session.user.id === s.user.id) { session = s; return; } // token refresh
    session = s;
    $('apForm').hidden = true; gate.hidden = false; msg('Loading your account...');
    const { data, error } = await sb.from('profiles')
      .select('id,email,full_name,is_admin,is_superuser,is_content_creator,disabled,tour_completed_at,intro_presentation_completed_at').eq('id', s.user.id).maybeSingle();
    if (error || !data || data.disabled) {
      notice = data && data.disabled ? 'This account is disabled. Contact your administrator.' : 'Could not load your account. Try again.';
      session = null;
      await sb.auth.signOut();
      return;
    }
    profile = data;
    const memberships = await sb.from('tenant_members').select('tenant_id,role,tenants(name)').eq('user_id',s.user.id).eq('status','active');
    if (memberships.error) { notice='Could not load organization membership.'; session=null; await sb.auth.signOut(); return; }
    tenantMemberships = memberships.data || [];
    const preferred = sessionStorage.getItem('90s6-active-tenant:' + s.user.id);
    activeTenantId = tenantMemberships.some(m => m.tenant_id === preferred) ? preferred : tenantMemberships[0]?.tenant_id || null;
    if (!activeTenantId && !profile.is_admin) { notice='No active organization membership. Contact your administrator.'; session=null; await sb.auth.signOut(); return; }
    const grants=await sb.from('user_feature_access').select('feature,enabled').eq('user_id',s.user.id); if(grants.error){notice='Could not load application permissions.';session=null;await sb.auth.signOut();return;}features={};(grants.data||[]).forEach(x=>features[x.feature]=x.enabled);
    organizationFeatures={};tenantUserFeatures={};
    if(activeTenantId){
      const tenantGrants=await sb.rpc('tenant_feature_snapshot',{p_tenant:activeTenantId});
      if(tenantGrants.error){notice='Could not load organization application permissions.';session=null;await sb.auth.signOut();return;}
      organizationFeatures=tenantGrants.data?.organization||{};
      tenantUserFeatures=tenantGrants.data?.user||{};
    }
    state = 'in';
    const path=location.pathname; const needed=path.startsWith('/content-studio/')?'content_studio':path.startsWith('/portfolio-management/')?'portfolio_management':path.startsWith('/work-board/')?'work_board':path.startsWith('/knowledge-base/')?'knowledge_base':path.startsWith('/prompts/')?'prompt_library':path.startsWith('/training/')?'training':null; const extra=path.startsWith('/training/studio.')?'content_studio':path.startsWith('/training/curate.')?'use_case_curator':null; if((needed&&!hasFeature(needed))||(extra&&!hasFeature(extra))||(path.startsWith('/content-studio/')&&!(profile.is_admin||profile.is_superuser||profile.is_content_creator))){location.replace('/?access=denied');return;}
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
      const signedOutUserId = session?.user?.id;
      session = null; profile = null; state = 'out';
      gate.hidden = false; $('apForm').hidden = false; renderNav(); emit();
      try { sessionStorage.removeItem('ap-sess'); if (signedOutUserId) sessionStorage.removeItem('90s6-intro-launch:'+signedOutUserId); } catch (e) {}
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
    hasFeature,
    get activeTenantId() { return activeTenantId; },
    get tenantMemberships() { return [...tenantMemberships]; },
    tenantRole,
    isTenantAdmin,
    canCreateResources,
    setActiveTenant,
    signOut,
    onBeforeSignOut: cb => beforeOut.push(cb),
    onSession(cb) {
      listeners.push(cb);
      if (state !== 'unknown') cb(state === 'in' ? session : null, state === 'in' ? profile : null);
    }
  };
})();
