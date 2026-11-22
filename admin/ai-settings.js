(()=>{'use strict';
const $=id=>document.getElementById(id);
const form=$('globalAiForm'),status=$('globalAiStatus');
if(!form)return;
const say=(message,error=false)=>{status.textContent=message;status.className='ap-msg'+(error?' err':'');};
const rpc=async(name,args={})=>{const {data,error}=await App.sb.rpc(name,args);if(error)throw Error(error.message);return data;};
let allowed=false;
async function refreshModels(selected){
 const picker=$('globalAiModel'),button=$('globalAiRefreshModels');
 button.disabled=true;picker.disabled=true;say('Loading models from NVIDIA…');
 try{
  const {data,error}=await App.sb.functions.invoke('ainbox-ai-models',{body:{}});
  if(error||data?.error)throw Error(data?.error||error.message);
  if(!Array.isArray(data?.models)||!data.models.length)throw Error('No models returned');
  picker.replaceChildren();
  for(const model of data.models)picker.add(new Option(model.label===model.id?model.id:model.label+' ('+model.id+')',model.id));
  if(selected&&!data.models.some(m=>m.id===selected))picker.add(new Option('Currently configured: '+selected,selected));
  picker.value=selected&&Array.from(picker.options).some(x=>x.value===selected)?selected:data.models[0].id;
  say(data.models.length+' provider models loaded. Some may not support chat completions.');
 }catch(e){
  picker.replaceChildren(new Option('GPT-OSS 20B (fallback)','openai/gpt-oss-20b'),new Option('GPT-OSS 120B (fallback)','openai/gpt-oss-120b'));
  if(selected&&!Array.from(picker.options).some(x=>x.value===selected))picker.add(new Option('Currently configured: '+selected,selected));
  picker.value=selected||'openai/gpt-oss-20b';
  say('Provider model discovery unavailable: '+e.message+'. Showing fallback choices.',true);
 }finally{button.disabled=false;picker.disabled=false;}
}
$('globalAiRefreshModels').onclick=()=>refreshModels($('globalAiModel').value);

async function load(){
 try{
  const settings=await rpc('ainbox_ai_get_settings');
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
