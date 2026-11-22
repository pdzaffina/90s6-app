(() => {
'use strict';
const $=id=>document.getElementById(id),sb=App.sb;
const features=[['portfolio_management','Portfolio Management'],['work_board','Work Boards'],['training','Training'],['prompt_library','Prompt Library'],['content_studio','Content Studio'],['studio_courses','Course editing'],['studio_prompts','Prompt editing'],['studio_knowledge','Knowledge editing'],['knowledge_base','Knowledge Base'],['use_case_curator','Create Custom Plan']];
let current=null,tenant=null,memberIds=[];
const status=t=>$('tenantAdminStatus').textContent=t;
const option=(value,label)=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;};
function selected(){return [...document.querySelectorAll('.tenant-member-check:checked')].map(c=>c.value);}
function count(){ $('tenantSelectedCount').textContent=selected().length+' selected'; }
async function refresh(){
 const requested=new URLSearchParams(location.search).get('tenant');
 tenant=requested&&(current.is_admin||App.tenantMemberships.some(m=>m.tenant_id===requested))?requested:App.activeTenantId;
 if(!tenant)return status('Select an organization.');
 if(!App.isTenantAdmin(tenant))return status('Organization administrator access required.');
 const {data:members,error:memberError}=await sb.from('tenant_members').select('user_id,role,status').eq('tenant_id',tenant);
 if(memberError)throw memberError;
 memberIds=(members||[]).map(m=>m.user_id);
 let profiles=[];
 if(memberIds.length){
  const {data,error}=await sb.from('profiles').select('id,email,full_name,is_admin,disabled').in('id',memberIds).order('email');
  if(error)throw error;profiles=data||[];
 }
 const users=profiles.filter(p=>current.is_admin||!p.is_admin);
 const map=new Map(users.map(p=>[p.id,p]));
 $('tenantAdminRows').replaceChildren();
 for(const m of members||[]){
  const p=map.get(m.user_id);if(!p)continue;
  const tr=document.createElement('tr');
  const cell=document.createElement('td');
  const check=document.createElement('input');check.type='checkbox';check.className='tenant-member-check';check.value=p.id;
  check.disabled=m.status!=='active'||p.disabled||p.is_admin;
  check.onchange=count;cell.append(check);tr.append(cell);
  for(const v of [p.email||m.user_id,p.full_name||'',m.role,m.status]){
   const td=document.createElement('td');td.textContent=v;tr.append(td);
  }
  $('tenantAdminRows').append(tr);
 }
 $('tenantMemberUser').replaceChildren(option('','Select an organization member'));
 for(const p of users.filter(p=>!p.disabled))$('tenantMemberUser').append(option(p.id,p.email));
 $('tenantFeatureOptions').replaceChildren();
 const {data:access,error:accessError}=await sb.rpc('tenant_feature_snapshot',{p_tenant:tenant});
 if(accessError)throw accessError;
 for(const [key,label] of features){
  const wrapper=document.createElement('label'),input=document.createElement('input');
  input.type='checkbox';input.value=key;input.disabled=access.organization?.[key]===false;
  wrapper.append(input,document.createTextNode(' '+label+(input.disabled?' (organization disabled)':'')));
  $('tenantFeatureOptions').append(wrapper);
 }
 count();
 status('Managing '+(App.tenantMemberships.find(m=>m.tenant_id===tenant)?.tenants?.name||'organization'));
}
App.onSession(async(session,profile)=>{
 if(!session)return;current=profile;
 const requested=new URLSearchParams(location.search).get('tenant');
 if(!App.isTenantAdmin(requested||App.activeTenantId)){status('Organization administrator access required.');return;}
 $('tenantAdminPanel').hidden=false;
 try{await refresh()}catch(e){status(e.message)}
});
$('tenantSelectAll').onclick=()=>{const checks=[...document.querySelectorAll('.tenant-member-check:not(:disabled)')];const all=checks.every(c=>c.checked);checks.forEach(c=>c.checked=!all);$('tenantSelectAllCheck').checked=!all;count();};
$('tenantSelectAllCheck').onchange=e=>{document.querySelectorAll('.tenant-member-check:not(:disabled)').forEach(c=>c.checked=e.target.checked);count();};
async function apply(enabled){
 const ids=selected(),keys=[...$('tenantFeatureOptions').querySelectorAll('input:checked')].map(c=>c.value);
 if(!ids.length||!keys.length){$('tenantFeatureStatus').textContent='Select members and applications.';return;}
 const buttons=[$('tenantFeaturesOn'),$('tenantFeaturesOff')];buttons.forEach(b=>b.disabled=true);
 try{const {data,error}=await sb.rpc('manage_tenant_features',{p_tenant:tenant,p_users:ids,p_features:keys,p_enabled:enabled});if(error)throw error;$('tenantFeatureStatus').textContent=data+' application assignments saved.';}
 catch(e){$('tenantFeatureStatus').textContent=e.message;}
 finally{buttons.forEach(b=>b.disabled=false);}
}
$('tenantFeaturesOn').onclick=()=>apply(true);
$('tenantFeaturesOff').onclick=()=>apply(false);
$('tenantMemberForm').onsubmit=async e=>{
 e.preventDefault();const user=$('tenantMemberUser').value;if(!user)return;
 status('Saving...');
 const {error}=await sb.rpc('tenant_set_member',{p_tenant:tenant,p_user:user,p_role:$('tenantMemberRole').value,p_status:$('tenantMemberStatus').value});
 if(error)return status(error.message);try{await refresh()}catch(e){status(e.message)}
};
})();