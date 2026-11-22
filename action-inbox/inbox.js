(()=>{'use strict';
const $=id=>document.getElementById(id),sb=App.sb;
let user=null,tenant=null,role='',tab='mine',items=[],workstreams=[],selected=null,detailTab='remediation',rules=[],assessmentItems=[],scanCoverage=[],assessmentFull=false,aiScope='',aiRequest=0,aiUserId=null,aiCache=null;
const AI_FRESH_MS=24*60*60*1000;
const aiScopeDb=()=>tab+':'+($('ainboxWorkstream').value||'all');
function displayCachedAI(entry){
 if(!entry||!entry.assessment)return;
 aiCache=entry;
 $('ainboxAIText').textContent=entry.assessment;
 $('ainboxAiBadge').hidden=false;
 $('ainboxAiDisclaimer').hidden=false;
 const stale=Date.now()-new Date(entry.generated_at).getTime()>=AI_FRESH_MS;
 $('ainboxAiBadge').classList.toggle('is-stale',stale);
 $('ainboxAiStale').hidden=!stale;
}
async function restoreAI(scope,request){
 if(!aiUserId||!tenant)return;
 const {data,error}=await sb.from('ainbox_ai_assessment_cache').select('assessment,model,generated_at').eq('user_id',aiUserId).eq('tenant_id',tenant).eq('scope_key',aiScopeDb()).maybeSingle();
 if(error){msg('Could not restore saved AI assessment: '+error.message,'warning');return;}
 if(scope===aiScope&&request===aiRequest&&data)displayCachedAI(data);
}

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const msg=(message,type='info')=>{const el=$('ainboxMessage');if(!el)return;el.textContent=message||'';el.hidden=!message;el.className='ainbox-message ainbox-message--'+(message?type:'info');el.setAttribute('role',type==='error'?'alert':'status');};
const date=s=>s?new Date(s).toLocaleString():'Not yet';
const allowedAdmin=()=>role==='superuser'||role==='tenant_admin'||!!user?.is_admin;
const rpc=async(name,args)=>{const {data,error}=await sb.rpc(name,args);if(error)throw Error(error.message);return data};
async function load(){
 if(!tenant)return;
 msg('Loading Action Inbox…');
 try{
  const [w,a,c,all]=await Promise.all([rpc('ainbox_get_workstreams',{p_tenant:tenant}),rpc('ainbox_get_actions',{p_tenant:tenant,p_all:tab==='all'}),allowedAdmin()?rpc('ainbox_get_scan_coverage',{p_tenant:tenant}):Promise.resolve([]),allowedAdmin()&&tab!=='all'?rpc('ainbox_get_actions',{p_tenant:tenant,p_all:true}):Promise.resolve(null)]);
  workstreams=Array.isArray(w)?w:[];items=Array.isArray(a)?a:[];scanCoverage=Array.isArray(c)?c:[];assessmentFull=allowedAdmin();assessmentItems=assessmentFull?(Array.isArray(all)?all:items):items;
  const sel=$('ainboxWorkstream'),old=sel.value;sel.replaceChildren(new Option('All workstreams',''),...workstreams.map(x=>new Option(x.name,x.id)));sel.value=workstreams.some(x=>x.id===old)?old:'';
  // Selection is reconciled against the visible filtered list in render().
  msg('');render();
 }catch(e){msg('Could not load Action Inbox: '+e.message,'error');items=[];assessmentItems=[];scanCoverage=[];assessmentFull=false;render()}
}
function filtered(){
 const w=$('ainboxWorkstream').value,st=$('ainboxStatus').value,q=$('ainboxSearch').value.trim().toLowerCase();
 return items.filter(x=>(!w||x.workstream_id===w)&&
 (st==='all'||st==='active'&&x.status!=='resolved'&&x.status!=='dismissed'&&(!x.snoozed_until||new Date(x.snoozed_until)<=new Date())||st==='snoozed'&&x.snoozed_until&&new Date(x.snoozed_until)>new Date()||st===x.status)&&
 (!q||[x.title,x.rule_name,x.summary,x.workstream].join(' ').toLowerCase().includes(q)))
 .sort((a,b)=>Number(b.priority_score)-Number(a.priority_score)||new Date(a.first_detected_at)-new Date(b.first_detected_at));
}
function workstreamAssessment(workstreamId){
 const relevant=assessmentItems.filter(x=>(!workstreamId||x.workstream_id===workstreamId)&&!x.resolved_at&&x.status!=='resolved');
 const high=relevant.filter(x=>Number(x.priority_score)>=70);
 const outstanding=relevant.filter(x=>x.status!=='dismissed');
 const scans=scanCoverage.filter(x=>(!workstreamId||x.workstream_id===workstreamId)&&x.enabled);
 const now=Date.now();
 const incomplete=!assessmentFull||!scans.length||scans.some(x=>x.scan_status!=='succeeded'||!x.scanned_at||Number(x.unknown)>0||Number(x.evaluated)===0||now-new Date(x.scanned_at).getTime()>Math.max(15,Number(x.interval_minutes)||360)*120000);
 const latest=scans.map(x=>new Date(x.scanned_at).getTime()).filter(Number.isFinite);
 const latestAt=latest.length?new Date(Math.min(...latest)).toLocaleString():'Not available';
 let health='Insufficient Data';
 if(high.length)health='Off Track';
 else if(outstanding.length)health='At Risk';
 else if(!incomplete)health='On Track';
 const scope=assessmentFull?'all source-accessible exceptions':'your assigned, accessible exceptions';
 const first=health==='Off Track'?high.length+' high-priority unresolved exception'+(high.length===1?' requires':'s require')+' immediate attention.':health==='At Risk'?outstanding.length+' unresolved exception'+(outstanding.length===1?' needs':'s need')+' follow-up.':health==='On Track'?'No unresolved exceptions were found in the current assessed scope.':'There is not enough verified scan coverage to establish a reliable health assessment.';
 const second=assessmentFull?'Assessment covers '+scope+' across '+scans.length+' enabled rule'+(scans.length===1?'':'s')+'.':'Assessment covers only '+scope+', not the entire workstream.';
 const third=incomplete?'Scan coverage is incomplete, stale, or includes Unknown records; last coverage checkpoint: '+latestAt+'.':'Latest required scan checkpoint: '+latestAt+'.';
 return {health,text:[first,second,third].join(' ')};
}
function render(){
 const list=filtered(),w=workstreams.find(x=>x.id===$('ainboxWorkstream').value);
 if(!list.some(x=>x.id===selected)){selected=list[0]?.id||null;detailTab='remediation';}
 $('ainboxWorkstreamTitle').textContent=w?.name||'All workstreams';
 $('ainboxOutcome').textContent=w?.desired_outcome||'Review actionable exceptions across your workstreams.';
 const scopeKey=tenant+':'+tab+':'+(w?.id||'all');
 if(aiScope!==scopeKey){aiScope=scopeKey;aiRequest++;aiCache=null;$('ainboxAiBadge').hidden=true;$('ainboxAiStale').hidden=true;$('ainboxAiDisclaimer').hidden=true;$('ainboxAIText').textContent='Generate an AI interpretation of your accessible exceptions. The deterministic assessment above remains authoritative.';restoreAI(aiScope,aiRequest);}else if(aiCache){const stale=Date.now()-new Date(aiCache.generated_at).getTime()>=AI_FRESH_MS;$('ainboxAiBadge').classList.toggle('is-stale',stale);$('ainboxAiStale').hidden=!stale;}
 const assessment=workstreamAssessment(w?.id||null);
 $('ainboxHealth').textContent=assessment.health;
 $('ainboxAssessment').textContent=assessment.text;
 $('ainboxCount').textContent=list.length;$('ainboxHigh').textContent=list.filter(x=>Number(x.priority_score)>=70).length;
 $('ainboxProgress').textContent=list.filter(x=>x.status==='in_progress').length;$('ainboxListCount').textContent=list.length+' results';
 $('ainboxList').innerHTML=list.length?list.map(x=>`<button type="button" class="ainbox-item" data-id="${esc(x.id)}" aria-pressed="${x.id===selected}"><span class="top"><small>${esc(x.workstream)} · ${esc(x.rule_key)}</small><span class="ainbox-pill">${esc(x.status.replaceAll('_',' '))}</span></span><strong>${esc(x.title||x.rule_name)}</strong><p>${esc(x.summary||'A business rule requires attention.')}</p><small>Priority ${esc(x.priority_score)} · Detected ${esc(date(x.first_detected_at))}</small></button>`).join(''):'<div class="ainbox-empty">No exceptions match your filters. Check the last completed scan or adjust your filters.</div>';
 $('ainboxList').querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.id;detailTab='remediation';render()}));
 renderDetail(list.find(x=>x.id===selected));
}
async function renderDetail(x){
 const el=$('ainboxDetail');
 if(!x){el.innerHTML='<h2>No exception selected</h2><p>No exceptions match the current workstream and filters. Select another workstream or adjust the filters to review an exception.</p>';return}
 const url=x.source_type==='work_board'?'/work-board/':x.source_type==='portfolio'?'/portfolio-management/':'/content-studio/';
 el.innerHTML=`<div class="meta">${esc(x.workstream)} / ${esc(x.rule_key)}</div><h2>${esc(x.title||x.rule_name)}</h2><div class="meta">Priority ${esc(x.priority_score)} · ${esc(x.status)} · Last detected ${esc(date(x.last_detected_at))}</div><div class="section"><h3>Why this matters</h3><p>${esc(x.summary||'This item is outside the configured business rule.')}</p></div><div class="section"><h3>Next action</h3><p>${esc(x.next_action||'Open the source record and correct the condition.')}</p></div>
 <div class="ainbox-detail-actions" aria-label="Exception actions"><a href="${url}" class="ainbox-action ainbox-action-primary"><span aria-hidden="true">↗</span> Open source</a><button type="button" class="ainbox-action ainbox-action-secondary" id="ainboxProgressAction" ${x.status==='resolved'?'disabled':''}>Mark in progress</button><button type="button" class="ainbox-action ainbox-action-secondary" id="ainboxSnooze" ${x.status==='resolved'?'disabled':''}>Snooze 1 day</button><button type="button" class="ainbox-action ainbox-action-quiet" id="ainboxDismiss" ${x.status==='resolved'?'disabled':''}>Dismiss</button></div>
 <div class="detail-tabs"><button data-detail="remediation" aria-selected="${detailTab==='remediation'}">Remediation</button><button data-detail="communication" aria-selected="${detailTab==='communication'}">Communication</button><button data-detail="activity" aria-selected="${detailTab==='activity'}">Activity</button></div>
 <div id="ainboxDetailBody"></div>`;
 $('ainboxProgressAction').onclick=()=>change(x,'in_progress');$('ainboxSnooze').onclick=()=>change(x,'snoozed',new Date(Date.now()+86400000).toISOString());$('ainboxDismiss').onclick=()=>change(x,'dismissed');
 el.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>{detailTab=b.dataset.detail;renderDetail(x)});
 const body=$('ainboxDetailBody');
 body.textContent='Loading…';
 try{
 const detail=await rpc('ainbox_get_exception_detail',{p_tenant:tenant,p_id:x.id});
 if(selected!==x.id||!filtered().some(item=>item.id===x.id))return;
 if(detailTab==='remediation'){
  const plan=(detail.remediation||[])[0];
  const steps=plan?.steps||[];
  body.innerHTML='<div class="section"><h3>Guided remediation</h3><p>Correct the issue in the source application. Completing steps does not resolve the exception until a verified scan confirms compliance.</p><p>Plan status: <strong>'+esc(plan?.status||'Not created')+'</strong></p><label>Remediation steps (one per line)<textarea id="ainboxSteps" rows="5" maxlength="10000" placeholder="Describe the steps to restore compliance"></textarea></label><div class="actions"><button type="button" id="ainboxSavePlan">Save plan</button><button type="button" id="ainboxApprovePlan">Approve plan</button></div><div id="ainboxStepChecklist"></div></div>';
  $('ainboxSteps').value=steps.map(z=>z.description).join('\n');
  const aiPlanBar=document.createElement('div');aiPlanBar.style.cssText='margin:12px 0;padding:12px;border:1px solid var(--border,#ccd5df);border-radius:8px;display:grid;gap:8px';
  aiPlanBar.innerHTML='<strong>✦ AI-assisted remediation planning</strong><button type="button" id="ainboxGeneratePlan">Generate suggested steps</button><small id="ainboxAiPlanStatus">Generated steps are editable. Save the plan to persist changes; approval remains separate.</small>';
  $('ainboxSteps').closest('label').before(aiPlanBar);
  try{const {data:enabled,error:enabledError}=await sb.rpc('ainbox_ai_component_enabled',{p_key:'remediation_plan'});aiPlanBar.hidden=!!enabledError||enabled!==true;}catch{aiPlanBar.hidden=true}
  $('ainboxGeneratePlan').onclick=async()=>{
   const button=$('ainboxGeneratePlan'),status=$('ainboxAiPlanStatus'),field=$('ainboxSteps');
   if(field.value.trim()&&!confirm('Replace the current remediation steps with AI suggestions? Unsaved edits will be lost.'))return;
   button.disabled=true;status.textContent='Generating suggested corrective actions…';
   try{
    const {data,error}=await sb.functions.invoke('ainbox-ai-remediation',{body:{tenant_id:tenant,exception_id:x.id}});
    if(error){let message=data?.error||error.message;try{const payload=await error.context?.json();message=payload?.error||message}catch{}throw Error(message)}
    if(data?.error)throw Error(data.error);
    if(selected!==x.id||detailTab!=='remediation')return;
    if(!Array.isArray(data.steps)||!data.steps.length)throw Error('No remediation steps returned');
    field.value=data.steps.join('\n');
    status.textContent='Suggested steps ready. Review, edit, then Save plan to persist. No steps have been approved or completed.';
   }catch(e){status.textContent='AI planning unavailable: '+e.message}
   finally{button.disabled=false}
  };

  $('ainboxSavePlan').onclick=async()=>{try{const values=$('ainboxSteps').value.split('\n').map(t=>t.trim()).filter(Boolean);await rpc('ainbox_save_remediation',{p_tenant:tenant,p_exception:x.id,p_steps:values});renderDetail(x)}catch(e){msg(e.message,'error')}};
  $('ainboxApprovePlan').disabled=!allowedAdmin()||!plan||plan.status!=='proposed';
  $('ainboxApprovePlan').onclick=async()=>{try{await rpc('ainbox_approve_remediation',{p_tenant:tenant,p_plan:plan.id,p_revision:plan.revision});renderDetail(x)}catch(e){msg(e.message,'error')}};
  const checklist=$('ainboxStepChecklist');
  checklist.innerHTML=steps.map(z=>'<label class="ainbox-check"><input type="checkbox" data-step="'+esc(z.id)+'" '+(z.completed_at?'checked':'')+' '+(!['approved','in_progress','completed'].includes(plan.status)?'disabled':'')+'><span>'+esc(z.description)+'</span></label>').join('');
  checklist.querySelectorAll('[data-step]').forEach(input=>input.onchange=async()=>{try{await rpc('ainbox_complete_remediation_step',{p_tenant:tenant,p_step:input.dataset.step,p_completed:input.checked});renderDetail(x)}catch(e){msg(e.message,'error');renderDetail(x)}});
  
 }else if(detailTab==='activity'){
  body.innerHTML='<div class="section"><h3>Activity history</h3>'+(detail.activity||[]).map(a=>'<p>'+esc(a.event_type.replaceAll('_',' '))+' · '+esc(date(a.occurred_at))+'</p>').join('')+'</div>';
 }else{
  const c=detail.communication||{};
  body.innerHTML='<div class="section"><h3>Communication draft</h3><label>Recipient<input id="ainboxRecipient" maxlength="500"></label><label>Subject<input id="ainboxSubject" maxlength="300"></label><label>Message<textarea id="ainboxBody" maxlength="20000"></textarea></label><div class="actions"><button type="button" id="ainboxSaveComm">Save draft</button><button type="button" id="ainboxApproveComm">Approve</button><button type="button" id="ainboxRecordComm">Record delivery</button></div><p id="ainboxCommStatus"></p><small>Approval and recording delivery are separate. No automatic messages are sent.</small></div>';
  const aiBar=document.createElement('div');aiBar.className='ainbox-ai-comm-controls';aiBar.style.cssText='margin:12px 0;padding:12px;border:1px solid var(--border,#ccd5df);border-radius:8px;display:grid;gap:10px';
  aiBar.innerHTML='<div style="font-weight:600">✦ AI remediation communication</div><div style="display:flex;flex-wrap:wrap;gap:8px"><label>Type <select id="ainboxAiCommType"><option value="initial">Initial request</option><option value="followup">Follow-up</option><option value="escalation">Escalation</option></select></label><label>Tone <select id="ainboxAiCommTone"><option value="collaborative">Collaborative</option><option value="direct">Direct</option><option value="executive">Executive</option></select></label></div><button type="button" id="ainboxGenerateComm">Generate draft</button><small id="ainboxAiCommStatus">AI drafts are editable and are not automatically saved or sent.</small>';
  body.querySelector('.section').insertBefore(aiBar,body.querySelector('.section').firstChild.nextSibling);
  try{
   const {data:enabled,error:enabledError}=await sb.rpc('ainbox_ai_component_enabled',{p_key:'communication'});
   aiBar.hidden=!!enabledError||enabled!==true;
  }catch{aiBar.hidden=true}
  $('ainboxGenerateComm').onclick=async()=>{
   const button=$('ainboxGenerateComm'),status=$('ainboxAiCommStatus');
   if(($('ainboxSubject').value.trim()||$('ainboxBody').value.trim())&&!confirm('Replace the current subject and message with a new AI draft?'))return;
   button.disabled=true;status.textContent='Generating a draft from the accessible exception…';
   try{
    const {data,error}=await sb.functions.invoke('ainbox-ai-communication',{body:{tenant_id:tenant,exception_id:x.id,type:$('ainboxAiCommType').value,tone:$('ainboxAiCommTone').value}});
    if(error){let message=data?.error||error.message;try{const payload=await error.context?.json();message=payload?.error||message}catch{}throw Error(message)}
    if(data?.error)throw Error(data.error);
    if(selected!==x.id||detailTab!=='communication')return;
    $('ainboxSubject').value=data.subject||'';$('ainboxBody').value=data.body||'';
    status.textContent='Draft generated. Review and click Save draft to persist. Nothing has been sent.';
   }catch(e){status.textContent='AI draft unavailable: '+e.message}
   finally{button.disabled=false}
  };
  $('ainboxRecipient').value=c.recipient||'';$('ainboxSubject').value=c.subject||'';$('ainboxBody').value=c.body||'';
  $('ainboxCommStatus').textContent=c.status||'New draft';
  $('ainboxSaveComm').onclick=async()=>{try{await rpc('ainbox_save_communication',{p_tenant:tenant,p_exception:x.id,p_recipient:$('ainboxRecipient').value,p_subject:$('ainboxSubject').value,p_body:$('ainboxBody').value});renderDetail(x)}catch(e){msg(e.message,'error')}};
  $('ainboxApproveComm').disabled=!allowedAdmin()||!c.id||c.status!=='draft';
  $('ainboxApproveComm').onclick=async()=>{try{await rpc('ainbox_approve_communication',{p_tenant:tenant,p_communication:c.id,p_version:c.version});renderDetail(x)}catch(e){msg(e.message,'error')}};
  $('ainboxRecordComm').disabled=!c.id||c.status!=='approved';
  $('ainboxRecordComm').onclick=async()=>{const channel=prompt('Delivery channel: email, chat, phone, meeting, other','email');if(channel===null)return;const reference=prompt('Delivery reference or note (optional)','');if(reference===null)return;try{await rpc('ainbox_record_communication',{p_tenant:tenant,p_communication:c.id,p_version:c.version,p_channel:channel,p_reference:reference});renderDetail(x)}catch(e){msg(e.message,'error')}};
 }
 }catch(e){if(selected===x.id&&filtered().some(item=>item.id===x.id))body.textContent='Could not load details: '+e.message}
}
async function change(x,status,until){
 try{await rpc('ainbox_set_exception_state',{p_tenant:tenant,p_id:x.id,p_status:status,p_revision:x.revision,p_snoozed_until:until||null});await load()}
 catch(e){msg('Action failed: '+e.message,'error')}
}
function showScanResult(res,rule){const unknown=Number(res?.unknown||0),evaluated=Number(res?.evaluated||0),violations=Number(res?.violations||0);const box=$('ainboxScanResult');if(!box)return;box.hidden=false;box.className='ainbox-scan-result'+(unknown?' ainbox-scan-warning':'');box.innerHTML='<strong>'+esc(rule?.rule_key||'Rule')+' scan completed</strong><p>'+evaluated+' evaluated · '+violations+' violations · '+unknown+' unknown</p>'+(unknown?'<p><strong>Action needed:</strong> Some records lack information required for a reliable result. '+(rule?.rule_key==='WORK-001'?'In Work Boards, edit each item and set its status to To Do, In Progress, or Done. An overdue item remains an exception until its status is Done or its due date is moved into the future.':rule?.rule_key==='KB-002'?'Older drafts without a reliable Draft entry date remain Unknown until an authoritative baseline exists.':'Review missing assessment or source status information.')+'</p>':'<p>All records in this scan were classified.</p>');}
function setTab(v){
 tab=v;document.querySelectorAll('.ainbox-tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===v)));
 $('ainboxWorkspace').hidden=v==='rules';document.querySelector('.ainbox-filters').hidden=v==='rules';$('ainboxRules').hidden=v!=='rules';$('ainboxScan').hidden=v!=='rules'||!allowedAdmin();
 if(v==='rules')loadRules();else load();
}
function timezoneChoices(current){
 const common=['UTC','America/New_York','America/Chicago','America/Denver','America/Phoenix','America/Los_Angeles','America/Anchorage','Pacific/Honolulu'];
 const supported=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[];
 const all=[...new Set([...common,...supported,current].filter(Boolean))];
 const valid=all.filter(zone=>{try{new Intl.DateTimeFormat('en-US',{timeZone:zone});return true}catch{return false}});
 const label=zone=>zone==='UTC'?'UTC (Coordinated Universal Time)':zone.replaceAll('_',' ').replaceAll('/',' / ');
 const group=(zones,title)=>'<optgroup label="'+esc(title)+'">'+zones.map(zone=>'<option value="'+esc(zone)+'">'+esc(label(zone))+'</option>').join('')+'</optgroup>';
 return group(common.filter(zone=>valid.includes(zone)),'Common time zones')+group(valid.filter(zone=>!common.includes(zone)).sort((a,b)=>a.localeCompare(b)),'All time zones');
}
function openRuleEditor(rule){
 if(!rule)return;
 const panel=$('ainboxRuleEditor');
 const cfg=rule.configuration||{};
 const extra=rule.evaluator_type==='KB-002'
  ?'<label>Maximum draft age (days)<input name="threshold" type="number" min="1" max="3650" required></label>'
  :rule.evaluator_type==='WORK-001'
  ?'<label>Organization timezone<select name="timezone" required>'+timezoneChoices(cfg.timezone||'UTC')+'</select><small>Choose an IANA time zone. Daylight saving changes are handled automatically.</small></label>'
  :'<label>Active initiative statuses<input name="statuses" type="text" required placeholder="active, in progress"><small>Separate statuses with commas.</small></label>';
 panel.hidden=false;
 panel.innerHTML='<div class="ainbox-rule-editor-heading"><div><small>RULE CONFIGURATION</small><h3>'+esc(rule.rule_key)+' · '+esc(rule.name)+'</h3><p>Update settings and publish a new rule version.</p></div><button type="button" class="ainbox-rule-close" id="ainboxRuleClose" aria-label="Close rule editor">×</button></div><form id="ainboxRuleForm"><label class="ainbox-rule-toggle"><input type="checkbox" name="enabled"><span>Rule enabled<small>Disabled rules cannot be scanned.</small></span></label><div class="ainbox-rule-fields"><label>Evaluation interval (minutes)<input name="interval" type="number" min="15" max="525600" step="1" required><small>Minimum 15 minutes.</small></label>'+extra+'</div><p class="ainbox-rule-error" id="ainboxRuleError" role="alert" hidden></p><div class="ainbox-rule-actions"><button type="button" id="ainboxRuleCancel">Cancel</button><button type="submit" class="ainbox-rule-save" id="ainboxRuleSave">Save changes</button></div></form>';
 const form=$('ainboxRuleForm');
 form.elements.enabled.checked=!!rule.enabled;
 form.elements.interval.value=rule.scan_interval_minutes||360;
 if(rule.evaluator_type==='KB-002')form.elements.threshold.value=cfg.threshold_days??5;
 else if(rule.evaluator_type==='WORK-001')form.elements.timezone.value=cfg.timezone||'UTC';
 else form.elements.statuses.value=(cfg.active_statuses||['active']).join(', ');
 const close=()=>{panel.hidden=true;panel.replaceChildren()};
 $('ainboxRuleClose').onclick=close;$('ainboxRuleCancel').onclick=close;
 form.onsubmit=async event=>{
  event.preventDefault();
  const error=$('ainboxRuleError');error.hidden=true;
  const interval=Number(form.elements.interval.value);
  if(!Number.isInteger(interval)||interval<15||interval>525600){error.textContent='Enter an interval between 15 and 525,600 minutes.';error.hidden=false;return}
  const next={...cfg};
  if(rule.evaluator_type==='KB-002'){
   const days=Number(form.elements.threshold.value);
   if(!Number.isInteger(days)||days<1||days>3650){error.textContent='Draft age must be between 1 and 3,650 days.';error.hidden=false;return}
   next.threshold_days=days;
  }else if(rule.evaluator_type==='WORK-001'){
   const zone=form.elements.timezone.value;
   try{new Intl.DateTimeFormat('en-US',{timeZone:zone})}catch{error.textContent='Enter a valid IANA timezone, such as America/Chicago.';error.hidden=false;return}
   next.timezone=zone;
  }else{
   const statuses=form.elements.statuses.value.split(',').map(x=>x.trim()).filter(Boolean);
   if(!statuses.length){error.textContent='Enter at least one active initiative status.';error.hidden=false;return}
   next.active_statuses=[...new Set(statuses)];
  }
  const save=$('ainboxRuleSave');save.disabled=true;save.textContent='Saving…';
  try{
   await rpc('ainbox_configure_rule',{p_tenant:tenant,p_rule:rule.id,p_enabled:form.elements.enabled.checked,p_interval:interval,p_config:next});
   close();await loadRules();msg('Saved '+rule.rule_key+' configuration.','success');
  }catch(e){error.textContent='Could not save: '+e.message;error.hidden=false;save.disabled=false;save.textContent='Save changes'}
 };
 panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function loadRules(){
 const el=$('ainboxRulesList');el.textContent='Loading rules…';
 try{rules=await rpc('ainbox_get_rules',{p_tenant:tenant});el.innerHTML=rules.length?rules.map(r=>`<article><strong>${esc(r.rule_key)} · ${esc(r.name)}</strong><p>${esc(r.evaluator_type)} · ${r.enabled?'Enabled':'Disabled'} · Every ${esc(r.scan_interval_minutes)} minutes</p><div class="ainbox-rule-buttons"><button type="button" class="ainbox-rule-run" data-run="${esc(r.id)}" ${!r.enabled?'disabled':''}><span aria-hidden="true">▶</span> Run now</button><button type="button" class="ainbox-rule-config" data-config="${esc(r.id)}"><span aria-hidden="true">⚙</span> Configure</button></div></article>`).join('') :'<p>No rules configured. Initialize the three standard rules to begin.</p><button type="button" id="ainboxBootstrap">Initialize rules</button>';
 const boot=$('ainboxBootstrap');if(boot)boot.onclick=async()=>{boot.disabled=true;try{await rpc('ainbox_bootstrap',{p_tenant:tenant,p_owner:user.id});await loadRules()}catch(e){msg(e.message,'error')}finally{boot.disabled=false}};
 el.querySelectorAll('[data-config]').forEach(b=>b.onclick=()=>openRuleEditor(rules.find(x=>x.id===b.dataset.config)));
 el.querySelectorAll('[data-run]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const res=await rpc('ainbox_run_rule',{p_tenant:tenant,p_rule:b.dataset.run});msg('');showScanResult(res,rules.find(x=>x.id===b.dataset.run));await loadRules()}catch(e){msg('Scan failed: '+e.message,'error')}finally{b.disabled=false}});
 }catch(e){el.textContent='Rules are unavailable: '+e.message}
}
document.querySelectorAll('.ainbox-tabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
['ainboxWorkstream','ainboxStatus','ainboxSearch'].forEach(id=>$(id).addEventListener(id==='ainboxSearch'?'input':'change',render));
$('ainboxRefresh').onclick=()=>tab==='rules'?loadRules():load();
$('ainboxGenerateAI').onclick=async()=>{
 const button=$('ainboxGenerateAI'),output=$('ainboxAIText');
 const scope=aiScope,request=++aiRequest,previous=aiCache;
 button.disabled=true;button.textContent='Generating…';
 output.textContent='Reviewing your accessible exception summary…';$('ainboxAiBadge').hidden=true;$('ainboxAiStale').hidden=true;$('ainboxAiDisclaimer').hidden=true;
 try{
  const {data,error}=await sb.functions.invoke('ainbox-ai-assessment',{body:{tenant_id:tenant,workstream_id:$('ainboxWorkstream').value||null}});
  if(error){let detail=data?.error;try{const response=error.context;if(response&&typeof response.json==='function'){const body=await response.json();detail=body?.error||detail;}}catch{}throw Error(detail||error.message||'AI provider unavailable');}
  if(data?.error)throw Error(data.error);
  if(scope!==aiScope||request!==aiRequest)return;
  if(typeof data?.assessment!=='string'||!data.assessment.trim())throw Error('No assessment returned');
  const record={user_id:aiUserId,tenant_id:tenant,scope_key:aiScopeDb(),assessment:data.assessment,model:data.model||null,generated_at:data.generated_at||new Date().toISOString()};
  displayCachedAI(record);
  const {data:saved,error:saveError}=await sb.from('ainbox_ai_assessment_cache').upsert(record,{onConflict:'user_id,tenant_id,scope_key'}).select('assessment,model,generated_at').single();
  if(saveError){msg('Assessment generated but NOT saved: '+saveError.message,'error');}
  else if(saved&&scope===aiScope&&request===aiRequest){displayCachedAI(saved);msg('AI assessment saved. It will be restored when you return.','success');}
 }catch(e){if(scope===aiScope&&request===aiRequest){if(previous){displayCachedAI(previous);msg('New AI assessment unavailable: '+e.message+' Showing the previously saved assessment.','warning');}else output.textContent='AI assessment unavailable: '+e.message+' The deterministic assessment above is still available.';}}
 finally{button.disabled=false;button.textContent='Generate assessment';}
};
$('ainboxScan').onclick=loadRules;
App.onSession(async(s,p)=>{if(!s)return;user=p;aiUserId=s.user.id;tenant=App.activeTenantId;role=App.tenantRole?.(tenant)||'';if(!tenant){msg('Choose an organization to use Action Inbox.','warning');return}
 try{const {data:aiAllowed,error:aiError}=await App.sb.rpc('ainbox_ai_component_enabled',{p_key:'assessment'});$('ainboxAiSection').hidden=!!aiError||aiAllowed!==true;}catch{$('ainboxAiSection').hidden=true;}
 document.querySelector('[data-tab="all"]').hidden=!allowedAdmin();document.querySelector('[data-tab="rules"]').hidden=!allowedAdmin();await load()});
})();