(()=>{
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const steps=[
 {title:'What would you like to accomplish?',options:[['setup','Set up a portfolio','overview'],['intake','Collect initiatives','backlogs'],['prioritize','Prioritize initiatives','prioritize'],['scenario','Build a roadmap scenario','roadmaps'],['review','Review strategic tradeoffs','strategy']]},
 {title:'How complete is the information?',options:[['ready','Initiatives and estimates are ready'],['partial','Some details need refinement'],['starting','I am starting from scratch']]},
 {title:'What kind of help do you want?',options:[['navigate','Take me to the right workspace'],['explain','Explain the next decision first']]}
];
let step=0,answers={};
const dialog=document.createElement('dialog');dialog.id='portfolioPlanningDialog';dialog.style.cssText='border:1px solid #dce3eb;border-radius:14px;padding:22px;width:min(590px,calc(100vw - 40px));max-height:85vh;overflow:auto;color:#101e32;background:white;box-shadow:0 15px 55px #0003';
const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin:12px 0';
function button(label,click){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=click;b.style.cssText='padding:9px 13px;border:1px solid #a9cfe8;border-radius:8px;background:#eaf2f8;color:#175b89;font-weight:700;cursor:pointer';return b}
function snapshot(){return window.PortfolioAIContext?.snapshot()}
function renderGuide(){
 const saved=JSON.parse(sessionStorage.getItem('pm-guide-progress')||'{}');if(!Object.keys(answers).length){step=saved.step||0;answers=saved.answers||{}}
 const current=steps[step];dialog.replaceChildren();
 const title=document.createElement('h2');title.textContent='Portfolio Guide';dialog.append(title);
 const progress=document.createElement('p');progress.textContent='Step '+(step+1)+' of '+steps.length+' · '+current.title;dialog.append(progress);
 for(const [key,label] of current.options){const b=button((answers[step]===key?'✓ ':'')+label,()=>{answers[step]=key;sessionStorage.setItem('pm-guide-progress',JSON.stringify({step,answers}));renderGuide()});b.style.display='block';b.style.width='100%';b.style.textAlign='left';b.style.margin='8px 0';dialog.append(b)}
 const nav=document.createElement('div');nav.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:18px';
 nav.append(button('Close',()=>dialog.close()));
 if(step)nav.append(button('Back',()=>{step--;renderGuide()}));
 if(step<steps.length-1)nav.append(button('Continue',()=>{if(!answers[step])return;step++;sessionStorage.setItem('pm-guide-progress',JSON.stringify({step,answers}));renderGuide()}));
 else nav.append(button('Open workspace',()=>{if(!answers[step])return;const goal=steps[0].options.find(o=>o[0]===answers[0]);dialog.close();window.PortfolioAIContext.navigate(goal?.[2]||'overview');sessionStorage.removeItem('pm-guide-progress');answers={};step=0}));
 dialog.append(nav);
 if(step===2&&answers[2]==='explain'){const note=document.createElement('p');note.textContent='Start by confirming the objective and data quality. Then use the existing workspace to make and record decisions. AI can assist with interpretation, but does not change your choices.';dialog.append(note)}
}
function generateDraft(data,mode){
 const ranked=[...data.items].sort((a,b)=>{const val=i=>mode==='speed'?((6-Number(i.effort||3))*20+Number(i.urgency||0)*12):mode==='impact'?(Number(i.alignment||0)*20+Number(i.impact||0)*20):mode==='risk'?(Number(i.alignment||0)*18+(i.description?20:0)+(6-Number(i.effort||3))*10):i.score;return val(b)-val(a)||a.title.localeCompare(b.title)});
 const source=data.scenarios.find(s=>s.id===data.currentScenarioId);
 const capacity=source?.role_capacity||{};
 const usage={Now:{},Next:{},Later:{}};
 const placement=ranked.map((i,index)=>{
 let horizon=index<Math.ceil(ranked.length/3)?'Now':index<Math.ceil(2*ranked.length/3)?'Next':'Later';
 if(mode==='capacity'&&source){
  const demand=Number(i.estimated_days||0);
  const limits={Now:Number(source.capacity_now),Next:Number(source.capacity_next),Later:Number(source.capacity_later)};
  if(demand>0)for(const h of ['Now','Next','Later']){if(!Number.isFinite(limits[h])||limits[h]<=0||((usage[h].days||0)+demand)<=limits[h]){horizon=h;break}}
  usage[horizon].days=(usage[horizon].days||0)+demand;
 }
 return {initiative_id:i.id,title:i.title,horizon,sort_order:index,score:i.score};
 });
 return {placement,capacity,source,ranked};
}
function renderScenario(){
 const data=snapshot();dialog.replaceChildren();
 const title=document.createElement('h2');title.textContent='Generate Scenario';dialog.append(title);
 if(!data?.portfolioId||!data.items.length){const p=document.createElement('p');p.textContent='Select a portfolio with initiatives first.';dialog.append(p,button('Close',()=>dialog.close()));return}
 const desc=document.createElement('p');desc.textContent='Choose a planning strategy. The application builds a deterministic draft from existing initiative scores and estimates. Review every placement before saving.';dialog.append(desc);
 const select=document.createElement('select');select.style.cssText='width:100%;padding:10px;margin:8px 0 12px';
 for(const [key,label] of [['capacity','Capacity-aware'],['impact','Strategic impact'],['speed','Fast delivery'],['risk','Reduce execution risk']])select.add(new Option(label,key));
 const preview=document.createElement('div');preview.style.cssText='max-height:290px;overflow:auto;margin:12px 0';
 const status=document.createElement('p');status.setAttribute('role','status');
 const name=document.createElement('input');name.placeholder='Scenario name';name.value=(()=>{const d=new Date();const stamp=String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+d.getFullYear();const adjectives=['gilded','wobbly','cosmic','dancing','fuzzy','polka-dot','merry','whimsical','sparkling','bumbling'];const nouns=['lilly','platypus','teapot','turnip','noodle','penguin','waffle','banjo','pickle','marmalade'];const silly=adjectives[Math.floor(Math.random()*adjectives.length)]+' '+nouns[Math.floor(Math.random()*nouns.length)];return 'AI-assisted scenario - '+silly+' - '+stamp})();name.maxLength=120;name.style.cssText='box-sizing:border-box;width:100%;padding:10px';
 const save=button('Save as new draft',async()=>{
  const current=snapshot();if(!current?.canEdit){status.textContent='Editor access required.';return}
  if(!name.value.trim()){status.textContent='Enter a scenario name.';return}
  save.disabled=true;
  try{
   const sb=App.sb;
   const {data:sc,error}=await sb.from('pm_scenarios').insert({portfolio_id:current.portfolioId,name:name.value.trim(),role_capacity:plan.capacity}).select('id').single();if(error)throw error;
   const rows=plan.placement.map(p=>({scenario_id:sc.id,initiative_id:p.initiative_id,horizon:p.horizon,sort_order:p.sort_order}));
   const result=await sb.from('pm_scenario_items').insert(rows);
   if(result.error){await sb.from('pm_scenarios').delete().eq('id',sc.id);throw result.error}
   await window.PortfolioAIContext.refresh();dialog.close();window.PortfolioAIContext.navigate('roadmaps');
  }catch(e){status.textContent='Unable to save scenario: '+e.message}finally{save.disabled=false}
 });
 let plan;
 const update=()=>{plan=generateDraft(data,select.value);preview.replaceChildren();for(const h of ['Now','Next','Later']){const heading=document.createElement('h3');heading.textContent=h;preview.append(heading);const list=document.createElement('ul');for(const p of plan.placement.filter(p=>p.horizon===h)){const li=document.createElement('li');li.textContent=p.title+' (score '+p.score+')';list.append(li)}preview.append(list)}status.textContent='Draft only. Capacity estimates are advisory; review role-specific constraints before saving.'};
 select.onchange=update;
 dialog.append(select,name,preview,status);
 const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';row.append(button('Cancel',()=>dialog.close()),save);
 const interpret=button('✦ AI critique',async()=>{interpret.disabled=true;status.textContent='Requesting AI critique...';try{const current=snapshot();const result=await NinetysixAI.request({supabase:App.sb,tenantId:current.tenantId,app:'portfolio',content:JSON.stringify({task:'Critique this proposed scenario, identify missing estimates and capacity conflicts. Do not invent data or make changes.',strategy:select.value,placements:plan.placement,initiative_estimates:current.items.map(i=>({id:i.id,title:i.title,estimated_days:i.estimated_days,score:i.score})),capacity:plan.source?.role_capacity||{}})});const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:12px';pre.textContent=result.text;preview.after(pre);status.textContent='AI critique generated. Review before saving.'}catch(e){status.textContent='AI critique unavailable: '+e.message}finally{interpret.disabled=false}});
 row.append(interpret);dialog.append(row);update();
 App.sb.rpc('ai_platform_authorized',{p_tenant:data.tenantId,p_component:'platform_portfolio'}).then(({data:allowed})=>{interpret.hidden=allowed!==true}).catch(()=>{interpret.hidden=true});
}
function init(){if(!window.PortfolioAIContext)return;const host=document.querySelector('.toolbar');if(!host)return;
 const guide=button('Portfolio Guide',()=>{answers={};step=0;renderGuide();dialog.showModal()});
 const scenario=button('✦ Generate Scenario',()=>{renderScenario();dialog.showModal()});scenario.classList.add('ap-ai-action');
 actions.append(guide,scenario);host.after(actions);document.body.append(dialog);
 scenario.hidden=true;
 App.onSession(async session=>{scenario.hidden=true;if(!session||!App.activeTenantId)return;try{const {data}=await App.sb.rpc('ai_platform_authorized',{p_tenant:App.activeTenantId,p_component:'platform_portfolio'});scenario.hidden=data!==true}catch(_){scenario.hidden=true}});
}
if(window.PortfolioAIContext)init();else document.addEventListener('portfolio-ai-ready',init,{once:true});
})();