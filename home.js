(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  App.onSession((session, profile) => {
    if (!session) return;
    const hello = $('hello'); if (hello) hello.textContent = profile.full_name ? ', ' + profile.full_name : '';
    $('adminCard').hidden = !profile.is_admin;
  });
})();
