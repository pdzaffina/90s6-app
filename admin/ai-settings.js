(()=>{'use strict';
const $=id=>document.getElementById(id);
const form=$('globalAiForm'),status=$('globalAiStatus');
if(!form)return;
const say=(message,error=false)=>{status.textContent=message;status.className='ap-msg'+(error?' err':'');};
const rpc=async(name,args={})=>{const {data,error}=await App.sb.rpc(name,args);if(error)throw Error(error.message);return data;};
let allowed=false;let discoveredModels=[];let defaultModel='';
const enabledToggle=$('globalAiEnabled');
enabledToggle.onchange=async()=>{const desired=enabledToggle.checked;enabledToggle.disabled=true;try{await rpc('ainbox_ai_set_enabled',{p_enabled:desired});$('globalAiSwitchStatus').textContent=desired?'AI enabled':'AI disabled';}catch(e){enabledToggle.checked=!desired;say('Could not change AI state: '+e.message,true)}finally{enabledToggle.disabled=false}};
const updateReasoning=()=>{const model=$('globalAiTestType').value==='alternate'?$('globalAiAlternateModel').value:$('globalAiModel').value;const supports=model.startsWith('openai/gpt-oss-');$('globalAiReasoning').disabled=!supports;if(!supports)$('globalAiReasoning').value='auto';};
$('globalAiAlternateModel').onchange=updateReasoning;
$('globalAiModel').onchange=updateReasoning;
$('globalAiTestType').onchange=()=>{$('globalAiAlternateWrap').hidden=$('globalAiTestType').value!=='alternate';updateReasoning();};
$('globalAiTest').onclick=async()=>{
 if(!allowed)return;
 const button=$('globalAiTest'),output=$('globalAiTestResult');
 button.disabled=true;output.textContent='Testing saved model with a minimal request (up to 60 seconds)…';
 try{
  const {data,error}=await App.sb.functions.invoke('ainbox-ai-diagnostic',{body:{test:$('globalAiTestType').value,model:$('globalAiAlternateModel').value,tokens:Number($('globalAiTestTokens').value),reasoning:$('globalAiReasoning').value}});
  if(error){let message=error.message;try{const payload=await error.context?.json();message=payload?.error||message}catch{}throw Error(message)}
  if(data?.error)throw Error(data.error);
  const fmt=ms=>ms===null||ms===undefined?'not reached':(ms/1000).toFixed(3)+' seconds';
  output.textContent=[
   'Test: '+(data.test??'minimal'),
   'Model: '+data.model,
   'Token budget: '+(data.token_budget??'not provided'),
   'Reasoning control: '+(data.reasoning_control??'provider default'),
   'HTTP status: '+(data.http_status??'no provider response'),
   'Time to response headers: '+fmt(data.headers_ms),
   'Time to first streamed token: '+fmt(data.first_token_ms),
   'Time to complete response: '+fmt(data.body_ms??data.elapsed_ms),
   'Models returned: '+(data.model_count??'not applicable'),
   'Visible text returned: '+(data.visible_text===undefined?'unknown':data.visible_text?'yes':'no'),
   'Finish reason: '+(data.finish_reason??'not provided'),
   'Completion tokens: '+(data.completion_tokens??'not provided'),
   'Reasoning tokens: '+(data.reasoning_tokens??'not provided'),
   'Timed out: '+(data.timed_out?'yes':'no'),
   'Error type: '+(data.error_type??data.provider_error_type??'none')
  ].join('\n');
 }catch(e){output.textContent='Diagnostic failed: '+e.message}
 finally{button.disabled=false}
};

async function refreshModels(selected){
 const picker=$('globalAiModel'),button=$('globalAiRefreshModels');
 button.disabled=true;picker.disabled=true;say('Loading models from NVIDIA…');
 try{
  const {data,error}=await App.sb.functions.invoke('ainbox-ai-models',{body:{}});
  if(error||data?.error)throw Error(data?.error||error.message);
  if(!Array.isArray(data?.models)||!data.models.length)throw Error('No models returned');
  picker.replaceChildren();
  const alternate=$('globalAiAlternateModel'),prior=alternate.value;
  alternate.replaceChildren();
  discoveredModels=data.models.filter(m=>typeof m.id==='string'&&!/(?:^|[\\/_.-])(embed(?:ding|dings)?|rerank(?:er|ing)?|reward|speech|asr|tts)(?:$|[\\/_.-])/i.test(m.id));
  for(const model of data.models){const label=model.label===model.id?model.id:model.label+' ('+model.id+')';picker.add(new Option(label,model.id));alternate.add(new Option(label,model.id));}
  if(data.models.some(m=>m.id===prior))alternate.value=prior;
  else if(data.models.some(m=>m.id!==selected))alternate.value=data.models.find(m=>m.id!==selected).id;
  if(selected&&!data.models.some(m=>m.id===selected))picker.add(new Option('Currently configured: '+selected,selected));
  picker.value=selected&&Array.from(picker.options).some(x=>x.value===selected)?selected:data.models[0].id;
  updateReasoning();
  say(data.models.length+' provider models loaded. Some may not support chat completions.');
 }catch(e){
  discoveredModels=[{id:'openai/gpt-oss-20b',label:'GPT-OSS 20B'},{id:'openai/gpt-oss-120b',label:'GPT-OSS 120B'},{id:'meta/llama-3.1-8b-instruct',label:'Llama 3.1 8B Instruct'}];
  picker.replaceChildren(new Option('GPT-OSS 20B (fallback)','openai/gpt-oss-20b'),new Option('GPT-OSS 120B (fallback)','openai/gpt-oss-120b'));
  if(selected&&!Array.from(picker.options).some(x=>x.value===selected))picker.add(new Option('Currently configured: '+selected,selected));
  picker.value=selected||'openai/gpt-oss-20b';
  updateReasoning();
  say('Provider model discovery unavailable: '+e.message+'. Showing fallback choices.',true);
 }finally{button.disabled=false;picker.disabled=false;}
}
$('globalAiRefreshModels').onclick=()=>refreshModels($('globalAiModel').value);

async function loadComponents(){
 const list=await rpc('ainbox_ai_list_components');
 const target=$('globalAiComponents');target.replaceChildren();
 for(const component of list){
  const card=document.createElement('div');card.style.cssText='border:1px solid #dce3eb;border-radius:10px;padding:12px 14px;background:#fff';
  const header=document.createElement('div');header.style.cssText='display:flex;align-items:center;gap:12px;flex-wrap:wrap';
  const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=component.enabled;toggle.setAttribute('aria-label','Enable '+component.label);
  const info=document.createElement('div');info.style.cssText='flex:1;min-width:190px';
  const name=document.createElement('strong');name.textContent=component.label;
  const description=document.createElement('small');description.style.cssText='display:block;opacity:.7';description.textContent=component.description;
  info.append(name,description);
  const modeLabel=document.createElement('label');modeLabel.style.cssText='display:grid;gap:3px;font-size:12px';modeLabel.textContent='Configuration';
  const mode=document.createElement('select');mode.className='ap-input';mode.add(new Option('Use global settings','global'));mode.add(new Option('Custom settings','custom'));
  const custom=Boolean(component.model_override||component.timeout_override_ms||component.tokens_override);
  mode.value=custom?'custom':'global';modeLabel.append(mode);
  header.append(toggle,info,modeLabel);
  const fields=document.createElement('div');fields.style.cssText='display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid #e6ecf2';
  const makeField=(title,input)=>{const label=document.createElement('label');label.style.cssText='display:grid;gap:5px;font-size:12px';label.textContent=title;label.append(input);fields.append(label);return input};
  const model=document.createElement('select');model.className='ap-input';model.style.cssText='min-width:240px;max-width:360px';
  const current=component.model_override||defaultModel;
  for(const m of discoveredModels){if(![...model.options].some(o=>o.value===m.id))model.add(new Option(m.label&&m.label!==m.id?m.label+' ('+m.id+')':m.id,m.id))}
  if(current&&![...model.options].some(o=>o.value===current))model.add(new Option('Configured: '+current,current));
  model.value=current;
  makeField('Model',model);
  const timeout=document.createElement('input');timeout.type='number';timeout.className='ap-input';timeout.min='5';timeout.max='120';timeout.step='1';timeout.style.width='105px';timeout.value=String((component.timeout_override_ms||Number($('globalAiTimeout').value)*1000)/1000);
  makeField('Timeout (seconds)',timeout);
  const tokens=document.createElement('input');tokens.type='number';tokens.className='ap-input';tokens.min='100';tokens.max='32768';tokens.step='1';tokens.style.width='120px';tokens.value=String(component.tokens_override||$('globalAiTokens').value);
  makeField('Maximum output tokens',tokens);
  const save=document.createElement('button');save.type='button';save.className='ap-btn sm';save.textContent='Save settings';
  header.append(save);
  const status=document.createElement('small');status.style.cssText='display:block;margin-top:8px;opacity:.75';
  const sync=()=>{const enabled=mode.value==='custom';fields.hidden=!enabled;status.textContent=enabled?'Custom settings for this feature':'Inherits global model, timeout and token limit';};
  mode.onchange=sync;sync();
  card.append(header,fields,status);target.append(card);
  save.onclick=async()=>{save.disabled=true;try{
   const isCustom=mode.value==='custom',seconds=Number(timeout.value),maxTokens=Number(tokens.value);
   if(isCustom&&(!model.value||!Number.isInteger(seconds)||seconds<5||seconds>120||!Number.isInteger(maxTokens)||maxTokens<100||maxTokens>32768))throw Error('Choose a model, timeout 5–120 seconds and tokens 100–32768');
   await rpc('ainbox_ai_save_component_settings',{p_key:component.key,p_custom:isCustom,p_model:isCustom?model.value:null,p_timeout_ms:isCustom?seconds*1000:null,p_max_tokens:isCustom?maxTokens:null});
   status.textContent=isCustom?'Custom settings saved':'Global settings inheritance saved';
  }catch(e){status.textContent='Unable to save: '+e.message}finally{save.disabled=false}};
  mode.onchange=()=>{sync();save.textContent='Save settings';};
  mode.onchange();
  toggle.onchange=async()=>{const desired=toggle.checked;toggle.disabled=true;try{await rpc('ainbox_ai_set_component',{p_key:component.key,p_enabled:desired});$('globalAiComponentsStatus').textContent=component.label+(desired?' enabled':' disabled')}catch(e){toggle.checked=!desired;$('globalAiComponentsStatus').textContent='Unable to save: '+e.message}finally{toggle.disabled=false}};
 }
}
async function load(){
 try{
  const settings=await rpc('ainbox_ai_get_settings');
  const {data:enabled,error:enabledError}=await App.sb.rpc('ainbox_ai_is_enabled');if(enabledError)throw enabledError;enabledToggle.checked=enabled===true;$('globalAiSwitchStatus').textContent=enabled?'AI enabled':'AI disabled';
  defaultModel=settings.model;
  await refreshModels(settings.model);
  $('globalAiTimeout').value=String(settings.timeout_ms/1000);
  $('globalAiTokens').value=String(settings.max_tokens);
  await loadComponents();
  say('Settings loaded. Changes apply to the next AI assessment.');
 }catch(e){say('Unable to load AI settings: '+e.message,true);}
}
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if(!allowed)return;
 const model=$('globalAiModel').value,seconds=Number($('globalAiTimeout').value),tokens=Number($('globalAiTokens').value);
 if(!Number.isInteger(seconds)||seconds<5||seconds>120||!Number.isInteger(tokens)||tokens<100||tokens>4096){say('Timeout must be 5 to 60 seconds and tokens 100 to 4096.',true);return}
 const button=$('globalAiSave');button.disabled=true;say('Saving settings…');
 try{await rpc('ainbox_ai_save_settings',{p_model:model,p_timeout_ms:seconds*1000,p_max_tokens:tokens});say('Global default saved. Components with a model override will keep their independently selected model.');}
 catch(e){say('Could not save AI settings: '+e.message,true)}
 finally{button.disabled=false;}
});
App.onSession(async(session,profile)=>{
 allowed=!!session&&!!profile?.is_admin;
 $('globalAiPanel').hidden=!allowed;
 if(allowed)await load();
});
})();
