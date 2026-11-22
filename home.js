(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  App.onSession((session, profile) => {
    if (!session) return;
    if (!profile.intro_presentation_completed_at) { location.replace('/training/90s6-introduction/?welcome=1'); return; }
    const hello = $('hello'); if (hello) hello.textContent = profile.full_name ? ', ' + profile.full_name : '';
    $('adminCard').hidden = !profile.is_admin;
    const canStudio = App.hasFeature('content_studio') && (profile.is_admin || profile.is_superuser || profile.is_content_creator);
    $('studioCard').hidden = !canStudio;
  });
})();
