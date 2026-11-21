/* Make self-contained training pages part of the authenticated 90S6 app.
   GitHub Pages is public hosting: this is a user-experience sign-in gate,
   not a guarantee of content confidentiality. */
(() => {
 'use strict';
 // Keep the training pages invisible until access has been checked.
 document.documentElement.classList.add('training-await-auth');
 const css=document.createElement('link');
 css.rel='stylesheet';css.href='/shared/training-shell.css';document.head.append(css);
 const bar=document.createElement('div');
 bar.className='training-app-bar';
 bar.innerHTML='<a class="training-app-brand" href="/">90S6 App</a><nav aria-label="App navigation"><a href="/training/">Content &amp; Training</a><a href="/training/copilot-first-steps/">Copilot First Steps</a><a href="/work-board/">Work Board</a><a href="/profile/">My Profile</a></nav>';
 document.body.prepend(bar);
 const blocker=document.createElement('div');
 blocker.className='training-auth-blocker';
 blocker.innerHTML='<div class="training-auth-box"><strong>90S6 App</strong><p>Checking your workspace access...</p></div>';
 document.body.append(blocker);
 const load=src=>new Promise((resolve,reject)=>{
  const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);
 });
 const fail=()=>{blocker.innerHTML='<div class="training-auth-box"><strong>Could not load your workspace</strong><p>Check your connection and reload this page.</p><a href="/">Back to workspace</a></div>';};
 load('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js')
 .then(()=>load('/shared/config.js'))
 .then(()=>load('/shared/app.js?v=20261121-training'))
 .then(()=>{
  // Shared shell is responsible for sign-in and account checks.
  App.onSession(session=>{
   const allowed=Boolean(session);
   document.documentElement.classList.toggle('training-auth-ready',allowed);
   blocker.hidden=allowed;
   bar.hidden=!allowed;
  });
 }).catch(fail);
})();