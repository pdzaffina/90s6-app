(() => {
'use strict';
const $=id=>document.getElementById(id),sb=App.sb;
let features=[];
async function loadRegistry(){const {data,error}=await sb.from('application_registry').select('feature_key,display_name').eq('active',true).order('sort_order');if(error)throw error;features=(data||[]).map(x=>[x.feature_key,x.display_name]);}
let current=null,tenant=null,memberIds=[];
const status=t=>$('tenantAdminStatus').textContent=t;
const option=(value,label)=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;};
function selected(){return [...document.querySelectorAll('.tenant-member-check:checked')].map(c=>c.value);}
function count(){ $('tenantSelectedCount').textContent=selected().length+' selected'; }
async function refresh(){
 await loadRegistry();
 const requested=new URLSearchParams(location.search).get('tenant');
 tenant=requested&&(current.is_admin||App.tenantMemberships.some(m=>m.tenant_id===requested))?requested:App.activeTenantId;
 if(!tenant)return status('Select an organization.');
 if(!App.isTenantAdmin(tenant))return status('Organization administrator access required.');
 const {data:members,error:memberError}=await sb.from('tenant_members').select('user_id,role,status').eq('tenant_id',tenant);
 if(memberError)throw memberError;
 memberIds=(members||[]).map(m=>m.user_id);
 let profiles=[];
 if(memberIds.length){
  const {data,error}=await sb.from('profiles').select('id,email,full_name,is_admin,disabled,intro_presentation_enabled').in('id',memberIds).order('email');
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
  for(const v of [p.email||m.user_id,p.full_name||'']){
   const td=document.createElement('td');td.textContent=v;tr.append(td);
  }
  const roleCell=document.createElement('td'),roleSelect=document.createElement('select');
  roleSelect.className='ap-input';roleSelect.setAttribute('aria-label','Organization role for '+(p.email||p.id));
  for(const [value,label] of [['user','User'],['superuser','Superuser'],['tenant_admin','Org Admin']])roleSelect.append(option(value,label));
  roleSelect.value=m.role;
  roleSelect.disabled=p.is_admin||p.disabled;
  roleSelect.onchange=async()=>{
    const previous=m.role;roleSelect.disabled=true;
    const {error}=await sb.rpc('tenant_set_member',{p_tenant:tenant,p_user:p.id,p_role:roleSelect.value,p_status:m.status});
    if(error){roleSelect.value=previous;status(error.message);}
    else{m.role=roleSelect.value;status('Updated organization role for '+p.email);}
    roleSelect.disabled=p.is_admin||p.disabled;
  };
  roleCell.append(roleSelect);tr.append(roleCell);
  const stateCell=document.createElement('td');stateCell.textContent=m.status+' ';const intro=document.createElement('button');intro.type='button';intro.className='ap-btn sm';intro.textContent='Welcome presentation: '+(p.intro_presentation_enabled?'On':'Off');intro.disabled=p.is_admin||p.disabled||m.status!=='active';intro.onclick=async()=>{intro.disabled=true;const {error}=await sb.rpc('set_intro_presentation',{p_user:p.id,p_enabled:!p.intro_presentation_enabled,p_tenant:tenant});if(error)status(error.message);else{p.intro_presentation_enabled=!p.intro_presentation_enabled;intro.textContent='Welcome presentation: '+(p.intro_presentation_enabled?'On':'Off');status('Welcome presentation updated for '+p.email);}intro.disabled=false;};stateCell.append(intro);tr.append(stateCell);
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
 const {data:matrix,error:matrixError}=await sb.rpc('tenant_member_feature_matrix',{p_tenant:tenant});
 if(matrixError)throw matrixError;
 const grantMap=new Map((matrix||[]).map(r=>[r.user_id+':'+r.feature,r.enabled]));
 const head=$('tenantAccessHead');head.replaceChildren();
 const first=document.createElement('th');first.textContent='User';head.append(first);
 for(const [,label] of features){const th=document.createElement('th');th.textContent=label;head.append(th);}
 const body=$('tenantAccessRows');body.replaceChildren();
 for(const m of members||[]){
  const p=map.get(m.user_id);if(!p)continue;
  const row=document.createElement('tr'),name=document.createElement('td');
  name.textContent=(p.email||p.full_name||p.id)+(m.status!=='active'?' (Inactive)':'');
  row.append(name);
  for(const [key] of features){
   const cell=document.createElement('td'),tag=document.createElement('span');
   const globallyOn=current.is_admin&&p.is_admin;
   const orgOff=access.organization?.[key]===false;
   const userOff=grantMap.get(p.id+':'+key)===false;
   const off=m.status!=='active'||p.disabled||orgOff||userOff;
   tag.className='ap-tag'+(off?' off':'');
   tag.textContent=globallyOn?'Always on':off?'Off':'On';
   if(off)tag.title=m.status!=='active'||p.disabled?'Account or membership inactive':orgOff?'Disabled for organization':'Disabled for user';
   cell.append(tag);row.append(cell);
  }
  body.append(row);
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
 try{const {data,error}=await sb.rpc('manage_tenant_features',{p_tenant:tenant,p_users:ids,p_features:keys,p_enabled:enabled});if(error)throw error;$('tenantFeatureStatus').textContent=data+' application assignments saved.';await refresh();}
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