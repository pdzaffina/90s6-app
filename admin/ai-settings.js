(()=>{'use strict';
const $=id=>document.getElementById(id);
const form=$('globalAiForm'),status=$('globalAiStatus');
if(!form)return;
const say=(message,error=false)=>{status.textContent=message;status.className='ap-msg'+(error?' err':'');};
const rpc=async(name,args={})=>{const {data,error}=await App.sb.rpc(name,args);if(error)throw Error(error.message);return data;};
let allowed=false;
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
  for(const model of data.models){const label=model.label===model.id?model.id:model.label+' ('+model.id+')';picker.add(new Option(label,model.id));alternate.add(new Option(label,model.id));}
  if(data.models.some(m=>m.id===prior))alternate.value=prior;
  else if(data.models.some(m=>m.id!==selected))alternate.value=data.models.find(m=>m.id!==selected).id;
  if(selected&&!data.models.some(m=>m.id===selected))picker.add(new Option('Currently configured: '+selected,selected));
  picker.value=selected&&Array.from(picker.options).some(x=>x.value===selected)?selected:data.models[0].id;
  updateReasoning();
  say(data.models.length+' provider models loaded. Some may not support chat completions.');
 }catch(e){
  picker.replaceChildren(new Option('GPT-OSS 20B (fallback)','openai/gpt-oss-20b'),new Option('GPT-OSS 120B (fallback)','openai/gpt-oss-120b'));
  if(selected&&!Array.from(picker.options).some(x=>x.value===selected))picker.add(new Option('Currently configured: '+selected,selected));
  picker.value=selected||'openai/gpt-oss-20b';
  updateReasoning();
  say('Provider model discovery unavailable: '+e.message+'. Showing fallback choices.',true);
 }finally{button.disabled=false;picker.disabled=false;}
}
$('globalAiRefreshModels').onclick=()=>refreshModels($('globalAiModel').value);

async function loadUsage(){
 const [usage,rates]=await Promise.all([rpc('ainbox_ai_usage_summary'),rpc('ainbox_ai_pricing')]);
 const usd=n=>'$'+Number(n||0).toFixed(4);
 $('globalAiBudget').value=Number(rates.budget);
 $('globalAiInputRate').value=Number(rates.input);
 $('globalAiOutputRate').value=Number(rates.output);
 const used=Number(usage.spent||0),reserved=Number(usage.reserved||0),budget=Number(usage.budget||0);
 const container=$('globalAiUsage');container.replaceChildren();
 const summary=document.createElement('p');
 summary.textContent='This month: '+usage.requests+' requests · '+Number(usage.input_tokens||0).toLocaleString()+' input tokens · '+Number(usage.output_tokens||0).toLocaleString()+' output tokens · '+usd(used)+' estimated spent · '+usd(reserved)+' reserved · '+usd(budget)+' limit';
 container.append(summary);
 const bar=document.createElement('progress');bar.max=Math.max(budget,0.000001);bar.value=Math.min(budget,used+reserved);bar.style.width='100%';container.append(bar);
 for(const c of usage.components||[]){const line=document.createElement('p');line.textContent=c.component_key+': '+c.requests+' requests · '+usd(c.cost);container.append(line)}
}
$('globalAiUsageRefresh').onclick=()=>loadUsage().catch(e=>$('globalAiBudgetStatus').textContent=e.message);
$('globalAiBudgetSave').onclick=async()=>{
 const budget=Number($('globalAiBudget').value),input=Number($('globalAiInputRate').value),output=Number($('globalAiOutputRate').value);
 if(![budget,input,output].every(Number.isFinite)||[budget,input,output].some(x=>x<0)){$('globalAiBudgetStatus').textContent='Enter valid nonnegative values';return}
 const button=$('globalAiBudgetSave');button.disabled=true;
 try{await rpc('ainbox_ai_set_budget',{p_usd:budget});await rpc('ainbox_ai_set_rates',{p_input:input,p_output:output});await loadUsage();$('globalAiBudgetStatus').textContent='Budget and estimated token rates saved.'}
 catch(e){$('globalAiBudgetStatus').textContent='Could not save: '+e.message}
 finally{button.disabled=false}
};
async function loadComponents(){
 const list=await rpc('ainbox_ai_list_components');
 const target=$('globalAiComponents');target.replaceChildren();
 for(const component of list){
  const row=document.createElement('label');row.style.cssText='display:flex;align-items:center;gap:12px';
  const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=component.enabled;
  const info=document.createElement('span');
  const name=document.createElement('strong');name.textContent=component.label;
  const description=document.createElement('small');description.style.cssText='display:block;opacity:.7';description.textContent=component.description;
  info.append(name,description);row.append(toggle,info);target.append(row);
  toggle.onchange=async()=>{const desired=toggle.checked;toggle.disabled=true;try{await rpc('ainbox_ai_set_component',{p_key:component.key,p_enabled:desired});$('globalAiComponentsStatus').textContent=component.label+(desired?' enabled':' disabled');}catch(e){toggle.checked=!desired;$('globalAiComponentsStatus').textContent='Unable to save: '+e.message;}finally{toggle.disabled=false;}};
 }
}
async function load(){
 try{
  const settings=await rpc('ainbox_ai_get_settings');
  const {data:enabled,error:enabledError}=await App.sb.rpc('ainbox_ai_is_enabled');if(enabledError)throw enabledError;enabledToggle.checked=enabled===true;$('globalAiSwitchStatus').textContent=enabled?'AI enabled':'AI disabled';
  await loadComponents();
  try{await loadUsage()}catch(e){$('globalAiUsage').textContent='Could not load usage: '+e.message}
  await refreshModels(settings.model);
  $('globalAiTimeout').value=String(settings.timeout_ms/1000);
  $('globalAiTokens').value=String(settings.max_tokens);
  say('Settings loaded. Changes apply to the next AI assessment.');
 }catch(e){say('Unable to load AI settings: '+e.message,true);}
}
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if(!allowed)return;
 const model=$('globalAiModel').value,seconds=Number($('globalAiTimeout').value),tokens=Number($('globalAiTokens').value);
 if(!Number.isInteger(seconds)||seconds<5||seconds>60||!Number.isInteger(tokens)||tokens<100||tokens>4096){say('Timeout must be 5 to 60 seconds and tokens 100 to 4096.',true);return}
 const button=$('globalAiSave');button.disabled=true;say('Saving settings…');
 try{await rpc('ainbox_ai_save_settings',{p_model:model,p_timeout_ms:seconds*1000,p_max_tokens:tokens});say('AI settings saved. The next assessment will use the selected configuration.');}
 catch(e){say('Could not save AI settings: '+e.message,true)}
 finally{button.disabled=false;}
});
App.onSession(async(session,profile)=>{
 allowed=!!session&&!!profile?.is_admin;
 $('globalAiPanel').hidden=!allowed;
 if(allowed)await load();
});
})();
+Number(n||0).toFixed(4);
 $('globalAiBudget').value=Number(rates.budget);
 $('globalAiInputRate').value=Number(rates.input);
 $('globalAiOutputRate').value=Number(rates.output);
 const used=Number(usage.spent||0),reserved=Number(usage.reserved||0),budget=Number(usage.budget||0);
 const container=$('globalAiUsage');container.replaceChildren();
 const summary=document.createElement('p');summary.textContent='This month: '+usage.requests+' requests · '+Number(usage.input_tokens||0).toLocaleString()+' input tokens · '+Number(usage.output_tokens||0).toLocaleString()+' output tokens · '+usd(used)+' estimated spent · '+usd(reserved)+' reserved · '+usd(budget)+' limit';
 container.append(summary);
 const bar=document.createElement('progress');bar.max=Math.max(budget,0.000001);bar.value=Math.min(budget,used+reserved);bar.style.width='100%';container.append(bar);
 for(const c of usage.components||[]){const line=document.createElement('p');line.textContent=c.component_key+': '+c.requests+' requests · '+usd(c.cost);container.append(line)}
}
$('globalAiUsageRefresh').onclick=()=>loadUsage().catch(e=>$('globalAiBudgetStatus').textContent=e.message);
$('globalAiBudgetSave').onclick=async()=>{
 const budget=Number($('globalAiBudget').value),input=Number($('globalAiInputRate').value),output=Number($('globalAiOutputRate').value);
 if(![budget,input,output].every(Number.isFinite)||[budget,input,output].some(x=>x<0)){ $('globalAiBudgetStatus').textContent='Enter valid nonnegative values';return}
 const button=$('globalAiBudgetSave');button.disabled=true;
 try{await rpc('ainbox_ai_set_budget',{p_usd:budget});await rpc('ainbox_ai_set_rates',{p_input:input,p_output:output});await loadUsage();$('globalAiBudgetStatus').textContent='Budget and estimated token rates saved.'}
 catch(e){$('globalAiBudgetStatus').textContent='Could not save: '+e.message}
 finally{button.disabled=false}
};
async function loadComponents(){
 const list=await rpc('ainbox_ai_list_components');
 const target=$('globalAiComponents');target.replaceChildren();
 for(const component of list){
  const row=document.createElement('label');row.style.cssText='display:flex;align-items:center;gap:12px';
  const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=component.enabled;
  const info=document.createElement('span');
  const name=document.createElement('strong');name.textContent=component.label;
  const description=document.createElement('small');description.style.cssText='display:block;opacity:.7';description.textContent=component.description;
  info.append(name,description);row.append(toggle,info);target.append(row);
  toggle.onchange=async()=>{const desired=toggle.checked;toggle.disabled=true;try{await rpc('ainbox_ai_set_component',{p_key:component.key,p_enabled:desired});$('globalAiComponentsStatus').textContent=component.label+(desired?' enabled':' disabled');}catch(e){toggle.checked=!desired;$('globalAiComponentsStatus').textContent='Unable to save: '+e.message;}finally{toggle.disabled=false;}};
 }
}
async function load(){
 try{
  const settings=await rpc('ainbox_ai_get_settings');
  const {data:enabled,error:enabledError}=await App.sb.rpc('ainbox_ai_is_enabled');if(enabledError)throw enabledError;enabledToggle.checked=enabled===true;$('globalAiSwitchStatus').textContent=enabled?'AI enabled':'AI disabled';
  await loadComponents();
  try{await loadUsage()}catch(e){$('globalAiUsage').textContent='Could not load usage: '+e.message}
  await refreshModels(settings.model);
  $('globalAiTimeout').value=String(settings.timeout_ms/1000);
  $('globalAiTokens').value=String(settings.max_tokens);
  say('Settings loaded. Changes apply to the next AI assessment.');
 }catch(e){say('Unable to load AI settings: '+e.message,true);}
}
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if(!allowed)return;
 const model=$('globalAiModel').value,seconds=Number($('globalAiTimeout').value),tokens=Number($('globalAiTokens').value);
 if(!Number.isInteger(seconds)||seconds<5||seconds>60||!Number.isInteger(tokens)||tokens<100||tokens>4096){say('Timeout must be 5 to 60 seconds and tokens 100 to 4096.',true);return}
 const button=$('globalAiSave');button.disabled=true;say('Saving settings…');
 try{await rpc('ainbox_ai_save_settings',{p_model:model,p_timeout_ms:seconds*1000,p_max_tokens:tokens});say('AI settings saved. The next assessment will use the selected configuration.');}
 catch(e){say('Could not save AI settings: '+e.message,true)}
 finally{button.disabled=false;}
});
App.onSession(async(session,profile)=>{
 allowed=!!session&&!!profile?.is_admin;
 $('globalAiPanel').hidden=!allowed;
 if(allowed)await load();
});
})();
