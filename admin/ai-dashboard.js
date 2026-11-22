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
  $('dashboard').hidden=false;
 }catch(e){$('error').textContent='Could not load AI usage: '+e.message}
}
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