(()=>{'use strict';
const $=id=>document.getElementById(id),sb=App.sb;
let user=null,tenant=null,role='',tab='mine',items=[],workstreams=[],selected=null,detailTab='remediation',rules=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const msg=s=>{$('ainboxMessage').textContent=s||''};
const date=s=>s?new Date(s).toLocaleString():'Not yet';
const allowedAdmin=()=>role==='superuser'||role==='tenant_admin'||!!user?.is_admin;
const rpc=async(name,args)=>{const {data,error}=await sb.rpc(name,args);if(error)throw Error(error.message);return data};
async function load(){
 if(!tenant)return;
 msg('Loading Action Inbox…');
 try{
  const [w,a]=await Promise.all([rpc('ainbox_get_workstreams',{p_tenant:tenant}),rpc('ainbox_get_actions',{p_tenant:tenant,p_all:tab==='all'})]);
  workstreams=Array.isArray(w)?w:[];items=Array.isArray(a)?a:[];
  const sel=$('ainboxWorkstream'),old=sel.value;sel.replaceChildren(new Option('All workstreams',''),...workstreams.map(x=>new Option(x.name,x.id)));sel.value=workstreams.some(x=>x.id===old)?old:'';
  if(!items.some(x=>x.id===selected))selected=items[0]?.id||null;
  msg('');render();
 }catch(e){msg('Could not load Action Inbox: '+e.message);items=[];render()}
}
function filtered(){
 const w=$('ainboxWorkstream').value,st=$('ainboxStatus').value,q=$('ainboxSearch').value.trim().toLowerCase();
 return items.filter(x=>(!w||x.workstream_id===w)&&
 (st==='all'||st==='active'&&x.status!=='resolved'&&x.status!=='dismissed'&&(!x.snoozed_until||new Date(x.snoozed_until)<=new Date())||st==='snoozed'&&x.snoozed_until&&new Date(x.snoozed_until)>new Date()||st===x.status)&&
 (!q||[x.title,x.rule_name,x.summary,x.workstream].join(' ').toLowerCase().includes(q)))
 .sort((a,b)=>Number(b.priority_score)-Number(a.priority_score)||new Date(a.first_detected_at)-new Date(b.first_detected_at));
}
function render(){
 const list=filtered(),w=workstreams.find(x=>x.id===$('ainboxWorkstream').value);
 $('ainboxWorkstreamTitle').textContent=w?.name||'All workstreams';
 $('ainboxOutcome').textContent=w?.desired_outcome||'Review actionable exceptions across your workstreams.';
 $('ainboxHealth').textContent=w?.health_status||'Insufficient Data';
 $('ainboxCount').textContent=list.length;$('ainboxHigh').textContent=list.filter(x=>Number(x.priority_score)>=70).length;
 $('ainboxProgress').textContent=list.filter(x=>x.status==='in_progress').length;$('ainboxListCount').textContent=list.length+' results';
 $('ainboxList').innerHTML=list.length?list.map(x=>`<button type="button" class="ainbox-item" data-id="${esc(x.id)}" aria-pressed="${x.id===selected}"><span class="top"><small>${esc(x.workstream)} · ${esc(x.rule_key)}</small><span class="ainbox-pill">${esc(x.status.replaceAll('_',' '))}</span></span><strong>${esc(x.title||x.rule_name)}</strong><p>${esc(x.summary||'A business rule requires attention.')}</p><small>Priority ${esc(x.priority_score)} · Detected ${esc(date(x.first_detected_at))}</small></button>`).join(''):'<div class="ainbox-empty">No exceptions match your filters. Check the last completed scan or adjust your filters.</div>';
 $('ainboxList').querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.id;detailTab='remediation';render()}));
 renderDetail(items.find(x=>x.id===selected));
}
async function renderDetail(x){
 const el=$('ainboxDetail');
 if(!x){el.innerHTML='<h2>Choose an exception</h2><p>Review evidence, next steps and verification here.</p>';return}
 const url=x.source_type==='work_board'?'/work-board/':x.source_type==='portfolio'?'/portfolio-management/':'/content-studio/';
 el.innerHTML=`<div class="meta">${esc(x.workstream)} / ${esc(x.rule_key)}</div><h2>${esc(x.title||x.rule_name)}</h2><div class="meta">Priority ${esc(x.priority_score)} · ${esc(x.status)} · Last detected ${esc(date(x.last_detected_at))}</div><div class="section"><h3>Why this matters</h3><p>${esc(x.summary||'This item is outside the configured business rule.')}</p></div><div class="section"><h3>Next action</h3><p>${esc(x.next_action||'Open the source record and correct the condition.')}</p></div>
 <div class="actions"><a href="${url}" class="ainbox-pill">Open source application</a><button type="button" id="ainboxProgressAction" ${x.status==='resolved'?'disabled':''}>Mark in progress</button><button type="button" id="ainboxSnooze" ${x.status==='resolved'?'disabled':''}>Snooze 1 day</button><button type="button" id="ainboxDismiss" ${x.status==='resolved'?'disabled':''}>Dismiss</button></div>
 <div class="detail-tabs"><button data-detail="remediation" aria-selected="${detailTab==='remediation'}">Remediation</button><button data-detail="communication" aria-selected="${detailTab==='communication'}">Communication</button><button data-detail="activity" aria-selected="${detailTab==='activity'}">Activity</button></div>
 <div id="ainboxDetailBody"></div>`;
 $('ainboxProgressAction').onclick=()=>change(x,'in_progress');$('ainboxSnooze').onclick=()=>change(x,'snoozed',new Date(Date.now()+86400000).toISOString());$('ainboxDismiss').onclick=()=>change(x,'dismissed');
 el.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>{detailTab=b.dataset.detail;renderDetail(x)});
 const body=$('ainboxDetailBody');
 body.textContent='Loading…';
 try{
 const detail=await rpc('ainbox_get_exception_detail',{p_tenant:tenant,p_id:x.id});
 if(selected!==x.id)return;
 if(detailTab==='remediation'){
  body.innerHTML='<div class="section"><h3>Guided remediation</h3><p>Correct the issue in the source application. The next verified scan resolves compliant exceptions. Completing steps alone never closes an exception.</p></div>';
 }else if(detailTab==='activity'){
  body.innerHTML='<div class="section"><h3>Activity history</h3>'+(detail.activity||[]).map(a=>'<p>'+esc(a.event_type.replaceAll('_',' '))+' · '+esc(date(a.occurred_at))+'</p>').join('')+'</div>';
 }else{
  const c=detail.communication||{};
  body.innerHTML='<div class="section"><h3>Communication draft</h3><label>Recipient<input id="ainboxRecipient" maxlength="500"></label><label>Subject<input id="ainboxSubject" maxlength="300"></label><label>Message<textarea id="ainboxBody" maxlength="20000"></textarea></label><div class="actions"><button type="button" id="ainboxSaveComm">Save draft</button><button type="button" id="ainboxApproveComm">Approve</button><button type="button" id="ainboxRecordComm">Record delivery</button></div><p id="ainboxCommStatus"></p><small>Approval and recording delivery are separate. No automatic messages are sent.</small></div>';
  $('ainboxRecipient').value=c.recipient||'';$('ainboxSubject').value=c.subject||'';$('ainboxBody').value=c.body||'';
  $('ainboxCommStatus').textContent=c.status||'New draft';
  $('ainboxSaveComm').onclick=async()=>{try{await rpc('ainbox_save_communication',{p_tenant:tenant,p_exception:x.id,p_recipient:$('ainboxRecipient').value,p_subject:$('ainboxSubject').value,p_body:$('ainboxBody').value});renderDetail(x)}catch(e){msg(e.message)}};
  $('ainboxApproveComm').disabled=!allowedAdmin()||!c.id||c.status!=='draft';
  $('ainboxApproveComm').onclick=async()=>{try{await rpc('ainbox_approve_communication',{p_tenant:tenant,p_communication:c.id,p_version:c.version});renderDetail(x)}catch(e){msg(e.message)}};
  $('ainboxRecordComm').disabled=!c.id||c.status!=='approved';
  $('ainboxRecordComm').onclick=async()=>{const channel=prompt('Delivery channel: email, chat, phone, meeting, other','email');if(channel===null)return;const reference=prompt('Delivery reference or note (optional)','');if(reference===null)return;try{await rpc('ainbox_record_communication',{p_tenant:tenant,p_communication:c.id,p_version:c.version,p_channel:channel,p_reference:reference});renderDetail(x)}catch(e){msg(e.message)}};
 }
 }catch(e){body.textContent='Could not load details: '+e.message}
}
async function change(x,status,until){
 try{await rpc('ainbox_set_exception_state',{p_tenant:tenant,p_id:x.id,p_status:status,p_revision:x.revision,p_snoozed_until:until||null});await load()}
 catch(e){msg('Action failed: '+e.message)}
}
function setTab(v){
 tab=v;document.querySelectorAll('.ainbox-tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===v)));
 $('ainboxWorkspace').hidden=v==='rules';$('ainboxRules').hidden=v!=='rules';$('ainboxScan').hidden=v!=='rules'||!allowedAdmin();
 if(v==='rules')loadRules();else load();
}
async function loadRules(){
 const el=$('ainboxRulesList');el.textContent='Loading rules…';
 try{rules=await rpc('ainbox_get_rules',{p_tenant:tenant});el.innerHTML=rules.length?rules.map(r=>`<article><strong>${esc(r.rule_key)} · ${esc(r.name)}</strong><p>${esc(r.evaluator_type)} · ${r.enabled?'Enabled':'Disabled'} · Every ${esc(r.scan_interval_minutes)} minutes</p><button type="button" data-run="${esc(r.id)}" ${!r.enabled?'disabled':''}>Run now</button> <button type="button" data-config="${esc(r.id)}">Configure</button></article>`).join('') :'<p>No rules configured. Initialize the three standard rules to begin.</p><button type="button" id="ainboxBootstrap">Initialize rules</button>';
 const boot=$('ainboxBootstrap');if(boot)boot.onclick=async()=>{boot.disabled=true;try{await rpc('ainbox_bootstrap',{p_tenant:tenant,p_owner:user.id});await loadRules()}catch(e){msg(e.message)}finally{boot.disabled=false}};
 el.querySelectorAll('[data-config]').forEach(b=>b.onclick=async()=>{const rule=rules.find(x=>x.id===b.dataset.config);if(!rule)return;const enabled=confirm('Enable '+rule.rule_key+'? Select Cancel to disable.');const value=prompt('Evaluation interval in minutes (minimum 15)',String(rule.scan_interval_minutes));if(value===null)return;const minutes=Number(value);if(!Number.isInteger(minutes)||minutes<15){msg('Invalid interval');return}
 let cfg={...rule.configuration};if(rule.evaluator_type==='KB-002'){const t=prompt('Maximum Draft age in calendar days',String(cfg.threshold_days||5));if(t===null)return;cfg.threshold_days=Number(t)}else if(rule.evaluator_type==='WORK-001'){const t=prompt('IANA organization timezone',cfg.timezone||'UTC');if(t===null)return;cfg.timezone=t}else{const t=prompt('Comma-separated active initiative statuses',(cfg.active_statuses||['active']).join(','));if(t===null)return;cfg.active_statuses=t.split(',').map(x=>x.trim()).filter(Boolean)}
 try{await rpc('ainbox_configure_rule',{p_tenant:tenant,p_rule:rule.id,p_enabled:enabled,p_interval:minutes,p_config:cfg});await loadRules()}catch(e){msg(e.message)}
 });
 el.querySelectorAll('[data-run]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const res=await rpc('ainbox_run_rule',{p_tenant:tenant,p_rule:b.dataset.run});msg('Scan complete: '+JSON.stringify(res));await loadRules()}catch(e){msg('Scan failed: '+e.message)}finally{b.disabled=false}});
 }catch(e){el.textContent='Rules are unavailable: '+e.message}
}
document.querySelectorAll('.ainbox-tabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
['ainboxWorkstream','ainboxStatus','ainboxSearch'].forEach(id=>$(id).addEventListener(id==='ainboxSearch'?'input':'change',render));
$('ainboxRefresh').onclick=()=>tab==='rules'?loadRules():load();
$('ainboxScan').onclick=loadRules;
App.onSession(async(s,p)=>{if(!s)return;user=p;tenant=App.activeTenantId;role=App.tenantRole?.(tenant)||'';if(!tenant){msg('Choose an organization to use Action Inbox.');return}
 document.querySelector('[data-tab="all"]').hidden=!allowedAdmin();document.querySelector('[data-tab="rules"]').hidden=!allowedAdmin();await load()});
})();