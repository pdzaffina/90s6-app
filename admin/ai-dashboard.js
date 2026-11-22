(()=>{'use strict';
const $=id=>document.getElementById(id);
const rpc=async(name,args={})=>{const {data,error}=await App.sb.rpc(name,args);if(error)throw Error(error.message);return data};
const money=v=>'$'+Number(v||0).toFixed(4);
let authorized=false;
async function load(){
 if(!authorized)return;
 $('error').textContent='';
 try{
  const [summary,pricing]=await Promise.all([rpc('ainbox_ai_usage_summary'),rpc('ainbox_ai_pricing')]);
  const spent=Number(summary.spent||0),reserved=Number(summary.reserved||0),budget=Number(summary.budget||0);
  $('requests').textContent=Number(summary.requests||0).toLocaleString();
  $('inputTokens').textContent=Number(summary.input_tokens||0).toLocaleString();
  $('outputTokens').textContent=Number(summary.output_tokens||0).toLocaleString();
  $('spent').textContent=money(spent);$('reserved').textContent=money(reserved);$('budgetDisplay').textContent=money(budget);
  $('utilization').value=budget>0?Math.min(100,100*(spent+reserved)/budget):100;
  $('utilizationText').textContent=budget>0?(100*(spent+reserved)/budget).toFixed(1)+'% of monthly limit used or reserved':'Zero budget: new inference requests are blocked';
  $('budget').value=Number(pricing.budget);$('inputRate').value=Number(pricing.input);$('outputRate').value=Number(pricing.output);
  const container=$('components');container.replaceChildren();
  const components=summary.components||[];
  if(!components.length)container.textContent='No requests tracked this month.';
  for(const component of components){const line=document.createElement('p');line.textContent=component.component_key+': '+Number(component.requests).toLocaleString()+' requests, '+money(component.cost)+' estimated';container.append(line)}
  await Promise.allSettled([loadAudit(),loadGovernance(),loadEffectiveness()]);
  $('dashboard').hidden=false;
 }catch(e){$('error').textContent='Could not load AI usage: '+e.message}
}
async function loadAudit(){
 const rows=await rpc('ai_audit_search',{p_limit:200,p_component:$('auditComponent').value||null,p_model:$('auditModel').value.trim()||null,p_status:$('auditStatus').value||null,p_query:$('auditSearch').value.trim()||null,p_since:null});
 $('auditExplorerStatus').textContent=rows.length+' matching requests (up to 200 displayed)';
 const selected=$('auditComponent').value;
 const components=[...new Set(rows.map(r=>r.component_key))];
 for(const c of components){if(!$('auditComponent').querySelector('option[value="'+c+'"]')){const option=document.createElement('option');option.value=c;option.textContent=c;$('auditComponent').append(option)}}
 $('auditComponent').value=selected;
 const tbody=$('auditRows');tbody.replaceChildren();
 if(!rows?.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=9;td.textContent='No audited requests yet. New AI calls will appear here.';tr.append(td);tbody.append(tr);return}
 for(const a of rows){
  const tr=document.createElement('tr');
  const values=[new Date(a.request_at).toLocaleString(),a.component_key,a.model,a.http_status||'Pending',a.input_tokens??'N/A',a.output_tokens??'N/A',a.total_tokens??'N/A',a.estimated_usd==null?'N/A':money(a.estimated_usd)];
  for(const value of values){const td=document.createElement('td');td.textContent=String(value);tr.append(td)}
  const cell=document.createElement('td'),button=document.createElement('button');button.textContent='Inspect';button.onclick=async()=>{
   button.disabled=true;
   try{
    const detail=await rpc('ai_audit_inspect',{p_usage:a.usage_id});
    $('auditMeta').textContent='Request '+a.usage_id+' · Organization '+a.tenant_id+' · User '+a.user_id+' · '+(a.error_message||'No recorded provider error');
    $('auditRequest').textContent=JSON.stringify(detail.request_payload,null,2);
    $('auditResponse').textContent=detail.response_payload==null?'No provider response recorded':JSON.stringify(detail.response_payload,null,2);
    $('auditDetail').hidden=false;$('auditDetail').scrollIntoView({behavior:'smooth',block:'nearest'});
   }catch(e){$('error').textContent='Could not inspect audit: '+e.message}finally{button.disabled=false}
  };const replay=document.createElement('button');replay.textContent='Replay';replay.style.marginLeft='5px';replay.onclick=()=>{ $('evalSource').value=a.usage_id;$('evalModelA').value=a.model;$('evalModelB').focus();$('evalSource').scrollIntoView({behavior:'smooth',block:'center'});};cell.append(button,replay);tr.append(cell);tbody.append(tr)
 }
}
$('auditFilter').onclick=()=>loadAudit().catch(e=>$('auditExplorerStatus').textContent=e.message);
$('auditExport').onclick=async()=>{
 const button=$('auditExport');button.disabled=true;
 try{const records=await rpc('ai_audit_export',{p_limit:500});const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),records},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='90s6-ai-audit-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);await loadGovernance()}
 catch(e){$('auditExplorerStatus').textContent='Export failed: '+e.message}finally{button.disabled=false}
};
async function loadGovernance(){
 try{
  const [policy,access]=await Promise.all([rpc('ai_policy_get'),rpc('ai_audit_access_recent',{p_limit:30})]);
  $('retentionDays').value=policy.payload_retention_days;$('redactExport').checked=policy.redact_export;
  const target=$('auditAccess');target.replaceChildren();
  if(!access.length)target.textContent='No audit access recorded yet.';
  for(const a of access){const line=document.createElement('p');line.textContent=new Date(a.occurred_at).toLocaleString()+' · '+a.action+' · '+a.actor_id+(a.audit_id?' · '+a.audit_id:'');target.append(line)}
 }catch(e){$('governanceStatus').textContent='Governance unavailable: '+e.message}
}
$('governanceForm').onsubmit=async e=>{
 e.preventDefault();const days=Number($('retentionDays').value);
 try{await rpc('ai_policy_set',{p_days:days,p_redact:$('redactExport').checked});$('governanceStatus').textContent='Policy saved. Apply retention to purge old payloads now.';await loadGovernance()}
 catch(err){$('governanceStatus').textContent=err.message}
};
$('purgeNow').onclick=async()=>{
 if(!confirm('Remove raw request and response payloads older than the retention period? This cannot be undone.'))return;
 try{const count=await rpc('ai_audit_purge_due');$('governanceStatus').textContent=count+' audit payloads purged.';await loadGovernance()}
 catch(e){$('governanceStatus').textContent=e.message}
};
async function loadEffectiveness(){
 try{
  const groups=await rpc('ai_effectiveness_summary');const target=$('effectiveness');target.replaceChildren();
  for(const g of groups){const card=document.createElement('div');card.className='metric';const title=document.createElement('span');title.textContent=g.ai_assisted?'AI-assisted exceptions':'Other exceptions';const big=document.createElement('strong');big.textContent=String(g.resolved)+' / '+g.total+' resolved';const sub=document.createElement('small');sub.textContent='Avg resolution: '+(g.avg_resolution_hours??'N/A')+' hours · Approved plans: '+g.approved_plans;card.append(title,big,sub);target.append(card)}
  if(!groups.length)target.textContent='No exceptions recorded.';
 }catch(e){$('effectiveness').textContent='Effectiveness unavailable: '+e.message}
}
const invokeGateway=async payload=>{
 const {data,error}=await App.sb.functions.invoke('ai-platform-gateway',{body:payload});
 if(error){let message=error.message;try{const detail=await error.context?.json();message=detail?.error||message}catch{}throw Error(message)}
 if(data?.error)throw Error(data.error);
 return data;
};
$('evalRun').onclick=async()=>{
 const source=$('evalSource').value.trim(),a=$('evalModelA').value.trim(),b=$('evalModelB').value.trim();
 if(!source||!a||!b){$('evalStatus').textContent='Select a source request and enter both model IDs.';return}
 const button=$('evalRun');button.disabled=true;$('evalStatus').textContent='Running two audited model comparisons...';
 try{
  const original=await rpc('ai_replay_source',{p_usage:source});if(!original)throw Error('Source request not available');
  for(const [model,output,meta] of [[a,'evalOutputA','evalMetaA'],[b,'evalOutputB','evalMetaB']]){
   $(output).textContent='Running '+model+'...';
   try{
    const t=performance.now(),result=await invokeGateway({tenant_id:original.tenant_id,source_usage_id:source,component:'evaluation',model});
    $(output).textContent=result.content;$(meta).textContent=model+' · '+(performance.now()-t).toFixed(0)+' ms · '+(result.input_tokens??'N/A')+' input · '+(result.output_tokens??'N/A')+' output · '+money(result.estimated_usd)+' · '+result.usage_id;
   }catch(e){$(output).textContent='Failed: '+e.message;$(meta).textContent=model}
  }
  $('evalStatus').textContent='Comparison complete. Evaluate the content manually for quality.';await loadAudit();
 }catch(e){$('evalStatus').textContent='Comparison failed: '+e.message}
 finally{button.disabled=false}
};
$('gatewayRun').onclick=async()=>{
 const button=$('gatewayRun');button.disabled=true;$('gatewayStatus').textContent='Submitting audited request...';
 try{
  const result=await invokeGateway({tenant_id:$('gatewayTenant').value.trim(),component:$('gatewayComponent').value,content:$('gatewayContent').value,model:$('gatewayModel').value.trim()||undefined});
  $('gatewayOutput').textContent=result.content;$('gatewayStatus').textContent=result.model+' · '+(result.input_tokens??'N/A')+' input · '+(result.output_tokens??'N/A')+' output · '+money(result.estimated_usd)+' · Audit '+result.usage_id;
  await loadAudit()
 }catch(e){$('gatewayStatus').textContent='Request failed: '+e.message}
 finally{button.disabled=false}
};
$('closeDetail').onclick=()=>{$('auditDetail').hidden=true};
$('refresh').onclick=load;
$('budgetForm').onsubmit=async e=>{
 e.preventDefault();if(!authorized)return;
 const button=e.submitter,values=[$('budget').value,$('inputRate').value,$('outputRate').value].map(Number);
 if(values.some(v=>!Number.isFinite(v)||v<0)){$('saveStatus').textContent='Enter valid nonnegative amounts';return}
 button.disabled=true;
 try{await rpc('ainbox_ai_set_budget',{p_usd:values[0]});await rpc('ainbox_ai_set_rates',{p_input:values[1],p_output:values[2]});$('saveStatus').textContent='Saved.';await load()}
 catch(err){$('saveStatus').textContent='Save failed: '+err.message}
 finally{button.disabled=false}
};
App.onSession(async(session,profile)=>{
 authorized=!!session&&!!profile?.is_admin;
 if(!authorized){$('error').textContent='Global administrator access required.';$('dashboard').hidden=true;return}
 await load();
});
})();