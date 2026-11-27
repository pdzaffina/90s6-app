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
  let session = null, profile = null, state = 'unknown', notice = ''; let tenantMemberships = [], activeTenantId = null; let features = {}, organizationFeatures = {}, tenantUserFeatures = {}; const featureNames=['portfolio_management','work_board','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator','action_inbox','crm','news_watch']; const hasFeature=k=>!!profile?.is_admin || ((!['action_inbox','crm','news_watch'].includes(k)||organizationFeatures[k]===true) && features[k] !== false && organizationFeatures[k] !== false && tenantUserFeatures[k] !== false);

  const tenantRole = (id = activeTenantId) => tenantMemberships.find(m => m.tenant_id === id)?.role || null;
  const isTenantAdmin = (id = activeTenantId) => !!profile?.is_admin || tenantRole(id) === 'tenant_admin';
  const canCreateResources = (id = activeTenantId) => !!profile?.is_admin || ['tenant_admin','superuser'].includes(tenantRole(id));
  function setActiveTenant(id) {
    if (!tenantMemberships.some(m => m.tenant_id === id)) throw new Error('Not a member of this tenant');
    activeTenantId = id;
    sessionStorage.setItem('90s6-active-tenant:' + profile.id, id);
    location.reload();
  }

  // Organization theme is scoped to the selected tenant and never cached across tenants.
  let organizationProfile=null;
  const applyOrganizationTheme=async()=>{
    organizationProfile=null;
    for(const [variable,value] of Object.entries({'--ap-blue':'#006BB6','--ap-midnight':'#0A192F','--ap-slate':'#708090'}))document.documentElement.style.setProperty(variable,value);
    if(activeTenantId){
      const {data,error}=await sb.from('organization_profiles').select('primary_color,secondary_color,accent_color,logo_data').eq('tenant_id',activeTenantId).maybeSingle();
      if(!error&&data){organizationProfile=data;
        if(data.primary_color)document.documentElement.style.setProperty('--ap-blue',data.primary_color);
        if(data.secondary_color)document.documentElement.style.setProperty('--ap-midnight',data.secondary_color);
        if(data.accent_color)document.documentElement.style.setProperty('--ap-slate',data.accent_color);
      }
    }
    window.dispatchEvent(new CustomEvent('organization-theme-changed',{detail:organizationProfile}));
  };
  window.addEventListener('organization-profile-updated',()=>applyOrganizationTheme());

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
  gate.classList.add('ap-pending');
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
      <a class="brand ap-wordmark" href="/" aria-label="90s6 home"><span>90</span><span class="ap-logo-s">s</span><span>6</span></a>
      <div class="ap-nav-account">
        <div class="ap-org-control"><span class="ap-org-label">ORGANIZATION</span><span class="ap-org-icon" aria-hidden="true">▦</span><select id="apTenantSelect" aria-label="Active organization"></select><span id="apTenantName" class="ap-tenant-name" hidden></span><span id="apOrgChevron" class="ap-org-chevron" aria-hidden="true">⌄</span></div>
        <div class="ap-user-menu"><button type="button" id="apUserButton" aria-expanded="false" aria-controls="apUserDropdown" aria-label="Account menu"><span id="apAvatar" class="ap-avatar">U</span><span class="who" id="apWho"></span><span class="ap-user-chevron" aria-hidden="true">⌄</span></button>
          <div id="apUserDropdown" class="ap-user-dropdown" hidden><a href="/profile/">My Profile</a><button type="button" id="apOut">Sign out</button></div>
        </div>
      </div>
    </div>
    <div class="ap-nav-bottom"><nav aria-label="Main navigation"><a href="/">Home</a><a href="/action-inbox/">Action Inbox</a><a href="/portfolio-management/">Portfolio Management</a><a href="/work-board/">Work Board</a><a href="/crm/">Relationships</a><a href="/news-watch/">News Watch</a><a href="/training/">Training</a><a href="/prompts/">Prompt Library</a><a href="/knowledge-base/">Knowledge Base</a><a href="/content-studio/" id="apStudioLink" hidden>Content Studio</a><a href="/tenant-admin/" id="apTenantAdminLink" hidden>Organization Admin</a><a href="/admin/" id="apAdminLink" hidden>Global Admin</a></nav></div>`;
  document.body.prepend(nav);

  // Unified navigation: preserve existing links and delegate local section actions to their original controls.
  const style=document.createElement('style');style.textContent="\nbody.ap-unified{padding-left:var(--ap-sidebar-width,220px)}\nbody.ap-unified.ap-collapsed{--ap-sidebar-width:58px}\n#appNav .ap-nav-top{padding:9px 18px}\n#appNav .ap-nav-bottom{position:fixed;top:64px;bottom:0;left:0;width:var(--ap-sidebar-width,220px);background:var(--ap-midnight);padding:12px 8px;overflow:auto;border:0;display:flex;flex-direction:column}\n#appNav .ap-nav-bottom nav{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:3px;overflow:visible;flex:1}\n#appNav nav .ap-group-label{font-size:10px;letter-spacing:1px;color:#a9bdd2;padding:15px 10px 5px}\n#appNav nav a,#appNav nav button{margin:0!important;color:#d5e0ec;text-align:left;white-space:normal;padding:9px 10px;border:0;display:flex;align-items:center;gap:9px;font-weight:600}\n#appNav nav a:hover,#appNav nav button:hover,#appNav nav [aria-current]{background:#ffffff20;color:white}\n#appNav nav .ap-parent{display:flex;align-items:center}\n#appNav nav .ap-parent a{flex:1;min-width:0}\n#appNav nav .ap-sub{padding-left:13px;margin-left:14px;border-left:1px solid #ffffff35}\n#appNav nav .ap-sub button{width:100%;font-size:12px;font-weight:500}\n#appNav .ap-nav-icon{width:19px;flex:none;text-align:center;font-size:17px}\n#appNav .ap-nav-toggle{margin-top:12px;text-align:left}\n#appNav .ap-mobile-toggle{display:none}\nbody.ap-collapsed #appNav .ap-nav-label,body.ap-collapsed #appNav .ap-group-label,body.ap-collapsed #appNav .ap-sub,body.ap-collapsed #appNav .ap-expand{display:none!important}\nbody.ap-unified .admin-workspace,body.ap-unified .crm-layout{grid-template-columns:minmax(0,1fr)}\nbody.ap-unified .ap-local-mirrored{display:none!important}\n@media(max-width:760px){body.ap-unified{padding-left:0}#appNav .ap-mobile-toggle{display:block}#appNav .ap-nav-bottom{display:none;width:min(280px,85vw);box-shadow:8px 0 25px #0004}body.ap-drawer #appNav .ap-nav-bottom{display:flex}#appNav .ap-nav-toggle{display:none}}\n";document.head.append(style);
  const sidebar=nav.querySelector('.ap-nav-bottom'), menu=sidebar.querySelector('nav');
  const groups=[['Workspace',[['/','⌂'],['/action-inbox/','◎'],['/work-board/','▤'],['/portfolio-management/','◫'],['/crm/','♧'],['/news-watch/','◎']]],['Resources',[['/knowledge-base/','▧'],['/prompts/','✧'],['/training/','▷'],['/content-studio/','✎']]],['Administration',[['/tenant-admin/','⚙'],['/admin/','◈']]]];
  const links=new Map(Array.from(menu.querySelectorAll('a')).map(a=>[a.getAttribute('href'),a]));
  const groupHeadings=[];
  let activeRow=null, activeSub=null, activeExpand=null;
  menu.replaceChildren();
  for(const [title,entries] of groups){
    const heading=el('div',{className:'ap-group-label',textContent:title,hidden:true});menu.append(heading);
    groupHeadings.push({heading,entries});
    for(const [href,symbol] of entries){
      const a=links.get(href);if(!a)continue;
      const label=a.textContent;a.replaceChildren(el('span',{className:'ap-nav-icon',textContent:symbol}),el('span',{className:'ap-nav-label',textContent:label}));a.title=label;a.setAttribute('aria-label',label);
      const row=el('div',{className:'ap-parent'},a);menu.append(row);
      if(href==='/'?location.pathname==='/':location.pathname.startsWith(href)){
        a.setAttribute('aria-current','page');activeRow=row;
        activeSub=el('div',{className:'ap-sub',hidden:true});activeExpand=el('button',{className:'ap-expand',type:'button',textContent:'⌄',hidden:true});activeExpand.setAttribute('aria-label','Toggle application sections');activeExpand.setAttribute('aria-expanded','true');
        activeExpand.addEventListener('click',()=>{activeSub.hidden=!activeSub.hidden;activeExpand.setAttribute('aria-expanded',String(!activeSub.hidden))});row.append(activeExpand);menu.append(activeSub);
      }
    }
  }
  const toggle=el('button',{className:'ap-nav-toggle',type:'button',textContent:'‹ Collapse'});sidebar.append(toggle);
  const mobile=el('button',{className:'ap-mobile-toggle',type:'button',textContent:'☰'});mobile.setAttribute('aria-label','Open navigation');mobile.setAttribute('aria-expanded','false');nav.querySelector('.ap-nav-top').prepend(mobile);
  function collapse(on){document.body.classList.toggle('ap-collapsed',on);toggle.textContent=on?'›':'‹ Collapse';toggle.setAttribute('aria-label',on?'Expand sidebar':'Collapse sidebar');try{localStorage.setItem('90s6-nav-collapsed',String(on))}catch(e){}}
  toggle.addEventListener('click',()=>collapse(!document.body.classList.contains('ap-collapsed')));
  mobile.addEventListener('click',()=>{collapse(false);const open=document.body.classList.toggle('ap-drawer');mobile.setAttribute('aria-expanded',String(open))});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.body.classList.remove('ap-drawer');mobile.setAttribute('aria-expanded','false')}});
  function syncSections(){
    if(!activeSub||activeRow?.hidden)return;
    const source=document.querySelector('.admin-nav,#crmNav,#tabs,.ainbox-tabs');
    if(!source)return;
    const controls=Array.from(source.querySelectorAll('button,a')).filter(b=>!b.hidden&&!b.disabled&&b.textContent.trim());
    if(!controls.length)return;
    const signature=JSON.stringify(controls.map(b=>[b.textContent.trim(),b.getAttribute('aria-current'),b.getAttribute('aria-selected'),b.className]));
    if(activeSub.dataset.signature===signature)return;
    activeSub.dataset.signature=signature;activeSub.replaceChildren();
    controls.forEach(b=>{const item=el('button',{type:'button',textContent:b.textContent.trim()});if(b.hasAttribute('aria-current')||b.getAttribute('aria-selected')==='true'||b.classList.contains('active'))item.setAttribute('aria-current','page');item.addEventListener('click',()=>{b.click();document.body.classList.remove('ap-drawer');mobile.setAttribute('aria-expanded','false');syncSections()});activeSub.append(item)});
    if(activeExpand.hidden){activeExpand.hidden=false;activeSub.hidden=false}
    (source.closest('.admin-sidebar')||source).classList.add('ap-local-mirrored');
  }
  const observer=new MutationObserver(records=>{if(records.some(r=>!nav.contains(r.target)))syncSections()});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','aria-current','aria-selected']});
  try{collapse(localStorage.getItem('90s6-nav-collapsed')==='true')}catch(e){}

  $('apOut').addEventListener('click', () => signOut());
  $('apUserButton').addEventListener('click', () => { const menu=$('apUserDropdown');menu.hidden=!menu.hidden;$('apUserButton').setAttribute('aria-expanded',String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!e.target.closest('#appNav .ap-user-menu')) { $('apUserDropdown').hidden=true;$('apUserButton').setAttribute('aria-expanded','false'); } });
  document.addEventListener('keydown', e => { if(e.key==='Escape'){$('apUserDropdown').hidden=true;$('apUserButton').setAttribute('aria-expanded','false');} });
  $('apTenantSelect').addEventListener('change', e => setActiveTenant(e.target.value));

  function renderNav() {
    nav.hidden = state !== 'in';
    document.body.classList.toggle('ap-unified',state==='in');
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
    [['/portfolio-management/','portfolio_management'],['/work-board/','work_board'],['/training/','training'],['/prompts/','prompt_library'],['/knowledge-base/','knowledge_base'],['/action-inbox/','action_inbox'],['/crm/','crm'],['/news-watch/','news_watch']].forEach(([href,key])=>{const a=nav.querySelector('a[href="'+href+'"]');if(a)a.hidden=!hasFeature(key)});
    for(const a of links.values())a.parentElement.hidden=a.hidden;
    for(const {heading,entries} of groupHeadings){
      heading.hidden=!entries.some(([href])=>{const a=links.get(href);return a&&!a.hidden&&!a.parentElement.hidden;});
    }
    if(activeSub&&activeRow?.hidden)activeSub.hidden=true;
    syncSections();
    $('apWho').textContent = profile.full_name || profile.email || '';
    $('apAvatar').textContent=(profile.full_name || profile.email || 'U').split(/[\\s@]+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('');
  }

  // ---------- Session handling ----------
  const emit = () => listeners.forEach(cb => cb(state === 'in' ? session : null, state === 'in' ? profile : null));

  async function handle(s) {
    if (!s) {
      const signedOutUserId = session?.user?.id;
      session = null; profile = null; tenantMemberships=[]; activeTenantId=null; state = 'out';
      gate.classList.remove('ap-pending'); gate.hidden = false; $('apForm').hidden = false; msg(notice, !!notice); notice = '';
      renderNav(); emit(); return;
    }
    if (session && session.user.id === s.user.id) { session = s; return; } // token refresh
    session = s;
    $('apForm').hidden = true; gate.classList.add('ap-pending'); gate.hidden = false; msg('');
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
    await applyOrganizationTheme();
    state = 'in';
    const path=location.pathname; const needed=path.startsWith('/content-studio/')?'content_studio':path.startsWith('/portfolio-management/')?'portfolio_management':path.startsWith('/work-board/')?'work_board':path.startsWith('/knowledge-base/')?'knowledge_base':path.startsWith('/action-inbox/')?'action_inbox':path.startsWith('/news-watch/')?'news_watch':path.startsWith('/crm/')?'crm':path.startsWith('/prompts/')?'prompt_library':path.startsWith('/training/')?'training':null; const extra=path.startsWith('/training/studio.')?'content_studio':path.startsWith('/training/curate.')?'use_case_curator':null; if((needed&&!hasFeature(needed))||(extra&&!hasFeature(extra))||(path.startsWith('/content-studio/')&&!(profile.is_admin||profile.is_superuser||profile.is_content_creator))){location.replace('/?access=denied');return;}
    sb.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', s.user.id).then(() => {});
    try {
      if (sessionStorage.getItem('ap-sess') !== s.user.id) {
        sessionStorage.setItem('ap-sess', s.user.id);
        sb.rpc('log_event', { p_action: 'auth.sign_in' }).then(() => {});
      }
    } catch (e) {}
    gate.hidden = true; gate.classList.remove('ap-pending'); renderNav(); emit();
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
    get organizationProfile() { return organizationProfile; },
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
