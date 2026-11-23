(function(){
'use strict';
const config={portfolio:'Portfolio Management',workboard:'Work Boards',knowledge:'Knowledge Base',content:'Content Studio'};
const app=document.currentScript?.dataset.aiApp;
if(!config[app])return;
function el(tag,attrs={},text){const n=document.createElement(tag);Object.assign(n,attrs);if(text!==undefined)n.textContent=text;return n}
const launch=el('button',{type:'button',id:'sharedAiLaunch',className:'ap-ai-action',hidden:true},'✦ AI assistant');
launch.style.cssText='padding:10px 16px;font:600 14px system-ui';
const panel=el('section',{id:'sharedAiPanel'});panel.hidden=true;panel.style.cssText='position:fixed;right:20px;bottom:76px;z-index:901;width:min(440px,calc(100vw - 40px));max-height:75vh;overflow:auto;background:var(--ap-paper,#fff);color:var(--ap-ink,#101e32);border:1px solid #dce3eb;border-radius:14px;padding:18px;box-shadow:0 12px 45px #0003;font:14px system-ui';
const head=el('div');head.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:10px';
const close=el('button',{type:'button'},'Close');close.onclick=()=>panel.hidden=true;
head.append(el('strong',{},config[app]+' AI assistant'),close);
const desc=el('p',{},'Provide only the information you want the AI to analyze. Responses are audited and subject to organization AI settings.');
const field=el('textarea',{rows:7,placeholder:'Paste selected content or describe what you want analyzed (maximum 20,000 characters).',maxLength:20000});field.style.cssText='box-sizing:border-box;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;resize:vertical';
const run=el('button',{type:'button',className:'ap-ai-action'},'✦ Generate AI response');run.style.cssText='padding:10px 14px';
const status=el('p',{role:'status'});status.style.cssText='color:#64748b;font-size:12px';
const output=el('pre');output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-height:260px;overflow:auto';
run.onclick=async()=>{
 if(!aiAllowed){panel.hidden=true;return}
 run.disabled=true;status.textContent='Generating...';
 try{
  const tenantId=window.App?.activeTenantId;
  if(!tenantId)throw Error('Select an organization first.');
  const result=await window.NinetysixAI.request({supabase:window.App.sb,tenantId,app,content:field.value});
  output.textContent=result.text;status.textContent=result.model+' · '+(result.outputTokens??'?')+' output tokens · Audit '+result.usageId;
 }catch(e){status.textContent='AI unavailable: '+e.message}
 finally{run.disabled=false}
};
panel.append(head,desc,field,run,status,output);
let aiAllowed=false;
async function refreshAvailability(session){
 aiAllowed=false;launch.hidden=true;panel.hidden=true;
 if(!session||!window.App?.activeTenantId)return;
 try{
  const {data,error}=await window.App.sb.rpc('ai_platform_authorized',{
   p_tenant:window.App.activeTenantId,p_component:window.NinetysixAI.components[app]
  });
  if(error)throw error;
  aiAllowed=data===true;
  launch.hidden=!aiAllowed;
 }catch(e){console.warn('AI assistant availability could not be checked',e)}
}
window.App?.onSession((session)=>{void refreshAvailability(session)});
launch.onclick=()=>{if(!aiAllowed)return;panel.hidden=!panel.hidden;if(!panel.hidden)field.focus()};
const toolbar=document.querySelector('header .toolbar');
if(toolbar){toolbar.prepend(launch)}else{launch.style.cssText+=';position:fixed;right:20px;bottom:20px;z-index:900';document.body.append(launch)}
document.body.append(panel);
})();
