(() => {
'use strict';
const $ = id => document.getElementById(id);
let userId = null;
App.onSession((session, profile) => {
 if (!session || !profile) return;
 userId = session.user.id;
 $('profileEmail').value = profile.email || session.user.email || '';
 $('profileName').value = profile.full_name || '';
});
$('profileForm').addEventListener('submit', async e => {
 e.preventDefault();
 if (!userId) return;
 const full_name = $('profileName').value.trim();
 const { error } = await App.sb.from('profiles').update({ full_name }).eq('id', userId);
 $('profileMsg').textContent = error ? error.message : 'Profile saved. Reload to see the updated name in navigation.';
 $('profileMsg').className = 'ap-msg' + (error ? ' err' : '');
});
$('pwForm').addEventListener('submit', async e => {
 e.preventDefault();
 const pw = $('newPass').value;
 if (pw.length < 12) { $('pwMsg').textContent = 'Use at least 12 characters.'; $('pwMsg').className = 'ap-msg err'; return; }
 const { error } = await App.sb.auth.updateUser({ password: pw });
 $('pwMsg').textContent = error ? error.message : 'Password updated.';
 $('pwMsg').className = 'ap-msg' + (error ? ' err' : '');
 if (!error) $('newPass').value = '';
});
})();