/* Turns an audit_log row into a readable sentence. Used by the board Activity view and the Admin page. */
(() => {
  'use strict';
  const d = r => r.detail || {};
  const task = r => (d(r).title ? 'task "' + d(r).title + '"' : 'a task');
  const role = x => (x === 'editor' ? 'can edit' : 'view only');
  const T = {
    'auth.sign_in': () => 'Signed in',
    'file.opened': r => (d(r).name ? 'Opened file "' + d(r).name + '"' : 'Opened a file'),
    'board.created': r => 'Created board "' + (r.target || '') + '"',
    'board.renamed': r => 'Renamed board from "' + d(r).from + '" to "' + d(r).to + '"',
    'board.deleted': r => 'Deleted board "' + (r.target || '') + '" (' + (d(r).tasks || 0) + ' tasks)',
    'board.layout_changed': r => 'Changed the layout. Columns: ' + (d(r).columns || []).join(', ') + '. Swimlanes: ' + (d(r).lanes || []).join(', '),
    'task.created': r => 'Added ' + task(r),
    'task.deleted': r => 'Deleted ' + task(r),
    'task.updated': r => {
      const x = d(r);
      const mv = [
        Array.isArray(x.when) && 'column ' + x.when[0] + ' to ' + x.when[1],
        Array.isArray(x.kind) && 'swimlane ' + x.kind[0] + ' to ' + x.kind[1]
      ].filter(Boolean);
      return 'Updated ' + task(r) + (mv.length ? ', moved ' + mv.join(' and ') : '') + (x.fields ? ' (' + x.fields.join(', ') + ')' : '');
    },
    'task.bulk_changed': () => 'Changed many tasks at once (import, reset or layout change)',
    'member.added': r => d(r).email + ' now has access (' + role(d(r).role) + ')',
    'member.removed': r => 'Removed access for ' + d(r).email,
    'member.role_changed': r => 'Changed ' + d(r).email + ' to ' + role(d(r).role),
    'invite.created': r => 'Invited ' + d(r).email + ' (' + role(d(r).role) + ')',
    'invite.claimed': r => d(r).email + ' accepted the invitation',
    'invite.revoked': r => 'Cancelled the invitation for ' + d(r).email,
    'admin.invite_user': r => 'Invited user ' + r.target,
    'admin.set_admin': r => (d(r).is_admin ? 'Made ' : 'Removed admin from ') + r.target,
    'admin.set_disabled': r => (d(r).disabled ? 'Disabled ' : 'Enabled ') + r.target,
    'admin.delete_user': r => 'Deleted user ' + r.target
  };
  window.Audit = {
    describe: r => (T[r.action] ? T[r.action](r) : r.action),
    who: r => r.actor_email || 'System',
    when: iso => new Date(iso).toLocaleString()
  };
})();
