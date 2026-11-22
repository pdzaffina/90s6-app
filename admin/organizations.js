(() => {
'use strict';
const $=id=>document.getElementById(id),sb=App.sb;
const features=[['portfolio_management','Portfolio Management'],['work_board','Work Boards'],['training','Training'],['prompt_library','Prompt Library'],['content_studio','Content Studio'],['studio_courses','Course editing'],['studio_prompts','Prompt editing'],['studio_knowledge','Knowledge editing'],['knowledge_base','Knowledge Base'],['use_case_curator','Create Custom Plan']];
async function load(){
 const tenant=$('globalOrgFeatureTenant').value;
 const area=$('globalOrgFeatureOptions');area.replaceChildren();
 if(!tenant)return;
 const {data,error}=await sb.rpc('global_organization_feature_snapshot',{p_tenant:tenant});
 if(error){$('globalOrgFeatureStatus').textContent=error.message;return;}
 for(const [key,label] of features){
  const wrap=document.createElement('label'),check=document.createElement('input');
  check.type='checkbox';check.value=key;
  const tag=document.createElement('span');tag.textContent=' '+label+' ('+(data?.[key]===false?'Off':'On')+')';
  wrap.append(check,tag);area.append(wrap);
 }
}
$('globalOrgFeatureTenant').onchange=load;
async function apply(enabled){
 const tenant=$('globalOrgFeatureTenant').value;
 const selected=[...$('globalOrgFeatureOptions').querySelectorAll('input:checked')].map(c=>c.value);
 if(!tenant||!selected.length){$('globalOrgFeatureStatus').textContent='Choose an organization and at least one application.';return;}
 const buttons=[$('globalOrgFeaturesOn'),$('globalOrgFeaturesOff')];buttons.forEach(b=>b.disabled=true);
 try{
  const {data,error}=await sb.rpc('global_manage_organization_features',{p_tenant:tenant,p_features:selected,p_enabled:enabled});
  if(error)throw error;
  $('globalOrgFeatureStatus').textContent=data+' organization application settings saved.';
  await load();
 }catch(e){$('globalOrgFeatureStatus').textContent=e.message;}
 finally{buttons.forEach(b=>b.disabled=false);}
}
$('globalOrgFeaturesOn').onclick=()=>apply(true);
$('globalOrgFeaturesOff').onclick=()=>apply(false);
$('globalCreateOrgForm').onsubmit=async e=>{
 e.preventDefault();const msg=$('globalOrgCreateStatus');msg.textContent='Creating organization...';
 const name=$('globalOrgName').value.trim(),slug=$('globalOrgSlug').value.trim().toLowerCase();
 try{
  const {error}=await sb.rpc('global_create_tenant',{p_name:name,p_slug:slug});
  if(error)throw error;
  msg.textContent='Organization created. Reload to see it in the organization selectors.';
  $('globalCreateOrgForm').reset();
 }catch(err){msg.textContent=err.message;}
};
})();