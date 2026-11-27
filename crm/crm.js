(()=>{'use strict';
const $=id=>document.getElementById(id),sb=App.sb;
const pages=[['overview','Overview'],['accounts','Customers'],['contacts','Associates'],['engagements','Engagements'],['commitments','Commitments'],['activities','Activities'],['feedback','Feedback'],['health','Relationship Health'],['settings','Configuration']];
const models={
 accounts:{table:'crm_accounts',title:'Customer',fields:[['name','Customer name','text',true],['account_type','Type','select',false,['department','division','business_unit','other']],['description','Description','textarea']]},
 contacts:{table:'crm_contacts',title:'Associate',fields:[['full_name','Full name','text',true],['title','Job title'],['email','Email','email'],['phone','Phone'],['notes','Notes','textarea']]},
 engagements:{table:'crm_engagements',title:'Engagement',feature:'engagements',fields:[['title','Title','text',true],['account_id','Customer','accounts',true],['stage','Stage','select',false,['identified','discovery','evaluating','committed','in_progress','completed','on_hold','declined','cancelled']],['priority','Priority','select',false,['low','medium','high','critical']],['description','Description','textarea'],['desired_outcome','Desired outcome','textarea'],['target_date','Target date','date']]},
 commitments:{table:'crm_commitments',title:'Commitment',feature:'commitments',fields:[['description','Commitment','textarea',true],['account_id','Customer','accounts',true],['engagement_id','Engagement','engagements'],['status','Status','select',false,['open','in_progress','at_risk','fulfilled','cancelled']],['due_date','Due date','date'],['completion_notes','Completion notes','textarea']]},
 activities:{table:'crm_activities',title:'Activity',fields:[['subject','Subject','text',true],['kind','Type','select',false,['note','meeting','call','email','other']],['account_id','Customer','accounts'],['contact_id','Associate','contacts'],['engagement_id','Engagement','engagements'],['details','Details','textarea'],['occurred_at','Occurred at','datetime-local']]},
 feedback:{table:'crm_feedback',title:'Feedback',feature:'feedback',fields:[['account_id','Customer','accounts',true],['engagement_id','Engagement','engagements'],['rating','Rating (1–5)','number'],['comments','Comments','textarea'],['visibility','Visibility','select',false,['team','restricted']]]},
 health:{table:'crm_health',title:'Health assessment',feature:'health',fields:[['account_id','Customer','accounts',true],['dimension','Dimension','select',true,['engagement','responsiveness','commitments','satisfaction','alignment']],['score','Score (0–100)','number'],['notes','Evidence / notes','textarea']]}
};
let tenant=null,profile=null,settings=null,page='overview',cache={},canEdit=false;
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const notice=(msg)=>{$('crmNotice').textContent=msg||''};
const enabled=k=>!models[k]?.feature||settings?.[models[k].feature]!==false;
const titleOf=(kind,id)=>cache[kind]?.find(x=>x.id===id)?.name||cache[kind]?.find(x=>x.id===id)?.full_name||cache[kind]?.find(x=>x.id===id)?.title||'';
const pretty=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase());
async function load(){
 const entries=Object.entries(models).filter(([k])=>enabled(k));
 const results=await Promise.all(entries.map(async([k,m])=>{const r=await sb.from(m.table).select('*').eq('org_id',tenant).order('created_at',{ascending:false}).limit(500);return [k,r]}));
 for(const [k,r] of results){if(r.error)throw r.error;cache[k]=r.data||[];}
}
async function boot(s,p){
 tenant=App.activeTenantId;profile=p;canEdit=App.isTenantAdmin()||App.tenantRole()==='superuser';
 if(!tenant){notice('Choose an organization to use CRM.');return;}
 const r=await sb.from('crm_settings').select('*').eq('org_id',tenant).maybeSingle();
 if(r.error){notice('CRM database is not ready: '+r.error.message);return;}
 settings=r.data||{org_id:tenant,operating_mode:'internal',engagements:true,health:true,commitments:true,feedback:true,sales:false,forecast:false,ai:true};
 try{await load();render();}catch(e){notice(e.message);}
}
function renderNav(){
 const nav=$('crmNav');nav.replaceChildren();
 for(const [k,label] of pages){if(k==='settings'&&!canEdit)continue;if(!enabled(k))continue;
 const b=node('button','',label);b.type='button';if(page===k)b.setAttribute('aria-current','page');
 b.onclick=()=>{page=k;render()};nav.append(b);}
}
function render(){
 if(!enabled(page))page='overview';renderNav();
 $('crmTitle').textContent=pages.find(x=>x[0]===page)?.[1]||'CRM';
 $('crmSubtitle').textContent=page==='overview'?'Internal customer relationships and service delivery':page==='settings'?'Organization CRM preferences':'Manage '+$('crmTitle').textContent.toLowerCase();
 $('crmAdd').hidden=!canEdit||!models[page];$('crmAdd').textContent='Add '+(models[page]?.title||'');
 const view=$('crmView');view.replaceChildren();
 if(page==='overview')return overview(view);
 if(page==='settings')return renderSettings(view);
 const list=cache[page]||[];
 const search=node('input');search.type='search';search.placeholder='Search '+page;search.setAttribute('aria-label','Search '+page);
 const filters=node('div','crm-filters');filters.append(search);view.append(filters);
 const body=node('div');view.append(body);
 function draw(){body.replaceChildren();const q=search.value.toLowerCase();const rows=list.filter(r=>Object.values(r).some(v=>typeof v==='string'&&v.toLowerCase().includes(q)));
 if(!rows.length){body.append(node('div','crm-empty','No matching records yet.'));return;}
 for(const r of rows){const item=node('div','crm-item');const left=node('div');
 left.append(node('strong','',r.name||r.full_name||r.title||r.subject||r.description||r.dimension||'Feedback'));
 const detail=[r.stage,r.status,r.kind,r.due_date,r.account_id&&titleOf('accounts',r.account_id)].filter(Boolean).map(pretty).join(' · ');
 left.append(node('div','crm-muted',detail));
 if(page==='accounts'&&App.hasFeature('news_watch'))left.append(SentinelLinks.control('account_id',r.id));
 item.append(left);
 if(canEdit){const edit=node('button','','Edit');edit.type='button';edit.onclick=()=>openForm(page,r);item.append(edit);}
 body.append(item);}}
 search.oninput=draw;draw();
}
function overview(view){
 const cards=node('div','crm-grid');
 for(const [label,value] of [['Customers',cache.accounts?.length||0],['Associates',cache.contacts?.length||0],['Active engagements',(cache.engagements||[]).filter(x=>!['completed','cancelled','declined'].includes(x.stage)).length],['Open commitments',(cache.commitments||[]).filter(x=>!['fulfilled','cancelled'].includes(x.status)).length]]){
 const c=node('div','crm-card');c.append(node('span','crm-muted',label),node('strong','',String(value)));cards.append(c);}
 view.append(cards);view.append(node('h3','','Needs attention'));
 const overdue=(cache.commitments||[]).filter(x=>x.due_date&&x.due_date<new Date().toISOString().slice(0,10)&&!['fulfilled','cancelled'].includes(x.status));
 if(!overdue.length)view.append(node('p','crm-muted','No overdue commitments.'));
 for(const x of overdue){const item=node('div','crm-item');item.append(node('span','',x.description),node('span','crm-pill','Due '+x.due_date));view.append(item);}
}
function renderSettings(view){
 const mode=node('label','crm-setting','Operating mode');const select=node('select');
 for(const v of ['internal','commercial','hybrid']){const o=node('option','',pretty(v));o.value=v;select.append(o);}select.value=settings.operating_mode;mode.append(select);view.append(mode);
 const flags=['engagements','health','commitments','feedback','sales','forecast','ai'];
 const inputs={};for(const k of flags){const label=node('label','crm-setting',pretty(k));const check=node('input');check.type='checkbox';check.checked=!!settings[k];inputs[k]=check;label.append(check);view.append(label);}
 const save=node('button','','Save configuration');save.type='button';save.onclick=async()=>{
 const values=Object.fromEntries(flags.map(k=>[k,inputs[k].checked]));if(values.forecast&&!values.sales){notice('Revenue forecasting requires sales.');return;}
 save.disabled=true;const payload={...values,operating_mode:select.value,updated_by:profile.id,updated_at:new Date().toISOString()};
 const r=await sb.from('crm_settings').upsert({org_id:tenant,...payload},{onConflict:'org_id'}).select().single();save.disabled=false;
 if(r.error)return notice(r.error.message);settings=r.data;notice('CRM configuration saved.');try{await load();render();}catch(e){notice(e.message);}
 };view.append(save);
 const note=node('p','crm-muted','Disabled features preserve historical data. Sales and revenue forecasting are not part of the internal workspace.');view.append(note);
}
async function openForm(kind,record){
 const m=models[kind];$('crmDialogTitle').textContent=(record?'Edit ':'Add ')+m.title;
 const fields=$('crmFields');fields.replaceChildren();
 for(const [key,label,type='text',required=false,options] of m.fields){
 const wrap=node('label','',label);let input;
 if(type==='textarea')input=node('textarea');
 else if(type==='select'||['accounts','contacts','engagements'].includes(type)){
 input=node('select');if(!required){const blank=node('option','','None');blank.value='';input.append(blank);}
 const opts=options?options.map(v=>({id:v,name:pretty(v)})):(cache[type]||[]).map(v=>({id:v.id,name:v.name||v.full_name||v.title}));
 for(const v of opts){const o=node('option','',v.name);o.value=v.id;input.append(o);}
 }else{input=node('input');input.type=type;if(type==='number'){input.min=key==='rating'?'1':'0';input.max=key==='rating'?'5':'100';}}
 input.name=key;input.required=required;if(record?.[key]!=null)input.value=type==='datetime-local'?String(record[key]).slice(0,16):record[key];
 wrap.append(input);fields.append(wrap);
 }
 $('crmForm').onsubmit=async e=>{e.preventDefault();const payload={org_id:tenant};
 for(const [key,,type] of m.fields){const el=fields.querySelector('[name="'+key+'"]');let v=el.value.trim();payload[key]=v===''?null:(type==='number'?Number(v):v);}
 if(kind==='activities'&&!record)payload.created_by=profile.id;
 if(kind==='feedback'&&!record)payload.created_by=profile.id;
 if(kind==='health'&&!record)payload.assessed_by=profile.id;
 if(record)payload.updated_at=new Date().toISOString();
 const submit=$('crmForm').querySelector('[type=submit]');submit.disabled=true;
 let query=record?sb.from(m.table).update(payload).eq('id',record.id).eq('org_id',tenant):sb.from(m.table).insert(payload);
 const r=await query.select().single();submit.disabled=false;
 if(r.error)return notice(r.error.message);
 $('crmDialog').close();notice(m.title+' saved.');try{await load();render();}catch(err){notice(err.message);}
 };
 $('crmDialog').showModal();
}
$('crmCancel').onclick=()=>$('crmDialog').close();
$('crmAdd').onclick=()=>openForm(page,null);
App.onSession((s,p)=>{if(s&&p)boot(s,p)});
})();