/* First-login, account-specific guided tour. Completion is stored on the profile. */
(() => {
 'use strict';
 const steps = [
  {path:'/',selector:'#appNav',title:'Welcome to 90S6',body:'Use the navigation to move between your workspace, Work Board, and My Profile.'},
  {path:'/work-board/',selector:'.viewSwitch',title:'Two ways to organize work',body:'Board gives you a visual priority matrix. WBS shows your work items as a hierarchical spreadsheet.'},
  {path:'/work-board/',selector:'#newBtn',title:'Create and update work items',body:'Add work items, assign an owner and due date, and organize them in columns and swimlanes. Use Layout to customize your board when permitted.'},
  {path:'/work-board/',selector:'#viewWbs',title:'Work breakdown structure',body:'Choose WBS to view parent tasks and subtasks. In WBS mode you can export your work breakdown structure to Excel.'},
  {path:'/profile/',selector:'#newPass',title:'Secure your account',body:'Enter a new password of at least 12 characters, then select Update password. You can also finish this tour without changing it right now.'}
 ];
 let userId=null,active=false,idx=0,box=null,highlight=null;
 const key=id=>'90s6-tour-progress:'+id;
 const path=()=>location.pathname.replace(/index\.html$/,'');
 const onStep=()=>path()===steps[idx].path;
 const clear=()=>{
  if(box){box.remove();box=null}
  if(highlight){highlight.style.outline=highlight.dataset.tourOutline||'';highlight.style.outlineOffset=highlight.dataset.tourOutlineOffset||'';delete highlight.dataset.tourOutline;delete highlight.dataset.tourOutlineOffset;highlight=null}
  window.removeEventListener('resize',position);
  window.removeEventListener('scroll',position,true);
 };
 function position(){
  if(!box||!highlight)return;
  const r=highlight.getBoundingClientRect(),w=box.offsetWidth,h=box.offsetHeight;
  const left=Math.max(12,Math.min(window.innerWidth-w-12,r.left));
  const below=r.bottom+12;
  const top=idx===steps.length-1 && r.top>=h+18 ? r.top-h-12 : (below+h<=window.innerHeight-12?below:Math.max(12,r.top-h-12));
  box.style.left=left+'px';box.style.top=top+'px';
 }
 async function finish(){
  if(!userId)return;
  active=false;clear();
  try{sessionStorage.removeItem(key(userId))}catch(e){}
  const {error}=await App.sb.from('profiles').update({tour_completed_at:new Date().toISOString()}).eq('id',userId);
  if(error)console.warn('Could not save tour completion:',error.message);
 }
 function show(){
  clear();
  if(!active)return;
  if(!onStep()){location.assign(steps[idx].path);return}
  const step=steps[idx];
  highlight=document.querySelector(step.selector);
  if(!highlight){setTimeout(show,250);return}
  highlight.dataset.tourOutline=highlight.style.outline||'';
  highlight.dataset.tourOutlineOffset=highlight.style.outlineOffset||'';
  highlight.style.outline='3px solid #227aaa';
  highlight.style.outlineOffset='4px';
  box=document.createElement('section');
  box.setAttribute('role','dialog');box.setAttribute('aria-label','App introduction');
  box.style.cssText='position:fixed;z-index:2147483640;width:min(340px,calc(100vw - 24px));padding:18px;background:#fff;color:#24313d;border:1px solid #c8d7e0;border-radius:12px;box-shadow:0 12px 40px #17232b55;font:14px/1.5 system-ui,sans-serif';
  const count=document.createElement('div');count.textContent='INTRODUCTION  ·  '+(idx+1)+' OF '+steps.length;count.style.cssText='font-size:11px;font-weight:750;letter-spacing:.06em;color:#637889';
  const title=document.createElement('h2');title.textContent=step.title;title.style.cssText='margin:8px 0;font-size:19px';
  const body=document.createElement('p');body.textContent=step.body;body.style.cssText='margin:0 0 16px';
  const controls=document.createElement('div');controls.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:10px';
  const skip=document.createElement('button');skip.type='button';skip.textContent='Skip intro';skip.style.cssText='background:transparent;border:0;color:#526575;cursor:pointer;padding:8px';skip.onclick=finish;
  const next=document.createElement('button');next.type='button';next.textContent=idx===steps.length-1?'Finish intro':'Next';next.style.cssText='background:#253b4a;color:white;border:0;border-radius:8px;padding:9px 16px;cursor:pointer;font-weight:700';
  next.onclick=()=>{if(idx===steps.length-1){finish();return}idx++;try{sessionStorage.setItem(key(userId),String(idx))}catch(e){}show()};
  controls.append(skip,next);box.append(count,title,body,controls);document.body.append(box);
  position();window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
 }
 function restart(){
  if(!userId)return;
  idx=0;active=true;
  try{sessionStorage.setItem(key(userId),'0')}catch(e){}
  App.sb.from('profiles').update({tour_completed_at:null}).eq('id',userId).then(({error})=>{if(error)console.warn('Could not reset tour:',error.message)});
  show();
 }
 App.onSession((session,profile)=>{
  if(!session||!profile){active=false;clear();userId=null;return}
  if(userId===session.user.id)return;
  userId=session.user.id;
  if(!profile.tour_completed_at && location.pathname==='/' && sessionStorage.getItem('90s6-welcome-viewed:'+userId)!=='yes'){
   sessionStorage.setItem('90s6-welcome-viewed:'+userId,'yes');
   location.replace('/training/90s6-introduction/?welcome=1');return;
  }
  let progress=null;
  try{progress=sessionStorage.getItem(key(userId))}catch(e){}
  if(progress!==null){idx=Math.min(steps.length-1,Math.max(0,Number(progress)||0));active=true;show()}
  else if(!profile.tour_completed_at){idx=0;active=true;try{sessionStorage.setItem(key(userId),'0')}catch(e){}show()}
 });
 window.AppTour={restart,finish};
})();
