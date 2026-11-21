/* Work Board: multiple boards, sharing, and attachments on top of the shared App.
   Loads AFTER board.js and /shared/app.js. */
(() => {
  'use strict';

  const CACHE_KEY = 'work-chunks-board-v1';
  const CURRENT_KEY = 'wc-current-board';
  const BUCKET = 'attachments';

  const board = window.WCBoard;
  const hooks = window.WCHooks;
  if (!board || !hooks || !window.App) {
    console.error('work-board: board hooks or shared App missing');
    return;
  }

  const sb = window.App.sb;
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...kids); return n; };
  const toast = m => board.toast(m);

  let user = null, boards = [], current = null, lastSeen = null;
  let ready = false, timer = null, pending = null, chain = Promise.resolve();
  const canEdit = () => !!current && current.role !== 'viewer';

  // ---------- Styles ----------
  document.head.append(el('style', { textContent: `
    #wcAuth{position:fixed;inset:0;z-index:50;background:#e9edef;display:flex;align-items:center;justify-content:center;padding:16px}
    #wcAuth [hidden],#wcAuth[hidden]{display:none!important}
    .wcCard{background:#fff;border:1px solid #d0d9de;border-radius:16px;padding:26px;width:min(400px,100%);box-shadow:0 10px 34px #26344116}
    .wcCard h2{font:700 26px system-ui,sans-serif;margin:0 0 4px;letter-spacing:-.4px}
    .wcCard p{margin:0 0 16px;color:#647380;font-size:13px}
    #wcAuth form{padding:0}
    .wcRow{display:flex;gap:8px;align-items:center}
    .wcRow>*{flex:1;min-width:0}
    .wcRow>select{flex:0 0 auto}
    #wcAuth .wcRow{margin-bottom:10px}
    #wcManage{max-height:90vh;overflow-y:auto}
    #wcManage .field input,#wcManage .field select{font:inherit;min-height:42px;position:relative;z-index:1}
    #wcManage .wcRow{flex-wrap:wrap}
    #wcManage .wcRow input{flex:2 1 190px}
    #wcManage .wcRow select{flex:1 1 125px}
    #wcManage .wcRow button{flex:0 0 auto}
    #wcMsg{margin:14px 0 0;min-height:18px}#wcMsg.err{color:#a43131}
    #boardSelect{padding:9px 10px;border:1px solid #c9d1d8;border-radius:9px;background:#fff;font-weight:600;max-width:220px}
    #boardBadge{font-size:12px;font-weight:700;color:#52606b}
    :is(#wcManage,#wcActivity,#wcLayout) .wcBody{padding:16px 23px 22px}
    :is(#wcManage,#wcActivity,#wcLayout) .wcList{display:flex;flex-direction:column;gap:6px}
    :is(#wcManage,#wcActivity,#wcLayout) .wcPerson{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #d6dfe4;border-radius:8px;background:#fff;font-size:13px}
    :is(#wcManage,#wcActivity,#wcLayout) .wcPerson span{flex:1;overflow-wrap:anywhere}
    :is(#wcManage,#wcActivity,#wcLayout) .wcPerson small{color:#647380}
    .wcMuted{color:#647380;font-size:13px}
    .wcLayRow{flex:1;display:flex;flex-direction:column;gap:4px;min-width:0}
    #wcActList .wcPerson{flex-direction:column;align-items:flex-start;gap:2px}
    body.readonly .add-inline,body.readonly .chunk .edit,body.readonly #newBtn,body.readonly #resetBtn,body.readonly .fileLabel{display:none!important}
    #wcAtt[hidden],#wcAtt [hidden]{display:none!important}
    #wcAtt .wcFile{display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid #d6dfe4;border-radius:8px;background:#fff;font-size:13px;margin-bottom:6px}
    #wcAtt .wcFile span{flex:1;overflow-wrap:anywhere}
  ` }));

  // ---------- Sign in gate ----------
  const gate = el('div', { id: 'wcAuth' });
  gate.innerHTML = `
    <div class="wcCard">
      <h2>Work Board</h2>
      <p id="wcLead"></p>
      <div id="wcNone" class="wcRow" hidden><button class="primary" type="button" id="wcCreateFirst">Create a board</button><button type="button" id="wcOutNone">Sign out</button></div>
      <p id="wcMsg" role="status"></p>
    </div>`;
  document.body.append(gate);

  function showGate(mode) {
    gate.hidden = !mode;
    $('wcNone').hidden = mode !== 'none';
    $('wcLead').textContent = ({
      error: 'Could not load your boards. Reload to try again.',
      loading: 'Loading your boards...',
      none: 'No boards yet. Ask the owner to share one with your email, or create your own.'
    })[mode] || '';
    msg('');
  }
  function msg(text, isErr) { const m = $('wcMsg'); m.textContent = text || ''; m.className = isErr ? 'err' : ''; }
  // ---------- Toolbar ----------
  const sel = el('select', { id: 'boardSelect' });
  sel.setAttribute('aria-label', 'Board');
  const badge = el('span', { id: 'boardBadge' });
  const newBoardBtn = el('button', { type: 'button', textContent: '+ Board' });
  const manageBtn = el('button', { type: 'button', textContent: 'Share / manage' });
  const layoutBtn = el('button', { type: 'button', textContent: 'Layout' });
  const bar = [sel, badge, newBoardBtn, manageBtn, layoutBtn];
  document.querySelector('.toolbar').prepend(...bar);
  const showBar = on => bar.forEach(n => (n.hidden = !on));
  showBar(false);

  function renderBar() {
    sel.replaceChildren(...boards.map(b => {
      const o = el('option', { value: b.id, textContent: b.name + (b.role === 'owner' ? '' : ' (shared)') });
      o.selected = !!current && b.id === current.id;
      return o;
    }));
    badge.textContent = !current || current.role === 'owner' ? '' : current.role === 'viewer' ? 'View only' : 'Can edit';
    manageBtn.hidden = !(current && current.role === 'owner');
    layoutBtn.hidden = manageBtn.hidden;
  }

  // ---------- Data ----------
  async function loadBoards() {
    await sb.rpc('claim_invites'); // turns pending invites for this email into access
    const [b, m] = await Promise.all([
      sb.from('boards').select('id,name,owner_id').order('name'),
      sb.from('board_members').select('board_id,role').eq('user_id', user.id)
    ]);
    if (b.error || m.error) throw (b.error || m.error);
    const roles = new Map(m.data.map(r => [r.board_id, r.role]));
    boards = b.data.map(x => ({ ...x, role: x.owner_id === user.id ? 'owner' : (roles.get(x.id) || 'viewer') }));
  }

  async function openBoard(id, skipFlush) {
    if (!skipFlush) await flush();
    ready = false;
    const { data, error } = await sb.from('boards').select('id,name,data,config,updated_at').eq('id', id).maybeSingle();
    if (error || !data) { toast('Could not open that board.'); return false; }
    current = boards.find(b => b.id === id);
    current.name = data.name;
    lastSeen = data.updated_at;
    try { localStorage.setItem(CURRENT_KEY, id); } catch (e) {}
    document.body.classList.toggle('readonly', current.role === 'viewer');
    board.set(Array.isArray(data.data) ? data.data : [], data.config);
    renderBar();
    ready = true;
    return true;
  }

  async function doFlush() {
    clearTimeout(timer); timer = null;
    if (!pending || !current) return;
    const rows = pending; pending = null;
    const { data, error } = await sb.from('boards')
      .update({ data: rows, updated_at: new Date().toISOString() })
      .eq('id', current.id).eq('updated_at', lastSeen).select('updated_at');
    if (error) return toast('Cloud save failed: ' + error.message);
    if (!data.length) {
      toast('Someone else changed this board. Loaded the latest, please redo your last edit.');
      return void (await openBoard(current.id, true));
    }
    lastSeen = data[0].updated_at;
  }
  const flush = () => (chain = chain.then(doFlush));

  hooks.onSave = rows => {
    if (!ready || !canEdit()) return;
    pending = rows;
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  };

  // Pick up other people's edits when you come back to the tab
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !ready || timer || pending) return;
    const { data } = await sb.from('boards').select('updated_at').eq('id', current.id).maybeSingle();
    if (data && data.updated_at !== lastSeen) openBoard(current.id, true);
  });

  // ---------- Board actions ----------
  async function createBoard() {
    const name = (prompt('Board name (for example, the client name)') || '').trim();
    if (!name) return;
    await flush();
    const { data, error } = await sb.from('boards')
      .insert({ name: name.slice(0, 80), owner_id: user.id, data: [] })
      .select('id,name,owner_id').single();
    if (error) return toast('Could not create board: ' + error.message);
    boards.push({ ...data, role: 'owner' });
    boards.sort((a, b) => a.name.localeCompare(b.name));
    if (await openBoard(data.id, true)) { showGate(null); showBar(true); }
  }
  newBoardBtn.addEventListener('click', createBoard);
  $('wcCreateFirst').addEventListener('click', createBoard);
  sel.addEventListener('change', async () => { if (!(await openBoard(sel.value))) renderBar(); });

  App.onBeforeSignOut(flush);
  $('wcOutNone').addEventListener('click', () => App.signOut());

  // ---------- Share / manage dialog ----------
  const dlg = el('dialog', { id: 'wcManage' });
  dlg.innerHTML = `
    <div class="modal-head"><h2>Share and manage</h2><p>People only see boards you share with them.</p></div>
    <div class="wcBody">
      <div class="field"><label for="wcName">Board name</label>
        <div class="wcRow"><input id="wcName" maxlength="80"><button type="button" id="wcRename" style="flex:0 0 auto">Rename</button></div></div>
      <div class="field"><label>People with access</label><div id="wcPeople" class="wcList"></div></div>
      <div class="field"><label for="wcInvEmail">Share with email</label>
        <div class="wcRow"><input id="wcInvEmail" type="email" placeholder="client@example.com">
          <select id="wcInvRole"><option value="editor">Can edit</option><option value="viewer">View only</option></select>
          <button type="button" class="primary" id="wcShare" style="flex:0 0 auto">Share</button></div></div>
      <div class="actions"><button type="button" class="danger" id="wcDelete">Delete board</button><button type="button" id="wcActivityBtn">Activity</button><button type="button" id="wcClose">Close</button></div>
    </div>`;
  document.body.append(dlg);

  function personRow(label, note, onRemove) {
    const rm = el('button', { type: 'button', className: 'ghost', textContent: 'Remove' });
    rm.addEventListener('click', onRemove);
    return el('div', { className: 'wcPerson' }, el('span', { textContent: label }), el('small', { textContent: note }), rm);
  }

  async function renderPeople() {
    const [m, i] = await Promise.all([
      sb.from('board_members').select('user_id,email,role').eq('board_id', current.id),
      sb.from('board_invites').select('email,role').eq('board_id', current.id)
    ]);
    if (m.error || i.error) return toast('Could not load the access list.');
    const box = $('wcPeople'); box.replaceChildren();
    const label = r => (r === 'editor' ? 'Can edit' : 'View only');
    m.data.forEach(r => box.append(personRow(r.email || 'Unknown user', label(r.role), async () => {
      const { error } = await sb.from('board_members').delete().eq('board_id', current.id).eq('user_id', r.user_id);
      if (error) toast(error.message); renderPeople();
    })));
    i.data.forEach(r => box.append(personRow(r.email, label(r.role) + ', not signed in yet', async () => {
      const { error } = await sb.from('board_invites').delete().eq('board_id', current.id).eq('email', r.email);
      if (error) toast(error.message); renderPeople();
    })));
    if (!box.children.length) box.append(el('span', { className: 'wcMuted', textContent: 'Not shared with anyone yet.' }));
  }

  async function loadShareUsers() {
    // Only admins may enumerate the user directory. Other board owners can share by email.
    const { data: mine } = await sb.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    const field = $('wcExistingField');
    field.hidden = !mine?.is_admin;
    if (!mine?.is_admin) return;
    const { data, error } = await sb.from('profiles').select('id,email,full_name,disabled').eq('disabled', false).order('email');
    if (error) { field.hidden = true; return; }
    const select = $('wcExisting');
    select.replaceChildren(el('option', { value: '', textContent: 'Choose a user...' }));
    (data || []).filter(p => p.id !== user.id && p.email).forEach(p =>
      select.append(el('option', { value: p.email, textContent: p.full_name ? p.full_name + ' (' + p.email + ')' : p.email })));
  }
  $('wcExisting').addEventListener('change', e => {
    if (e.target.value) $('wcInvEmail').value = e.target.value;
  });
  manageBtn.addEventListener('click', () => {
    $('wcName').value = current.name; $('wcInvEmail').value = '';
    dlg.showModal(); renderPeople(); loadShareUsers().catch(() => { $('wcExistingField').hidden = true; });
  });
  $('wcClose').addEventListener('click', () => dlg.close());

  $('wcRename').addEventListener('click', async () => {
    const name = $('wcName').value.trim().slice(0, 80);
    if (!name) return;
    const { error } = await sb.from('boards').update({ name }).eq('id', current.id);
    if (error) return toast(error.message);
    current.name = name; boards.sort((a, b) => a.name.localeCompare(b.name)); renderBar(); toast('Renamed');
  });

  $('wcShare').addEventListener('click', async () => {
    const email = $('wcInvEmail').value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid email.');
    const { error } = await sb.from('board_invites')
      .upsert({ board_id: current.id, email, role: $('wcInvRole').value }, { onConflict: 'board_id,email' });
    if (error) return toast(error.message);
    $('wcInvEmail').value = ''; $('wcExisting').value = ''; renderPeople();
    toast('Shared. Ask them to sign in with that email.');
  });

  $('wcDelete').addEventListener('click', async () => {
    if (!confirm('Delete "' + current.name + '" for everyone? This cannot be undone.')) return;
    pending = null; clearTimeout(timer); timer = null;
    const paths = board.get().flatMap(c => (c.attachments || []).map(f => f.path));
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    const { error } = await sb.from('boards').delete().eq('id', current.id);
    if (error) return toast(error.message);
    boards = boards.filter(b => b.id !== current.id); current = null; ready = false;
    dlg.close();
    if (boards.length) await openBoard(boards[0].id, true);
    else { board.set([]); showBar(true); renderBar(); showGate('none'); }
  });

  // ---------- Layout editor (owner only) ----------
  const ldlg = el('dialog', { id: 'wcLayout' });
  ldlg.innerHTML = `
    <div class="modal-head"><h2>Board layout</h2><p>Columns run across the top, swimlanes down the side. Up to 8 of each. Tasks follow a rename; if you remove one, its tasks move to the first.</p></div>
    <div class="wcBody">
      <div class="field"><label>Columns</label><div id="wcCols" class="wcList"></div><button type="button" class="ghost" id="wcAddCol">+ Add column</button></div>
      <div class="field"><label>Swimlanes</label><div id="wcLanes" class="wcList"></div><button type="button" class="ghost" id="wcAddLane">+ Add swimlane</button></div>
      <p id="wcLayoutMsg" class="wcMuted"></p>
      <div class="actions"><button type="button" id="wcLayoutCancel">Cancel</button><button type="button" class="primary" id="wcLayoutSave">Save layout</button></div>
    </div>`;
  document.body.append(ldlg);

  let draft = { cols: [], lanes: [] };
  const layoutMsg = t => { $('wcLayoutMsg').textContent = t || ''; };

  function drawLayout(kind) {
    const box = $(kind === 'cols' ? 'wcCols' : 'wcLanes'); box.replaceChildren();
    const rows = draft[kind];
    rows.forEach((r, i) => {
      const name = el('input', { value: r.name, maxLength: 30, placeholder: 'Name' });
      const hint = el('input', { value: r.hint, maxLength: 80, placeholder: 'Short description (optional)' });
      name.addEventListener('input', () => { r.name = name.value; });
      hint.addEventListener('input', () => { r.hint = hint.value; });
      const btn = (text, fn, off) => { const b = el('button', { type: 'button', className: 'ghost', textContent: text, disabled: !!off }); b.addEventListener('click', fn); return b; };
      const swap = d => { [rows[i], rows[i + d]] = [rows[i + d], rows[i]]; drawLayout(kind); };
      box.append(el('div', { className: 'wcPerson' },
        el('div', { className: 'wcLayRow' }, name, hint),
        btn('Up', () => swap(-1), i === 0),
        btn('Down', () => swap(1), i === rows.length - 1),
        btn('Remove', () => { rows.splice(i, 1); drawLayout(kind); }, rows.length === 1)));
    });
  }

  layoutBtn.addEventListener('click', () => {
    const cur = board.getLayout();
    draft = {
      cols: cur.columns.map(c => ({ orig: c.name, name: c.name, hint: c.hint })),
      lanes: cur.lanes.map(c => ({ orig: c.name, name: c.name, hint: c.hint }))
    };
    layoutMsg(''); drawLayout('cols'); drawLayout('lanes'); ldlg.showModal();
  });
  const addRow = (kind, label) => {
    if (draft[kind].length >= 8) return layoutMsg('Up to 8 ' + label + '.');
    draft[kind].push({ orig: null, name: '', hint: '' }); drawLayout(kind);
  };
  $('wcAddCol').addEventListener('click', () => addRow('cols', 'columns'));
  $('wcAddLane').addEventListener('click', () => addRow('lanes', 'swimlanes'));
  $('wcLayoutCancel').addEventListener('click', () => ldlg.close());

  $('wcLayoutSave').addEventListener('click', async () => {
    const clean = rows => rows.map(r => ({ orig: r.orig, name: r.name.trim().slice(0, 30), hint: r.hint.trim().slice(0, 80) }));
    const cols = clean(draft.cols), lanes = clean(draft.lanes);
    for (const list of [cols, lanes]) {
      if (list.some(r => !r.name) || new Set(list.map(r => r.name.toLowerCase())).size !== list.length)
        return layoutMsg('Every name must be filled in and unique.');
    }
    const cur = board.getLayout(), tasks = board.get();
    // old name -> new name; removed ones fall back to the first entry
    const mapOf = (rows, old) => new Map(old.map(o => { const k = rows.find(r => r.orig === o.name); return [o.name, k ? k.name : rows[0].name]; }));
    const wm = mapOf(cols, cur.columns), km = mapOf(lanes, cur.lanes);
    const dropped = tasks.filter(t => !cols.some(r => r.orig === t.when) || !lanes.some(r => r.orig === t.kind)).length;
    if (dropped && !confirm(dropped + ' task(s) sit in a removed column or swimlane and will move to the first one. Continue?')) return;
    const data = tasks.map(t => ({ ...t, when: wm.get(t.when) || cols[0].name, kind: km.get(t.kind) || lanes[0].name }));
    const config = { columns: cols.map(r => ({ name: r.name, hint: r.hint })), lanes: lanes.map(r => ({ name: r.name, hint: r.hint })) };
    layoutMsg('Saving...');
    await flush();
    const res = await sb.from('boards').update({ config, data, updated_at: new Date().toISOString() })
      .eq('id', current.id).eq('updated_at', lastSeen).select('updated_at');
    if (res.error) return layoutMsg(res.error.message);
    ldlg.close();
    if (!res.data.length) { toast('Someone else changed this board. Loaded the latest, please redo the layout change.'); await openBoard(current.id, true); return; }
    lastSeen = res.data[0].updated_at;
    board.set(data, config);
    toast('Layout saved');
  });

  // ---------- Activity (owner only, from the manage dialog) ----------
  const adlg = el('dialog', { id: 'wcActivity' });
  adlg.innerHTML = `
    <div class="modal-head"><h2>Activity</h2><p>The last 100 events on this board.</p></div>
    <div class="wcBody"><div id="wcActList" class="wcList"></div>
      <div class="actions"><button type="button" id="wcActClose">Close</button></div></div>`;
  document.body.append(adlg);
  $('wcActClose').addEventListener('click', () => adlg.close());
  $('wcActivityBtn').addEventListener('click', async () => {
    const list = $('wcActList');
    list.replaceChildren(el('span', { className: 'wcMuted', textContent: 'Loading...' }));
    adlg.showModal();
    const { data, error } = await sb.from('audit_log').select('id,at,actor_email,action,target,detail')
      .eq('board_id', current.id).order('id', { ascending: false }).limit(100);
    list.replaceChildren();
    if (error) return list.append(el('span', { className: 'wcMuted', textContent: error.message }));
    if (!data.length) list.append(el('span', { className: 'wcMuted', textContent: 'No activity yet.' }));
    data.forEach(r => list.append(el('div', { className: 'wcPerson' },
      el('span', { textContent: Audit.describe(r) }),
      el('small', { textContent: Audit.who(r) + ', ' + Audit.when(r.at) }))));
  });

  // ---------- Attachments (Supabase Storage) ----------
  const MAX_BYTES = 10 * 1024 * 1024;
  const attList = el('div');
  const attPick = el('input', { type: 'file', multiple: true });
  const attBox = el('div', { className: 'field', id: 'wcAtt' }, el('label', { textContent: 'Attachments (10 MB max each)' }), attList, attPick);
  document.querySelector('#chunkForm .actions').before(attBox);
  let editing = null;
  const fmtSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  async function openAtt(f) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(f.path, 60, { download: f.name });
    if (error) return toast('Could not open file: ' + error.message);
    sb.rpc('log_event', { p_action: 'file.opened', p_board: current.id, p_detail: { name: f.name } }).then(() => {});
    const a = el('a', { href: data.signedUrl, rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
  }

  function renderAtts() {
    attList.replaceChildren();
    if (!editing) {
      attList.append(el('span', { className: 'wcMuted', textContent: 'Save this task first, then reopen it to attach files.' }));
      attPick.hidden = true; return;
    }
    attPick.hidden = !canEdit();
    editing.attachments.forEach(f => {
      const row = el('div', { className: 'wcFile' }, el('span', { textContent: f.name + ' (' + fmtSize(f.size) + ')' }));
      const open = el('button', { type: 'button', textContent: 'Open' });
      open.addEventListener('click', () => openAtt(f));
      row.append(open);
      if (canEdit()) {
        const rm = el('button', { type: 'button', className: 'ghost danger', textContent: 'Remove' });
        rm.addEventListener('click', () => removeAtt(f));
        row.append(rm);
      }
      attList.append(row);
    });
  }

  attPick.addEventListener('change', async () => {
    const files = [...attPick.files]; attPick.value = '';
    if (!editing || !canEdit()) return;
    const chunk = editing;
    for (const file of files) {
      if (file.size > MAX_BYTES) { toast(file.name + ' is over 10 MB.'); continue; }
      if (chunk.attachments.length >= 20) { toast('Limit is 20 files per task.'); break; }
      const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
      const path = current.id + '/' + chunk.id + '/' + crypto.randomUUID() + '-' + safe;
      toast('Uploading ' + file.name + '...');
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (error) { toast('Upload failed: ' + error.message); continue; }
      chunk.attachments.push({ path, name: file.name.slice(0, 120), size: file.size });
      board.commit(); renderAtts();
    }
  });

  async function removeAtt(f) {
    if (!confirm('Remove ' + f.name + '?')) return;
    const { error } = await sb.storage.from(BUCKET).remove([f.path]);
    if (error) return toast('Could not delete file: ' + error.message);
    editing.attachments = editing.attachments.filter(a => a.path !== f.path);
    board.commit(); renderAtts();
  }

  hooks.onEdit = x => { editing = x; renderAtts(); };
  hooks.openAtt = openAtt;
  hooks.onRemove = chunk => {
    const paths = (chunk.attachments || []).map(f => f.path);
    if (paths.length && canEdit()) sb.storage.from(BUCKET).remove(paths);
  };

  // ---------- Session handling ----------
  async function handle(session) {
    if (!session) {
      user = null; ready = false; current = null; boards = [];
      showBar(false); showGate(null); return;
    }
    if (user && user.id === session.user.id) return; // token refresh, nothing to reload
    user = session.user;
    showGate('loading');
    try { await loadBoards(); } catch (e) { toast('Could not load boards: ' + e.message); showGate('error'); return; }
    showBar(true);
    if (!boards.length) { current = null; board.set([]); renderBar(); showGate('none'); return; }
    const saved = localStorage.getItem(CURRENT_KEY);
    const first = boards.find(b => b.id === saved) || boards[0];
    if (await openBoard(first.id, true)) showGate(null);
  }

  // The shared App handles sign in and calls back with the session (or null)
  App.onSession(session => handle(session));
})();
