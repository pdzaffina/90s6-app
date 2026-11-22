(()=>{'use strict';
const $=id=>document.getElementById(id);
const form=$('globalAiForm'),status=$('globalAiStatus');
if(!form)return;
const say=(message,error=false)=>{status.textContent=message;status.className='ap-msg'+(error?' err':'');};
const rpc=async(name,args={})=>{const {data,error}=await App.sb.rpc(name,args);if(error)throw Error(error.message);return data;};
let allowed=false;
async function load(){
 try{
  const settings=await rpc('ainbox_ai_get_settings');
  $('globalAiModel').value=settings.model;
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
