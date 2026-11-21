(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  App.onSession((session, profile) => {
    if (!session) return;
    $('hello').textContent = profile.full_name ? ', ' + profile.full_name : '';
    $('adminCard').hidden = !profile.is_admin;
  });
  $('pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const m = $('pwMsg'), pw = $('newPass').value;
    if (pw.length < 12) { m.textContent = 'Use at least 12 characters.'; m.className = 'ap-msg err'; return; }
    const { error } = await App.sb.auth.updateUser({ password: pw });
    m.textContent = error ? error.message : 'Password saved. You can now sign in with it.';
    m.className = 'ap-msg' + (error ? ' err' : '');
    if (!error) $('newPass').value = '';
  });
})();
