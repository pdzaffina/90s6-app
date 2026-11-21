/* Admin: invite and manage users. All privileged work happens in the admin-users Edge Function. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...kids); return n; };
  let me = null;

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

  const fmt = d => (d ? new Date(d).toLocaleString() : 'Never');

  function render(users) {
    const body = $('userRows'); body.replaceChildren();
    users.forEach(u => {
      const isMe = u.id === me.id;
      const status = u.disabled ? el('span', { className: 'ap-tag off', textContent: 'Disabled' })
        : !u.last_seen_at ? el('span', { className: 'ap-tag dim', textContent: 'Invited' })
        : el('span', { className: 'ap-tag', textContent: 'Active' });
      const actions = el('div', { className: 'ap-row' });
      if (isMe) actions.append(el('span', { className: 'ap-msg', textContent: 'You' }));
      else {
        const btn = (text, cls, fn) => { const b = el('button', { type: 'button', className: 'ap-btn sm ' + cls, textContent: text }); b.addEventListener('click', fn); return b; };
        actions.append(
          btn(u.is_admin ? 'Remove admin' : 'Make admin', '', () => act('set_admin', { id: u.id, is_admin: !u.is_admin })),
          btn(u.is_superuser ? 'Remove superuser' : 'Make superuser', '', () => act('set_superuser', { id: u.id, is_superuser: !u.is_superuser })),
          btn(u.disabled ? 'Enable' : 'Disable', '', () => act('set_disabled', { id: u.id, disabled: !u.disabled })),
          btn('Delete', 'danger', () => act('delete_user', { id: u.id }, 'Delete ' + u.email + '? This cannot be undone.'))
        );
      }
      body.append(el('tr', {},
        el('td', { textContent: u.email || '' }),
        el('td', { textContent: u.full_name || '' }),
        el('td', {}, el('span', { className: 'ap-tag' + (u.is_admin ? '' : ' dim'), textContent: u.is_admin ? 'Admin' : u.is_superuser ? 'Superuser' : 'User' })),
        el('td', {}, status),
        el('td', { textContent: u.owned + ' owned, ' + u.shared + ' shared' }),
        el('td', { textContent: fmt(u.last_seen_at) }),
        el('td', {}, actions)));
    });
  }

  async function load() {
    say('Loading...');
    try { const { users } = await call('list'); const {data:roles}=await App.sb.from('profiles').select('id,is_content_creator'); const roleMap=new Map((roles||[]).map(x=>[x.id,x.is_content_creator]));users.forEach(u=>u.is_content_creator=!!roleMap.get(u.id));render(users); say(users.length + ' users'); }
    catch (e) { say(e.message, true); }
  }

  $('inviteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('inviteEmail').value.trim();
    if (!email) return;
    say('Sending invitation...');
    try { await call('invite', { email }); $('inviteEmail').value = ''; say('Invitation sent to ' + email + '.'); await load(); }
    catch (err) { say(err.message, true); }
  });

  // ---------- Audit log ----------
  let auditRows = [], auditMore = false;
  const auditSay = (t, err) => { const m = $('auditMsg'); m.textContent = t || ''; m.className = 'ap-msg' + (err ? ' err' : ''); };

  async function loadAudit(reset) {
    if (reset) { auditRows = []; $('auditRows').replaceChildren(); }
    auditSay('Loading...');
    try {
      const before = auditRows.length ? auditRows[auditRows.length - 1].id : undefined;
      const { rows, more } = await call('audit', { prefix: $('auditPrefix').value, actor: $('auditActor').value.trim(), before, limit: 100 });
      rows.forEach(r => {
        auditRows.push(r);
        $('auditRows').append(el('tr', {}, el('td', { textContent: Audit.when(r.at) }), el('td', { textContent: Audit.who(r) }), el('td', { textContent: Audit.describe(r) })));
      });
      auditMore = more; $('auditMore').hidden = !more;
      auditSay(auditRows.length ? auditRows.length + ' events shown' : 'No events match.');
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
    if (ok) { me = session.user; load(); loadAudit(true); }
  });
})();
