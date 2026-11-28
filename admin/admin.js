/* Admin: invite and manage users. All privileged work happens in the admin-users Edge Function. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...kids); return n; };
  let me = null; let organizationsByUser=new Map(), allOrganizations=[];

  const say = (t, err) => { const m = $('adminMsg'); m.textContent = t || ''; m.className = 'ap-msg' + (err ? ' err' : ''); };

  async function call(action, payload = {}) {
    const { data, error } = await App.sb.functions.invoke('admin-users', { body: { action, ...payload } });
    if (error) {
      let m = error.message;
      try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (e) {}
      throw new Error(m);
    }
    return data;
  }

  async function act(action, payload, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    try { await call(action, payload); await load(); }
    catch (e) { say(e.message, true); }
  }

  async function loadScopes() {
    const { data, error } = await App.sb.from('tenants').select('id,name,slug').order('name');
    if (error) throw error;
    allOrganizations=data||[]; const select = $('adminScope');
    for (const t of data || []) { const o=document.createElement('option'); o.value=t.id; o.textContent=t.name+' ('+t.slug+')'; select.append(o); const g=document.createElement('option');g.value=t.id;g.textContent=t.name+' ('+t.slug+')';$('globalOrgFeatureTenant').append(g); const a=document.createElement('option'); a.value=t.id; a.textContent=t.name; $('assignOrganization').append(a); }
    select.addEventListener('change',()=>{ if(select.value!=='global') location.href='/tenant-admin/?tenant='+encodeURIComponent(select.value); });
  }

  const fmt = d => (d ? new Date(d).toLocaleString() : 'Never');

  function organizationPicker(user) {
    const td=el('td');
    const picker=el('div',{className:'org-multi'});
    const trigger=el('div',{className:'org-multi-trigger'});
    const tags=el('div',{className:'org-multi-tags'});
    const toggle=el('button',{type:'button',className:'org-multi-toggle',textContent:'▾',title:'Choose organizations','aria-label':'Choose organizations'});
    const menu=el('div',{className:'org-multi-menu',hidden:true});
    const selectAll=el('label',{className:'org-multi-option org-multi-all'});
    const allCheck=el('input',{type:'checkbox'});
    selectAll.append(allCheck,document.createTextNode(' Select all ('+allOrganizations.length+')'));
    menu.append(selectAll);
    const checks=new Map();
    let busy=false;
    const memberships=()=>organizationsByUser.get(user.id)||[];
    const active=id=>memberships().some(m=>m.tenant_id===id&&m.status==='active');
    function renderTags(){
      tags.replaceChildren();
      const chosen=allOrganizations.filter(o=>active(o.id));
      if(!chosen.length)tags.append(el('span',{className:'org-multi-placeholder',textContent:'Choose organizations'}));
      for(const org of chosen){
        const chip=el('span',{className:'org-multi-chip'});
        const remove=el('button',{type:'button',className:'org-multi-remove',textContent:'×',title:'Remove '+org.name,'aria-label':'Remove '+org.name});
        remove.onclick=()=>change(org,false);
        chip.append(document.createTextNode(org.name+(memberships().find(m=>m.tenant_id===org.id)?.role==='tenant_admin'?' (Org Admin)':'')),remove);tags.append(chip);
      }
      allCheck.checked=allOrganizations.length>0&&chosen.length===allOrganizations.length;
      allCheck.indeterminate=chosen.length>0&&chosen.length<allOrganizations.length;
      for(const org of allOrganizations){checks.get(org.id).checked=active(org.id);const role=checks.get(org.id).parentElement.querySelector('select');if(role){role.disabled=!active(org.id);role.value=memberships().find(m=>m.tenant_id===org.id)?.role||'user';}}
    }
    async function change(org,enabled){
      if(busy||active(org.id)===enabled)return;
      busy=true;picker.classList.add('org-multi-busy');
      try{
        const {error}=await App.sb.rpc('global_set_user_organization',{p_user:user.id,p_tenant:org.id,p_active:enabled});
        if(error)throw error;
        const rest=memberships().filter(m=>m.tenant_id!==org.id);
        rest.push({tenant_id:org.id,name:org.name,role:memberships().find(m=>m.tenant_id===org.id)?.role||'user',status:enabled?'active':'inactive'});
        organizationsByUser.set(user.id,rest);
        say((enabled?'Added ':'Removed ')+user.email+(enabled?' to ':' from ')+org.name);
      }catch(err){say(err.message,true);}
      finally{busy=false;picker.classList.remove('org-multi-busy');renderTags();}
    }
    for(const org of allOrganizations){
      const label=el('label',{className:'org-multi-option'});
      const check=el('input',{type:'checkbox'});
      checks.set(org.id,check);
      check.onchange=()=>change(org,check.checked);
      label.append(check,document.createTextNode(' '+org.name+' '));
      const role=document.createElement('select');role.className='ap-input';role.setAttribute('aria-label','Role in '+org.name);
      for(const [value,name] of [['user','User'],['superuser','Superuser'],['tenant_admin','Org Admin']]){const o=document.createElement('option');o.value=value;o.textContent=name;role.append(o);}
      role.value=memberships().find(m=>m.tenant_id===org.id)?.role||'user';
      role.disabled=!active(org.id);
      role.onchange=async()=>{
        const old=memberships().find(m=>m.tenant_id===org.id)?.role||'user';
        role.disabled=true;
        const {error}=await App.sb.rpc('global_bulk_manage_tenant_members',{p_tenant:org.id,p_users:[user.id],p_action:'assign',p_role:role.value,p_active:true});
        if(error){role.value=old;say(error.message,true);}
        else{const m=memberships().find(m=>m.tenant_id===org.id);if(m)m.role=role.value;renderTags();say('Updated organization role for '+user.email);}
        role.disabled=!active(org.id);
      };
      label.append(role);menu.append(label);
    }
    allCheck.onchange=async()=>{
      const desired=allCheck.checked;
      for(const org of allOrganizations)if(active(org.id)!==desired)await change(org,desired);
      renderTags();
    };
    toggle.onclick=()=>{menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));};
    picker.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});
    document.addEventListener('click',e=>{if(!picker.contains(e.target)){menu.hidden=true;toggle.setAttribute('aria-expanded','false');}});
    trigger.append(tags,toggle);picker.append(trigger,menu);td.append(picker);renderTags();return td;
  }

  function render(users) {
    const body = $('userRows'); body.replaceChildren();
    window.adminUsers = users; window.dispatchEvent(new CustomEvent('admin-users-loaded',{detail:users}));
    users.forEach(u => {
      const isMe = u.id === me.id;
      const status = u.disabled ? el('span', { className: 'ap-tag off', textContent: 'Disabled' })
        : !u.last_seen_at ? el('span', { className: 'ap-tag dim', textContent: 'Invited' })
        : el('span', { className: 'ap-tag', textContent: 'Active' });
      const actions = el('div', { className: 'ap-row' });
      const intro = el('button',{type:'button',className:'ap-btn sm',textContent:'Welcome presentation: '+(u.intro_presentation_enabled?'On':'Off')});
      intro.onclick=async()=>{intro.disabled=true;const {error}=await App.sb.rpc('set_intro_presentation',{p_user:u.id,p_enabled:!u.intro_presentation_enabled});if(error){say(error.message);intro.disabled=false;return;}u.intro_presentation_enabled=!u.intro_presentation_enabled;intro.textContent='Welcome presentation: '+(u.intro_presentation_enabled?'On':'Off');intro.disabled=false;};
      actions.append(intro); const tours=el('button',{type:'button',className:'ap-btn sm',textContent:'Application tours'});tours.onclick=()=>window.openUserTours(u);actions.append(tours);
      if (isMe) actions.append(el('span', { className: 'ap-msg', textContent: 'You' }));
      else {
        const btn = (text, cls, fn) => { const b = el('button', { type: 'button', className: 'ap-btn sm ' + cls, textContent: text }); b.addEventListener('click', fn); return b; };
        actions.append(
          btn(u.is_admin ? 'Remove admin' : 'Make admin', '', () => act('set_admin', { id: u.id, is_admin: !u.is_admin })),
          btn(u.is_superuser ? 'Remove superuser' : 'Make superuser', '', () => act('set_superuser', { id: u.id, is_superuser: !u.is_superuser })),
          btn(u.disabled ? 'Enable' : 'Disable', '', () => act('set_disabled', { id: u.id, disabled: !u.disabled })),
                    btn('Reset intro', '', () => act('reset_onboarding', { id: u.id, kind: 'intro' }).then(() => say('Intro presentation reset for ' + u.email + '.'))),
          btn('Delete', 'danger', () => act('delete_user', { id: u.id }, 'Delete ' + u.email + '? This cannot be undone.'))
        );
      }
      const pick=el('input',{type:'checkbox',className:'feature-user-check',value:u.id});pick.addEventListener('change',()=>window.dispatchEvent(new Event('feature-selection-changed')));
      body.append(el('tr', {},
        el('td', {},pick),
        el('td', { textContent: u.email || '' }),
        el('td', { textContent: u.full_name || '' }),
        el('td', {}, el('span', { className: 'ap-tag' + (u.is_admin ? '' : ' dim'), textContent: u.is_admin ? 'Admin' : u.is_superuser ? 'Superuser' : 'User' })),
        organizationPicker(u),
        el('td', {}, status),
        el('td', { textContent: u.owned + ' owned, ' + u.shared + ' shared' }),
        el('td', { textContent: fmt(u.last_seen_at) }),
        el('td', {}, actions)));
    });
  }

  async function load() {
    say('Loading...');
    try { const { users } = await call('list'); const {data:roles}=await App.sb.from('profiles').select('id,is_content_creator,intro_presentation_enabled'); for(const u of users)u.intro_presentation_enabled=(roles||[]).find(x=>x.id===u.id)?.intro_presentation_enabled===true; const roleMap=new Map((roles||[]).map(x=>[x.id,x.is_content_creator]));
      const {data:membershipData,error:membershipError}=await App.sb.from('tenant_members').select('user_id,tenant_id,role,status,tenants(name)').order('created_at');
      if(membershipError)throw membershipError;
      organizationsByUser=new Map();
      for(const m of membershipData||[]){
        const a=organizationsByUser.get(m.user_id)||[];
        a.push({tenant_id:m.tenant_id,name:m.tenants?.name||'Unknown',role:m.role,status:m.status});
        organizationsByUser.set(m.user_id,a);
      }
      users.forEach(u=>u.is_content_creator=!!roleMap.get(u.id));render(users); say(users.length + ' users'); }
    catch (e) { say(e.message, true); }
  }

  const updateBulkMembershipControls=()=>{
    const remove=$('assignAction').value==='remove';
    $('assignRole').disabled=remove;
    $('assignActive').disabled=remove;
    $('assignUsersOrg').textContent=remove?'Remove selected users':'Apply to selected users';
  };
  $('assignAction').addEventListener('change',updateBulkMembershipControls);
  updateBulkMembershipControls();
  $('assignUsersOrg').onclick=async()=>{
    const ids=Array.from(document.querySelectorAll('.feature-user-check:checked'),x=>x.value);
    const tenant=$('assignOrganization').value,role=$('assignRole').value;
    const action=$('assignAction').value,active=$('assignActive').value==='active';
    const msg=$('assignUsersMsg');
    if(!tenant||!ids.length){msg.textContent='Select users and an organization.';return;}
    const description=action==='remove'?'Remove organization access for':(active?'Activate or assign':'Assign as inactive');
    if(!confirm(description+' '+ids.length+' selected user(s)? Global account access will not change.'))return;
    $('assignUsersOrg').disabled=true;
    try{
      const {data,error}=await App.sb.rpc('global_bulk_manage_tenant_members',{p_tenant:tenant,p_users:ids,p_action:action,p_role:role,p_active:active});
      if(error)throw error;
      msg.textContent=data+' organization memberships '+(action==='remove'?'deactivated':active?'activated or assigned':'set inactive')+'.';
      await load();
    }catch(e){msg.textContent='Membership update failed: '+e.message;}
    finally{$('assignUsersOrg').disabled=false;}
  };
  $('inviteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('inviteEmail').value.trim();
    if (!email) return;
    say('Sending invitation...');
    try { await call('invite', { email }); $('inviteEmail').value = ''; say('Invitation sent to ' + email + '.'); await load(); }
    catch (err) { say(err.message, true); }
  });


  // CSV stays in memory only. Never display, persist or log password values.
  let bulkUsers = [];
  function parseCsv(input) {
    const rows = []; let row = [], field = '', quoted = false;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (quoted) {
        if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') {
        if (field.trim()) throw new Error('Invalid CSV quoting.');
        quoted = true;
      } else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && input[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v.trim())) rows.push(row);
        row = [];
      } else field += c;
    }
    if (quoted) throw new Error('Unclosed CSV quote.');
    row.push(field); if (row.some(v => v.trim())) rows.push(row);
    return rows;
  }
  const bulkSay = (message, error = false) => {
    $('bulkMsg').textContent = message;
    $('bulkMsg').className = 'ap-msg' + (error ? ' err' : '');
  };
  $('bulkTemplate').addEventListener('click', () => {
    // Three short sample rows show all roles and both active values.
    const csv = [
      'email,full_name,password,role,active,organization',
      'new.user@example.com,Example User,ChangeMe2026!user,user,Y,90s6',
      'new.superuser@example.com,Example Superuser,ChangeMe2026!super,superuser,N,90s6',
      'new.tenantadmin@example.com,Example Tenant Admin,ChangeMe2026!tenant,tenant_admin,Y,90s6',
      'new.admin@example.com,Example Global Admin,ChangeMe2026!admin,admin,Y,global'
    ].join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a', { href: url, download: '90s6-bulk-users-template.csv' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('bulkCsv').addEventListener('change', async () => {
    bulkUsers = []; $('bulkCreate').disabled = true;
    $('bulkRows').replaceChildren(); $('bulkPreview').hidden = true;
    const file = $('bulkCsv').files[0]; if (!file) return;
    try {
      if (file.size > 256 * 1024) throw new Error('CSV must be under 256 KB.');
      const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
      const header = (rows.shift() || []).map(x => x.trim().toLowerCase());
      for (const name of ['email', 'full_name', 'password', 'role', 'active', 'organization']) {
        if (!header.includes(name)) throw new Error('Missing CSV column: ' + name);
      }
      if (rows.length < 1 || rows.length > 100) throw new Error('Upload 1 to 100 users per batch.');
      const seen = new Set();
      bulkUsers = rows.map((values, i) => {
        if (values.length !== header.length) throw new Error('Wrong number of columns on data row ' + (i + 2));
        const u = Object.fromEntries(header.map((key, j) => [key, values[j]]));
        u.email = u.email.trim().toLowerCase();
        u.full_name = u.full_name.trim(); u.role = u.role.trim().toLowerCase(); u.active = u.active.trim().toUpperCase(); u.organization = u.organization.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) throw new Error('Invalid email on row ' + (i + 2));
        if (seen.has(u.email+':'+u.organization)) throw new Error('Duplicate email on row ' + (i + 2));
        if (!['user', 'superuser', 'tenant_admin', 'admin'].includes(u.role)) throw new Error('Invalid role on row ' + (i + 2));
        if (!['Y', 'N'].includes(u.active)) throw new Error('Active must be Y or N on row ' + (i + 2));
        if (u.password && u.password.length < 12) throw new Error('Password must be at least 12 characters when supplied on row ' + (i + 2));
        if (!u.organization || (u.organization !== 'global' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(u.organization)) || (u.organization === 'global' && u.role !== 'admin') || (u.organization !== 'global' && u.role === 'admin')) throw new Error('Invalid organization and role combination on row '+(i+2));
        seen.add(u.email+':'+u.organization); return u;
      });
      bulkUsers.forEach(u => $('bulkRows').append(el('tr', {},
        el('td', { textContent: u.email }), el('td', { textContent: u.full_name }),
        el('td', { textContent: u.role }), el('td', { textContent: u.active }), el('td', { textContent: u.organization }), el('td', { textContent: 'Ready' }))));
      $('bulkPreview').hidden = false; $('bulkCreate').disabled = false;
      bulkSay(bulkUsers.length + ' users ready. Review before applying.');
    } catch (err) { bulkUsers = []; bulkSay(err.message, true); }
  });
  $('bulkCreate').addEventListener('click', async () => {
    if (!bulkUsers.length || !confirm('Apply ' + bulkUsers.length + ' user rows? Organization rows update membership only. Global rows may change account status.')) return;
    $('bulkCreate').disabled = true;
    bulkSay('Applying changes...');
    try {
      const { results } = await call('bulk_create', { users: bulkUsers });
      let success = 0, updated = 0, skipped = 0, failed = 0;
      (results || []).forEach((r, i) => {
        const status = r.status === 'created' ? 'Created' : r.status === 'updated' ? 'Updated' : r.status === 'skipped' ? 'Skipped' : 'Failed';
        if (r.status === 'created') success++; else if (r.status === 'updated') updated++; else if (r.status === 'skipped') skipped++; else failed++;
        $('bulkRows').rows[i].cells[5].textContent = status + (r.error ? ': ' + r.error : '');
      });
      bulkSay(success + ' created, ' + updated + ' updated, ' + skipped + ' skipped, ' + failed + ' failed.');
      bulkUsers = []; $('bulkCsv').value = '';
      await load();
    } catch (err) { bulkSay(err.message, true); }
    finally { bulkUsers = []; $('bulkCreate').disabled = true; }
  });

  // ---------- Audit log ----------
  let auditRows = [], auditMore = false;
  const auditSay = (t, err) => { const m = $('auditMsg'); m.textContent = t || ''; m.className = 'ap-msg' + (err ? ' err' : ''); };

  const auditDetailValue = value => {
    if(value === null || value === undefined)return 'Not recorded';
    if(typeof value === 'object')return JSON.stringify(value,null,2);
    return String(value);
  };
  function auditEntry(r) {
    const row=el('tr');
    const detailRow=el('tr',{hidden:true});
    const detailCell=el('td',{colSpan:4});
    const panel=el('div',{className:'audit-detail-panel'});
    const add=(label,value)=>{
      const section=el('div',{className:'audit-detail-item'});
      section.append(el('strong',{textContent:label}),el('pre',{textContent:auditDetailValue(value)}));
      panel.append(section);
    };
    add('Action',r.action);
    if(r.target)add('Affected record',r.target);
    if(r.board_id)add('Board ID',r.board_id);
    if(r.actor_id)add('Actor ID',r.actor_id);
    const detail=r.detail && typeof r.detail==='object'?r.detail:{};
    const changes=detail.changes||detail.before&&detail.after&&{before:detail.before,after:detail.after};
    if(changes)add('Recorded changes',changes);
    for(const [key,value] of Object.entries(detail)){
      if(['changes','before','after'].includes(key))continue;
      add(key.replace(/_/g,' '),value);
    }
    if(detail.before)add('Before',detail.before);
    if(detail.after)add('After',detail.after);
    if(!Object.keys(detail).length)add('Additional details','This event did not record field-level changes.');
    const button=el('button',{type:'button',className:'ap-btn sm',textContent:'Details','aria-expanded':'false'});
    button.onclick=()=>{
      detailRow.hidden=!detailRow.hidden;
      button.textContent=detailRow.hidden?'Details':'Hide';
      button.setAttribute('aria-expanded',String(!detailRow.hidden));
    };
    row.append(el('td',{textContent:Audit.when(r.at)}),el('td',{textContent:Audit.who(r)}),el('td',{textContent:Audit.describe(r)}),el('td',{},button));
    detailCell.append(panel);detailRow.append(detailCell);
    return [row,detailRow];
  }
  async function loadAudit(reset) {
    if (reset) { auditRows = []; $('auditRows').replaceChildren(); }
    auditSay('Loading...');
    try {
      const before = auditRows.length ? auditRows[auditRows.length - 1].id : undefined;
      const { rows, more } = await call('audit', { prefix: $('auditPrefix').value, actor: $('auditActor').value.trim(), before, limit: 100 });
      rows.forEach(r => {
        auditRows.push(r);
        $('auditRows').append(...auditEntry(r));
      });
      auditMore = more; $('auditMore').hidden = !more;
      auditSay(auditRows.length ? auditRows.length + ' events shown. Expand Details to see recorded fields.' : 'No events match.');
    } catch (e) { auditSay(e.message, true); }
  }
  $('auditForm').addEventListener('submit', e => { e.preventDefault(); loadAudit(true); });
  $('auditMore').addEventListener('click', () => loadAudit(false));
  $('auditCsv').addEventListener('click', () => {
    // Prefix risky leading characters so spreadsheets never run a cell as a formula
    const cell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const lines = [['time', 'who', 'action', 'description', 'board_id'].map(cell).join(',')]
      .concat(auditRows.map(r => [r.at, Audit.who(r), r.action, Audit.describe(r), r.board_id].map(cell).join(',')));
    const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' })), download: 'audit-log-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.append(a); a.click(); a.remove();
  });

  App.onSession((session, profile) => {
    if (!session) return;
    const ok = !!profile.is_admin;
    $('denied').hidden = ok; $('adminBody').hidden = !ok;
    if (ok) { me = session.user; loadScopes().then(()=>load()).catch(e=>say(e.message,true)); loadAudit(true); }
  });
})();
