import { IMPORT_FIELDS, readImportFile, suggestMapping, validateRows } from './bulk.mjs?v=1';
(()=>{'use strict';
const sb=App.sb,$=id=>document.getElementById(id),view=$('nwView'),nav=$('crmNav');
const pages=['Overview','Watchlist','Intelligence','Assessments','Notifications','Scan history'];
const scanStatuses={queued:'Queued',running:'Collecting intelligence',complete:'Complete',partial:'Partial',failed:'Failed'};
const pageFromUrl=()=>pages.find(p=>p.toLowerCase().replace(/ /g,'-')===new URLSearchParams(location.search).get('section'))||'Overview';
let org,user,watches=[],runs=[],page=pageFromUrl(),deepAvailable=false,integrationAccess={},briefingAvailable=false,riskReviewAvailable=false;
const dashboardFilters={category:'',relationship_type:'',severity:'',direction:'',period:'30',owner:''};
window.addEventListener('popstate',()=>{page=pageFromUrl();render()});
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
const status=t=>$('nwStatus').textContent=t;
const actions=(...nodes)=>{const a=el('div');a.className='nw-actions';a.append(...nodes);return a};
const button=(label,fn)=>{const b=el('button',label);b.className='ap-btn'+(/^(Add watch|Scan now|Import \d+ watches)$/.test(label)?' primary':'');b.type='button';b.onclick=async()=>{b.disabled=true;b.setAttribute('aria-busy','true');try{await fn()}catch(e){status(e.message||String(e))}finally{b.disabled=false;b.removeAttribute('aria-busy')}};return b};
const fields=[['name','Name'],['kind','Watch type',['company','event','topic']],['category','Category'],['relationship_type','Relationship type',['general_topic','supplier','customer','competitor','strategic_partner','technology_provider','industry','event']],['ticker','Stock ticker'],['sec_cik','SEC CIK'],['exchange','Exchange'],['website','Website'],['vendor_id','Vendor ID'],['criticality','Criticality'],['objective','Monitoring objective'],['subsidiaries','Subsidiaries (comma-separated)'],['products','Relevant products (comma-separated)'],['industry','Industry'],['geography','Geography'],['alternative_names','Alternative names (comma-separated)'],['custom_terms','Required terms (comma-separated)'],['excluded_terms','Excluded terms (comma-separated)'],['lookback_days','Lookback in days'],['investigation_rounds','Deep investigation rounds'],['investigation_searches','Deep investigation searches'],['investigation_relevance','Minimum follow-up relevance'],['feed_url','Preferred RSS or Atom feed URL'],['frequency','Frequency',['daily','6h','weekly','monthly','manual']],['recipients','Email To / distribution list'],['recipients_cc','Email CC'],['inbox_enabled','Send significant findings to Action Inbox',true],['notification_threshold','Alert severity',['off','moderate','high','critical']],['active','Active',true],['shared','Share with organization',true]];
async function load(){const a=await sb.from('sentinel_watches').select('*').eq('org_id',org).order('name');if(a.error)throw a.error;watches=a.data;const b=await sb.from('sentinel_scan_runs').select('*').eq('org_id',org).order('created_at',{ascending:false}).limit(200);if(b.error)throw b.error;runs=b.data;
 const selectedId=new URLSearchParams(location.search).get('assessment');
 if(selectedId&&/^[0-9a-f-]{36}$/i.test(selectedId)&&!runs.some(run=>run.id===selectedId)){
  const result=await sb.from('sentinel_scan_runs').select('*').eq('org_id',org).eq('id',selectedId).maybeSingle();
  if(result.error)throw result.error;
  if(result.data)runs.push(result.data);
 }
 render()}
const numberLimits={lookback_days:[1,90,7],investigation_rounds:[1,2,1],investigation_searches:[1,3,1],investigation_relevance:[0,100,70]};
function card(){const c=el('article');c.className='nw-card';return c}
function form(w={}){const c=card(),f=el('form');c.append(el('h2',w.id?'Edit watch':'New watch'),f);for(const [k,label,opts] of fields){const l=el('label',label);let i=el(Array.isArray(opts)?'select':k==='objective'?'textarea':'input');i.name=k;if(numberLimits[k]){i.type='number';[i.min,i.max]=numberLimits[k];i.required=true}if(k==='feed_url')i.type='url';if(k==='sec_cik'){i.pattern='[0-9]{1,10}';i.inputMode='numeric'};if(Array.isArray(opts)){for(const v of opts){const o=el('option',k==='relationship_type'?v.replaceAll('_',' ').replace(/^./,x=>x.toUpperCase()):v);o.value=v;i.append(o)}}else if(opts===true){i.type='checkbox';i.checked=w[k]??k==='active'}if(opts!==true)i.value=w[k]??({category:'Suppliers',criticality:'Unclassified',kind:'company',relationship_type:'general_topic',notification_threshold:'off',frequency:'daily',lookback_days:7,investigation_rounds:1,investigation_searches:1,investigation_relevance:70}[k]||'');i.required=k==='name'||!!numberLimits[k];l.append(i);f.append(l)}const save=el('button','Save watch');save.type='submit';save.className='ap-btn primary';f.append(actions(button('Cancel',render),save));f.onsubmit=async e=>{e.preventDefault();save.disabled=true;save.setAttribute('aria-busy','true');save.textContent='Saving…';try{const data=Object.fromEntries(fields.map(([k,,o])=>[k,o===true?f.elements[k].checked:numberLimits[k]?Number(f.elements[k].value):f.elements[k].value.trim()]));const q=w.id?sb.from('sentinel_watches').update(data).eq('id',w.id).eq('org_id',org):sb.from('sentinel_watches').insert({...data,org_id:org});const r=await q.select('id').single();if(r.error)throw r.error;await load();status('Watch saved')}catch(e){status(e.message)}finally{save.disabled=false;save.removeAttribute('aria-busy');save.textContent='Save watch'}};view.prepend(c)}
const selectedWatches=new Set();
function control(labelText,input){
 const label=el('label',labelText);label.append(input);return label;
}
function selectOptions(options){
 const select=el('select');
 for(const [key,label] of options){const option=el('option',label);option.value=key;select.append(option)}
 return select;
}
function importer(){
 const panel=card();
 const file=el('input');
 file.type='file';file.accept='.csv,.xlsx';
 const template=el('a','Download CSV template');
 template.href='data:text/csv;charset=utf-8,'+encodeURIComponent(Object.values(IMPORT_FIELDS).map(labels=>labels[0]).join(',')+'\r\n');
 template.download='news-watch-template.csv';
 const mappingPanel=el('div');
 panel.append(el('h2','Import watches'),el('p','Choose a CSV or XLSX file. Store identifiers with leading zeros as text.'),template,
  control('Source file',file),mappingPanel);
 file.onchange=async()=>{
  mappingPanel.replaceChildren(el('p','Reading file…'));
  try{
   const [headers,...rows]=await readImportFile(file.files[0]);
   if(!headers?.length||headers.length>80||rows.length>1000)throw Error('Use up to 1,000 data rows and 80 columns.');
   const selector=el('div'),preview=el('div'),mapping=suggestMapping(headers);
   const existing=new Set(watches.filter(w=>w.owner_id===user).map(w=>w.kind+'\u0000'+w.name.toLowerCase().trim()));
   const category=el('input');category.value='Suppliers';
   const frequency=selectOptions([['manual','Manual'],['6h','Every six hours'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']]);
   const duplicate=selectOptions([['skip','Skip duplicates'],['update','Update duplicates']]);
   const active=el('input');active.type='checkbox';active.checked=true;
   const initial=el('input');initial.type='checkbox';
   function update(){
    const plan=validateRows(rows,mapping,{category:category.value.trim()||'Suppliers',frequency:frequency.value,active:active.checked},existing,duplicate.value==='update');
    const valid=plan.filter(row=>row.values);
    const invalid=plan.filter(row=>row.status==='invalid').length;
    const table=el('table');table.className='ap-table';
    const head=el('thead'),header=el('tr');
    for(const name of ['Row','Watch','Result'])header.append(el('th',name));head.append(header);
    const body=el('tbody');
    for(const row of plan.slice(0,100)){
     const tr=el('tr');tr.append(el('td',row.row),el('td',row.name||''),el('td',row.issue||labelKey(row.status)));body.append(tr);
    }
    table.append(head,body);
    const scroll=el('div');scroll.className='nw-table-wrap';scroll.append(table);
    const summary=el('p',valid.length+' ready · '+invalid+' invalid · '+(plan.length-valid.length-invalid)+' skipped'+(plan.length>100?' · first 100 rows shown':''));
    const submit=button('Import '+valid.length+' watches',async()=>{
     const result=await sb.rpc('sentinel_import_watches',{p_org:org,p_rows:valid.map(row=>row.values),p_update:duplicate.value==='update',p_queue:initial.checked});
     if(result.error)throw result.error;
     const {inserted,updated,queued,skipped}=result.data;
     await load();status(inserted+' imported · '+updated+' updated · '+queued+' scans queued · '+skipped+' skipped');
    });
    submit.disabled=!valid.length||mapping.name<0;
    preview.replaceChildren(summary,scroll,submit);
   }
   for(const [key,labels] of Object.entries(IMPORT_FIELDS)){
    const select=selectOptions([['-1','Skip column'],...headers.map((header,index)=>[String(index),header||'Column '+(index+1)])]);
    select.value=String(mapping[key]);
    select.onchange=()=>{mapping[key]=Number(select.value);update()};
    selector.append(control(labelKey(labels[0]),select));
   }
   for(const node of [category,frequency,duplicate,active])node.addEventListener('change',update);
   mappingPanel.replaceChildren(el('h3','Map columns'),selector,el('h3','Import defaults'),
    control('Category',category),control('Frequency',frequency),control('Activate new watches',active),
    control('Duplicate handling',duplicate),control('Queue initial scans',initial),preview);
   update();
  }catch(error){mappingPanel.replaceChildren(el('p',error.message))}
 };
 view.prepend(panel);
}
function bulkEdit(){
 if(!selectedWatches.size)return status('Select the watches to update.');
 const panel=card();
 const category=el('input'),recipients=el('input'),cc=el('input');
 const frequency=selectOptions([['','Keep current'],['manual','Manual'],['6h','Every six hours'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']]);
 const active=selectOptions([['','Keep current'],['true','Activate'],['false','Deactivate']]);
 const includeRecipients=el('input');includeRecipients.type='checkbox';
 const form=el('form');
 const save=button('Apply changes',async()=>{
  const payload={};
  if(category.value.trim())payload.category=category.value.trim();
  if(frequency.value)payload.frequency=frequency.value;
  if(active.value)payload.active=active.value==='true';
  if(includeRecipients.checked){payload.recipients=recipients.value.trim();payload.recipients_cc=cc.value.trim()}
  if(!Object.keys(payload).length)return status('Choose a field to change.');
  const ids=[...selectedWatches];
  if(ids.length>100)return status('Select up to 100 watches at a time.');
  const result=await sb.from('sentinel_watches').update(payload).eq('org_id',org).eq('owner_id',user).in('id',ids).select('id');
  if(result.error)throw result.error;
  selectedWatches.clear();await load();status(result.data.length+' watches updated');
 });
 form.addEventListener('submit',event=>event.preventDefault());
 form.append(control('Category',category),control('Frequency',frequency),control('Activation',active),
  control('Replace email recipients',includeRecipients),control('Email To / distribution list',recipients),
  control('Email CC',cc),actions(button('Cancel',render),save));
 panel.append(el('h2','Update '+selectedWatches.size+' watches'),form);
 view.prepend(panel);
}
function formattedAssessment(value,allowLinks=true){
 const root=el('div');root.className='nw-assessment';
 let source=String(value??'').trim();
 if(source.startsWith('"')){try{const parsed=JSON.parse(source);if(typeof parsed==='string')source=parsed}catch{}}
 source=source.replace(/^\s*\x60{3}(?:markdown|md)?\s*\n/i,'').replace(/\n\s*\x60{3}\s*$/,'');
 if(!source.includes('\n')&&source.includes('\\n'))source=source.replace(/\\n/g,'\n');
 const inline=(node,s)=>{const pattern=/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\x60[^\x60]+\x60)/g;for(const part of s.split(pattern)){const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);if(link&&!allowLinks){node.append(document.createTextNode(link[1]))}else if(link){const a=el('a',link[1]);a.href=link[2];a.target='_blank';a.rel='noopener noreferrer';node.append(a)}else if(/^\*\*.*\*\*$|^__.*__$/.test(part))node.append(el('strong',part.slice(2,-2)));else if(/^\*.*\*$|^_.*_$/.test(part))node.append(el('em',part.slice(1,-1)));else if(part.startsWith('\x60')&&part.endsWith('\x60'))node.append(el('code',part.slice(1,-1)));else node.append(document.createTextNode(part))}};
 const lines=source.split(/\r?\n/);let list=null,paragraph=null;
 const cells=s=>s.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim());
 for(let i=0;i<lines.length;i++){const line=lines[i].trim();if(!line){list=null;paragraph=null;continue}
 if(/^\x60{3}/.test(line))continue;
 if(line.includes('|')&&i+1<lines.length&&cells(lines[i+1]).every(x=>/^:?-{3,}:?$/.test(x))){const wrap=el('div');wrap.className='nw-table-wrap';const table=el('table'),head=el('thead'),body=el('tbody');const row=(parent,values,tag)=>{const tr=el('tr');for(const v of values){const td=el(tag);inline(td,v);tr.append(td)}parent.append(tr)};row(head,cells(line),'th');i++;while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim()){row(body,cells(lines[++i]),'td')}table.append(head,body);wrap.append(table);root.append(wrap);list=null;paragraph=null;continue}
 if(/^[-*_]{3,}$/.test(line)){root.append(el('hr'));list=null;paragraph=null;continue}
 const heading=line.match(/^#{1,6}\s*(.+)$/)||line.match(/^\*\*([^*]+)\*\*:?\s*$/);
 if(heading){const h=el('h4');inline(h,heading[1]);root.append(h);list=null;paragraph=null;continue}
 const item=line.match(/^([-*+•]|\d+[.)])\s+(.+)$/);
 if(item){const tag=/^\d/.test(item[1])?'ol':'ul';if(!list||list.tagName.toLowerCase()!==tag){list=el(tag);root.append(list)}const li=el('li');inline(li,item[2]);list.append(li);paragraph=null;continue}
 if(line.startsWith('>')){const q=el('blockquote');inline(q,line.replace(/^>\s*/,''));root.append(q);list=null;paragraph=null;continue}
 list=null;if(!paragraph){paragraph=el('p');root.append(paragraph)}else paragraph.append(document.createTextNode(' '));inline(paragraph,line);
 }return root;
}
function readStructured(value){
 try{
  const report=JSON.parse(value);
  return report?.version===1&&report.summary?.text?report:null;
 }catch{return null}
}
const labelKey=value=>String(value??'').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
function structuredAssessment(report,run){
 const root=el('div');root.className='nw-assessment';
 function statement(item,node){
  node.append(document.createTextNode(item.text));
  for(const number of item.sources||[]){
   if(!run.evidence?.[number-1])continue;
   const a=el('a',' ['+number+']');a.href='#source-'+run.id+'-'+number;
   a.setAttribute('aria-label','Source '+number);node.append(a);
  }
 }
 const summary=el('p');statement(report.summary,summary);
 root.append(el('h4','Executive summary'),summary);
 const sections=[
  ['Key developments',report.developments],['Business implications',report.implications],
  ['Risk assessment',report.risks],['Opportunities',report.opportunities],
  ['Recommended actions',report.recommendations],
 ];
 for(const [heading,items] of sections){
  if(!items?.length)continue;
  const list=el('ul');
  for(const item of items){
   const row=el('li');
   if(item.kind)row.append(el('strong',labelKey(item.kind)+' · '));
   if(item.category)row.append(el('strong',labelKey(item.category)+' · '+labelKey(item.severity)+' · '+labelKey(item.direction)+' · '+labelKey(item.confidence)+' confidence. '));
   statement(item,row);
   if(item.rationale)row.append(el('p',[item.rationale,'Urgency: '+item.urgency,'Expected impact: '+item.impact,'Suggested role: '+item.role].join(' · ')));
   list.append(row);
  }
  root.append(el('h4',heading),list);
 }
 root.append(el('h4','Confidence and limitations'),el('p',labelKey(report.confidence)+' confidence'));
 if(report.limitations?.length){
  const list=el('ul');for(const value of report.limitations)list.append(el('li',value));root.append(list);
 }
 const previous=runs.find(candidate=>candidate.watch_id===run.watch_id&&candidate.created_at<run.created_at&&readStructured(candidate.assessment));
 if(previous){
  const previousReport=readStructured(previous.assessment);
  const earlier=new Map(previousReport.risks.map(risk=>[risk.category,risk]));
  const comparison=el('ul');
  for(const risk of report.risks){
   const prior=earlier.get(risk.category);
   if(!prior)comparison.append(el('li',labelKey(risk.category)+' appeared in this assessment.'));
   else if(prior.severity!==risk.severity||prior.confidence!==risk.confidence)comparison.append(el('li',labelKey(risk.category)+' · Severity '+labelKey(prior.severity)+' → '+labelKey(risk.severity)+' · Confidence '+labelKey(prior.confidence)+' → '+labelKey(risk.confidence)));
  }
  for(const prior of previousReport.risks){
   if(!report.risks.some(risk=>risk.category===prior.category))comparison.append(el('li',labelKey(prior.category)+' was not reassessed in this report.'));
  }
  if(comparison.children.length)root.append(el('h4','Compared with '+new Date(previous.created_at).toLocaleDateString()),comparison);
 }
 return root;
}
function assessmentText(report){
 const lines=[report.summary.text];
 for(const [title,items] of [['Key developments',report.developments],['Business implications',report.implications],['Risk assessment',report.risks],['Opportunities',report.opportunities],['Recommended actions',report.recommendations]]){
  if(!items.length)continue;
  lines.push('',title,...items.map(item=>'- '+(item.category?labelKey(item.category)+' · '+labelKey(item.severity)+' · '+labelKey(item.confidence)+' confidence. ':'')+item.text+' '+item.sources.map(number=>'['+number+']').join(' ')));
 }
 lines.push('','Confidence and limitations',labelKey(report.confidence),...report.limitations);
 return lines.join('\n');
}
function assessmentLink(id){
 const url=new URL('/news-watch/',location.origin);
 url.searchParams.set('section','assessments');
 url.searchParams.set('assessment',id);
 if(org)url.searchParams.set('org',org);
 return url.href;
}
function integrationOptions(kind,source){
 const panel=card();
 const crm=kind==='crm';
 panel.append(el('h3',crm?'Link to a relationship':'Link to an initiative'));
 const prompt=el('p','Loading available records…');panel.append(prompt);
 view.prepend(panel);
 void (async()=>{
  try{
   let records;
   if(crm){
    const response=await sb.from('crm_accounts').select('id,name').eq('org_id',org).order('name').limit(200);
    if(response.error)throw response.error;
    records=response.data;
   }else{
    const portfolios=await sb.from('pm_portfolios').select('id').eq('tenant_id',org).limit(50);
    if(portfolios.error)throw portfolios.error;
    if(!portfolios.data.length)records=[];
    else{
     const response=await sb.from('pm_initiatives').select('id,title').in('portfolio_id',portfolios.data.map(row=>row.id)).order('title').limit(200);
     if(response.error)throw response.error;
     records=response.data;
    }
   }
   prompt.remove();
   if(!records.length){panel.append(el('p','No accessible records to link.'),button('Close',()=>panel.remove()));return}
   const select=selectOptions(records.map(row=>[row.id,row.name||row.title]));
   const existing=await sb.from('sentinel_links').select('id,account_id,initiative_id,created_by')
    .eq('org_id',org).eq(crm?'watch_id':'run_id',source.id).not(crm?'account_id':'initiative_id','is',null);
   if(existing.error)throw existing.error;
   const labels=new Map(records.map(row=>[row.id,row.name||row.title]));
   for(const link of existing.data){
    const name=labels.get(link.account_id||link.initiative_id);
    if(!name)continue;
    const row=el('p','Linked to '+name);
    if(link.created_by===user)row.append(' ',button('Remove link',async()=>{
     const response=await sb.from('sentinel_links').delete().eq('id',link.id);
     if(response.error)throw response.error;row.remove();
    }));
    panel.append(row);
   }
   panel.append(control(crm?'Relationship':'Initiative',select),actions(button('Close',()=>panel.remove()),button('Link',async()=>{
    const linked=await sb.from('sentinel_links').insert(crm
     ?{org_id:org,watch_id:source.id,account_id:select.value}
     :{org_id:org,watch_id:source.watch_id,run_id:source.id,initiative_id:select.value});
    if(linked.error)throw linked.error;
    panel.remove();status('Link added');
   })));
  }catch{prompt.textContent='Records could not load.';panel.append(button('Close',()=>panel.remove()))}
 })();
}
function boardDraft(run){
 const url=new URL('/work-board/',location.origin);
 url.searchParams.set('sentinel',run.id);
 return url.href;
}
async function knowledgeDraft(run,watch,text){
 if(!watch?.shared)return status('Share this watch with the organization before publishing an assessment.');
 const panel=card();
 panel.append(el('h3','Create a Knowledge Base draft'),el('p','Review the assessment and publish it from Content Studio when it is ready.'));
 const safeText=text.replace(/\u0000/g,'');
 const sources=(run.evidence||[]).slice(0,20).map((item,i)=>'['+(i+1)+'] '+item.url);
 panel.append(actions(button('Cancel',()=>panel.remove()),button('Create draft',async()=>{
  const result=await sb.from('knowledge_articles').insert({
   title:'Intelligence assessment for '+watch.name,category:'External intelligence',summary:(readStructured(run.assessment)?.summary.text||watch.name).slice(0,500),
   body:safeText+'\n\n## Sources\n'+sources.join('\n')+'\n\n'+assessmentLink(run.id),
   status:'draft',tenant_id:org,content_scope:'tenant',created_by:user
  });
  if(result.error)throw result.error;panel.remove();status('Draft created in Content Studio.');
 })));
 view.prepend(panel);
}
function scanOutcome(run){
 const error=String(run.error||'');
 const messages=[];
 const names={'gdelt':'GDELT','google-news-rss':'Google News','configured-feed':'Preferred feed','sec-edgar':'SEC EDGAR'};
 for(const [key,label] of Object.entries(names)){
  if(error.includes(key+' HTTP 429'))messages.push(label+' is rate limited.');
  else if(error.includes(key+' returned an unreadable'))messages.push(label+' returned an unreadable response.');
  else if(error.includes(key+' temporarily unavailable'))messages.push(label+' was temporarily unavailable.');
 }
 if(error.includes('Assessment unavailable:'))messages.push(error.includes('used its token limit')
  ?'The selected AI model ran out of output tokens before finishing the assessment.'
  :'The AI assessment could not finish. You can run another scan.');
 if(messages.length&&run.evidence?.length)messages.push('Collected sources are available below.');
 return messages.length?messages.join(' '):error;
}
function assessment(r){const w=watches.find(x=>x.id===r.watch_id),c=card();c.append(el('h3',w?.name||'Watch'),el('p',(r.status==='queued'&&r.next_attempt_at?'Retry scheduled'
 :r.status==='running'&&r.stage==='investigating'?'Investigating':r.status==='running'&&r.stage==='assessment'?'Generating assessment':scanStatuses[r.status]||r.status)+' · '+new Date(r.created_at).toLocaleString()));if(r.status==='queued'&&r.next_attempt_at)c.append(el('p','Next attempt '+new Date(r.next_attempt_at).toLocaleString()));const active=['queued','running'].includes(r.status);
 if(r.trigger_type)c.append(el('p',r.trigger_type==='scheduled'?'Scheduled scan':'Manual scan'));
 if(r.status==='queued'&&!r.next_attempt_at)c.append(el('p','Waiting for the next available scan slot.'));
 if(!active&&r.error)c.append(el('p',scanOutcome(r)));
 if(!active&&!r.assessment&&r.evidence?.length&&!r.error)c.append(el('p','This scan saved sources without an AI assessment.'));if(r.assessment){const report=readStructured(r.assessment),text=report?assessmentText(report):r.assessment;const badge=el('span','✦ AI-assisted');badge.className='nw-ai-badge';
 const interval={ '6h':.25,daily:1,weekly:7,monthly:30,manual:7 }[w?.frequency]||7;
 const stale=Date.now()-Date.parse(r.finished_at||r.created_at)>interval*86400000;
 if(stale){
  badge.classList.add('nw-ai-stale');
  badge.textContent='✦ AI-assisted · Stale';
 }c.append(el('h4','Intelligence assessment'),badge,report?structuredAssessment(report,r):formattedAssessment(r.assessment),el('p','AI interpretation of collected headlines and source metadata only.'));const links=(r.evidence||[]).filter(x=>/^https?:\/\//i.test(x.url||'')).map(x=>x.url);const body=(report?report.summary.text:text.slice(0,1200))+'\n\n'+links.slice(0,5).join('\n')+'\n'+assessmentLink(r.id);c.append(actions(button('Email assessment',()=>{location.href='mailto:'+encodeURIComponent(w?.recipients||'')+'?cc='+encodeURIComponent(w?.recipients_cc||'')+'&subject='+encodeURIComponent('News Watch | '+(w?.name||'Assessment'))+'&body='+encodeURIComponent(body)}),button('Copy assessment',()=>navigator.clipboard.writeText(text+'\n'+links.join('\n')+'\n'+assessmentLink(r.id)))));
 const integrations=actions();
 if(integrationAccess.portfolio_management)integrations.append(button('Link to initiative',()=>integrationOptions('portfolio',r)));
 if(integrationAccess.work_board){const link=el('a','Draft a Work Board task');link.href=boardDraft(r);link.className='ap-btn';integrations.append(link)}
 if(integrationAccess.content_studio&&w?.shared)integrations.append(button('Draft knowledge article',()=>knowledgeDraft(r,w,text)));
 if(integrations.children.length)c.append(integrations);
 if(riskReviewAvailable)c.append(aiReportButton('Review risk with AI','sentinel_risk_classification',[r.id]))}if(Array.isArray(r.evidence)&&r.evidence.length){const list=el('ul');for(const [index,item] of r.evidence.entries()){try{const url=new URL(item.url);if(!['https:','http:'].includes(url.protocol))continue;const li=el('li'),a=el('a',item.title||url.hostname);li.id='source-'+r.id+'-'+(index+1);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';li.append(a);const provenance=[item.source,item.source_role==='primary'?'Primary evidence':null,item.published&&new Date(item.published).toLocaleDateString(),typeof item.new_development==='boolean'?(item.new_development?'Newly collected':'Previously collected'):null].filter(Boolean);if(provenance.length)li.append(el('p',provenance.join(' · ')));if(item.description)li.append(el('p',item.description));list.append(li)}catch{}}c.append(el('h4','Source evidence'),list)}return c}
function aiReportButton(label,component,runIds){
 const panel=el('div'),output=el('div');
 output.setAttribute('aria-live','polite');
 const launch=button(label,async()=>{
  output.replaceChildren(el('p','Generating…'));
  try{
   const response=await sb.functions.invoke('ai-platform-gateway',{body:{tenant_id:org,component,run_ids:runIds}});
   if(response.error||!response.data?.content)throw Error('No response');
   const badge=el('span','✦ AI-assisted');badge.className='nw-ai-badge';
   const list=el('ol');
   for(const id of response.data.assessment_ids||[]){
    const item=el('li'),link=el('a','Assessment '+(list.children.length+1));
    link.href=assessmentLink(id);item.append(link);list.append(item);
   }
   output.replaceChildren(badge,formattedAssessment(response.data.content,false),list);
  }catch{output.replaceChildren(el('p','The AI response could not finish. Try again.'))}
 });
 launch.classList.add('nw-ai-action');
 panel.append(launch,output);
 return panel;
}
function dashboard(){
 const root=el('section'),filterBar=actions(),reportArea=el('div');
 root.append(filterBar,reportArea);
 const categoryNames=[...new Set(watches.map(watch=>watch.category))].sort();
 const filters=[
  ['category','Category',[['','All categories'],...categoryNames.map(name=>[name,name])]],
  ['relationship_type','Relationship',[['','All relationships'],...[...new Set(watches.map(watch=>watch.relationship_type).filter(Boolean))].sort().map(key=>[key,labelKey(key)])]],
  ['severity','Severity',[['','All severity levels'],...['critical','high','moderate','low','informational','unknown'].map(key=>[key,labelKey(key)])]],
  ['direction','Direction',[['','All directions'],...['deteriorating','stable','improving','unknown'].map(key=>[key,labelKey(key)])]],
  ['period','Period',[['7','7 days'],['30','30 days'],['90','90 days']]],
  ['owner','Ownership',[['','All accessible watches'],['mine','My watches']]],
 ];
 for(const [key,name,options] of filters){
  const label=el('label',name),select=el('select');select.className='ap-input';
  for(const [value,text] of options){const option=el('option',text);option.value=value;select.append(option)}
  select.value=dashboardFilters[key];select.onchange=()=>{dashboardFilters[key]=select.value;update()};
  label.append(select);filterBar.append(label);
 }
 function update(){
  const f=dashboardFilters, cutoff=Date.now()-Number(f.period)*86400000;
  const active=watches.filter(w=>w.active&&(!f.category||f.category===w.category)&&(!f.relationship_type||f.relationship_type===w.relationship_type)&&(!f.owner||w.owner_id===user));
  const selectedRuns=runs.filter(r=>active.some(w=>w.id===r.watch_id)&&Date.parse(r.created_at)>=cutoff);
  const latest=new Map();
  for(const run of selectedRuns){
   const report=readStructured(run.assessment);
   if(report&&!latest.has(run.watch_id))latest.set(run.watch_id,{run,report});
  }
  const visible=[...latest.values()].filter(({report})=>(!f.severity&&!f.direction)||report.risks.some(risk=>(!f.severity||risk.severity===f.severity)&&(!f.direction||risk.direction===f.direction)));
  const covered=active.filter(w=>selectedRuns.some(r=>r.watch_id===w.id&&['complete','partial'].includes(r.status)));
  const critical=visible.filter(({report})=>report.risks.some(r=>['critical','high'].includes(r.severity)));
  const deteriorating=visible.filter(({report})=>report.risks.some(r=>r.direction==='deteriorating'));
  const fresh=visible.filter(({run})=>Date.now()-Date.parse(run.created_at)<7*86400000);
  const metrics=card();
  metrics.append(el('h3','Monitoring coverage'),el('p',active.length+' active watches · '+covered.length+' with a complete or partial scan · '+fresh.length+' with a structured report in the last 7 days'),el('p',critical.length+' critical or high-risk watches · '+deteriorating.length+' with deteriorating risk'));
  const counts=card(),running=selectedRuns.filter(r=>['queued','running'].includes(r.status)).length;
  counts.append(el('h3','Collection health'),el('p',['complete','partial','failed'].map(status=>selectedRuns.filter(r=>r.status===status).length+' '+status).concat(running+' pending').join(' · ')));
  const categories=card();categories.append(el('h3','Risk by category'));
  const riskCounts=new Map(),max=Math.max(1,visible.length);
  for(const {report} of visible)for(const category of new Set(report.risks.filter(r=>(!f.severity||f.severity===r.severity)&&(!f.direction||f.direction===r.direction)).map(r=>r.category)))riskCounts.set(category,(riskCounts.get(category)||0)+1);
  for(const [key,count] of [...riskCounts].sort((a,b)=>b[1]-a[1])){
   const label=el('label',labelKey(key)+' · '+count),bar=el('progress');bar.value=count;bar.max=max;
   label.append(bar);categories.append(label);
  }
  if(!riskCounts.size)categories.append(el('p','No structured risks match these filters.'));
  const trends=card();trends.append(el('h3','Historical critical and high risk'));
  const trendCounts=new Map();
  for(const run of selectedRuns){
   const report=readStructured(run.assessment);
   if(!report||!report.risks.some(r=>['critical','high'].includes(r.severity)&&(!f.severity||r.severity===f.severity)&&(!f.direction||r.direction===f.direction)))continue;
   const day=new Date(run.created_at).toLocaleDateString();
   if(!trendCounts.has(day))trendCounts.set(day,new Set());
   trendCounts.get(day).add(run.watch_id);
  }
  const trendList=el('ul');for(const [day,ids] of [...trendCounts].slice(0,14))trendList.append(el('li',day+' · '+ids.size+' watches'));
  trends.append(trendList.children.length?trendList:el('p','No high-risk reports in the available scan history.'));
  const recent=card();recent.append(el('h3','Recent developments and actions'));
  const list=el('ul');
  for(const {run,report} of visible.slice(0,8)){
   const watch=active.find(w=>w.id===run.watch_id);const li=el('li'),link=el('a',watch?.name||'Assessment');
   link.href=assessmentLink(run.id);li.append(link,el('p',report.developments[0]?.text||report.summary.text));
   if(report.recommendations[0])li.append(el('p','Recommended action: '+report.recommendations[0].text));
   list.append(li);
  }
  recent.append(list.children.length?list:el('p','No matching assessments.'));
  reportArea.replaceChildren(metrics,counts,categories,trends,recent);
  if(briefingAvailable&&visible.length){
   const briefing=card();briefing.append(el('h3','Executive briefing'),aiReportButton('Generate briefing','sentinel_briefing',visible.slice(0,8).map(({run})=>run.id)));
   reportArea.append(briefing);
  }
  if(runs.length>=200)reportArea.append(el('p','Metrics reflect the 200 most recent accessible scans.'));
 }
 update();
 return root;
}
async function showNotifications(){
 const panel=card();
 view.append(panel);
 panel.append(el('p','Loading notifications…'));
 try{
  const [notifications,preferences]=await Promise.all([
   sb.from('sentinel_notifications').select('*').eq('org_id',org).order('created_at',{ascending:false}).limit(100),
   sb.from('sentinel_notification_preferences').select('alerts,digest').eq('user_id',user).eq('org_id',org).maybeSingle(),
  ]);
  if(notifications.error||preferences.error)throw notifications.error||preferences.error;
  const settings=preferences.data||{alerts:true,digest:'off'};
  const alertLabel=el('label','Receive watch alerts'),alerts=el('input');alerts.type='checkbox';alerts.checked=settings.alerts;alertLabel.append(alerts);
  const digestLabel=el('label','Intelligence digest'),digest=el('select');
  for(const key of ['off','daily','weekly']){const option=el('option',labelKey(key));option.value=key;digest.append(option)}
  digest.value=settings.digest;digestLabel.append(digest);
  panel.replaceChildren(el('h3','Notification preferences'),alertLabel,digestLabel,button('Save preferences',async()=>{
   const {error}=await sb.from('sentinel_notification_preferences').upsert({user_id:user,org_id:org,alerts:alerts.checked,digest:digest.value});
   if(error)throw error;status('Notification preferences saved');
  }));
  if(!notifications.data.length)panel.append(el('p','No notifications yet. Set an alert threshold on a watch or turn on digests.'));
  for(const event of notifications.data){
   const item=card();item.append(el('h3',event.subject),el('p',new Date(event.created_at).toLocaleString()),el('p',event.detail));
   if(event.run_id){const link=el('a','Open assessment');link.href=assessmentLink(event.run_id);item.append(link)}
   if(event.acknowledged_at)item.append(el('p','Acknowledged'));
   else item.append(actions(button('Acknowledge',async()=>{
    const {error}=await sb.from('sentinel_notifications').update({acknowledged_at:new Date().toISOString()}).eq('id',event.id).eq('org_id',org);
    if(error)throw error;render();
   })));
   panel.append(item);
  }
 }catch{panel.replaceChildren(el('p','Notifications could not load.'),button('Refresh',render))}
}
async function showDevelopments(){
 const panel=card(),scope=org;
 panel.append(el('h3','Persistent developments'),el('p','Related headlines are grouped within each watch. Matching headlines do not establish independent corroboration.'));
 view.append(panel);
 const result=await sb.rpc('sentinel_developments',{p_org:scope,p_watch:new URLSearchParams(location.search).get('watch')||null});
 if(org!==scope||!panel.isConnected)return;
 if(result.error){panel.append(el('p','Developments unavailable: '+result.error.message));return}
 if(!result.data.length)panel.append(el('p','No indexed developments yet.'));
 const groups=new Map();
 for(const d of result.data){if(!groups.has(d.watch_id))groups.set(d.watch_id,[]);groups.get(d.watch_id).push(d)}
 for(const [watchId,developments] of [...groups].sort((a,b)=>(watches.find(w=>w.id===a[0])?.name||'').localeCompare(watches.find(w=>w.id===b[0])?.name||''))){
 const group=el('details');group.className='nw-card nw-development-group';
 const watch=watches.find(w=>w.id===watchId);
 const heading=el('summary');heading.className='nw-development-summary';
 const name=el('strong',watch?.name||'Watch');
 const latest=developments.reduce((date,d)=>Math.max(date,Date.parse(d.last_seen_at)||0),0);
 const count=developments.reduce((total,d)=>total+Number(d.evidence_count||0),0);
 const meta=el('span',[watch?.category,developments.length+' developments',count+' evidence items',latest?'Latest new evidence '+new Date(latest).toLocaleDateString():''].filter(Boolean).join(' · '));
 meta.className='nw-development-meta';
 heading.append(name,meta);group.append(heading);
 panel.append(group);
 for(const d of developments){
  const item=el('details');item.append(el('summary',d.title),el('p', (watches.find(w=>w.id===d.watch_id)?.name||'Watch')+' · '+d.evidence_count+' evidence items · First observed '+new Date(d.first_seen_at).toLocaleDateString()+' · Latest new evidence '+new Date(d.last_seen_at).toLocaleDateString()));
  const list=el('ul');
  for(const e of d.evidence||[]){const li=el('li');try{const u=new URL(e.url);if(!['http:','https:'].includes(u.protocol))throw Error();const a=el('a',e.title||u.hostname);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';li.append(a)}catch{li.append(el('span',e.title||'Evidence'))}li.append(el('span',' · '+(e.source||'Unknown source')));list.append(li)}
  item.append(list);group.append(item);
 }
 }
 if(result.data.length===100)panel.append(el('p','Showing the 100 most recently indexed developments.'));
}
function render(){nav.replaceChildren();for(const p of ['Overview','Watchlist','Intelligence','Assessments','Notifications','Scan history']){const b=button(p,()=>{page=p;const u=new URL(location.href);u.searchParams.set('section',p.toLowerCase().replace(/ /g,'-'));u.searchParams.delete('assessment');u.searchParams.delete('watch');history.replaceState(history.state,'',u);render()});b.className='';if(p===page)b.setAttribute('aria-current','page');nav.append(b)}view.replaceChildren();view.append(el('h2',page));if(page==='Overview'){view.append(dashboard());return}if(page==='Notifications'){void showNotifications();return}if(page==='Intelligence'){void showDevelopments().catch(e=>status(e.message));}if(page!=='Watchlist'){view.append(actions(button('Refresh',load)));const params=new URLSearchParams(location.search),assessmentId=page==='Assessments'?params.get('assessment'):null,watchId=params.get('watch');
 const selected=runs.filter(r=>(!watchId||r.watch_id===watchId)&&(assessmentId?r.id===assessmentId:page==='Scan history'||(page==='Intelligence'?r.evidence?.length:r.assessment||r.evidence?.length||['queued','running'].includes(r.status))));if(!selected.length)view.append(el('p',assessmentId?'This assessment could not be found or is unavailable.':'No assessments yet. Run a scan from Watchlist.'));for(const r of selected)view.append(assessment(r));return}view.append(actions(button('Add watch',()=>form()),button('Bulk import',importer),button('Edit selected',bulkEdit),button('Refresh',load)));for(const w of watches){const c=card();c.append(el('h3',w.name),el('p',[w.category,w.ticker,w.frequency,w.active?'Active':'Disabled'].filter(Boolean).join(' · ')));if(w.owner_id===user){
 const selection=el('input');selection.type='checkbox';selection.checked=selectedWatches.has(w.id);
 selection.onchange=()=>{if(selection.checked)selectedWatches.add(w.id);else selectedWatches.delete(w.id)};
 c.append(control('Select '+w.name,selection));
 const pending=runs.find(r=>r.watch_id===w.id&&['queued','running'].includes(r.status));const scan=button(pending?(pending.status==='running'?'Scanning…':pending.next_attempt_at?'Retry scheduled':'Scan queued'):'Scan now',async()=>{const r=await sb.rpc('sentinel_queue',{p_watch:w.id});if(r.error)throw r.error;await load();status(r.data?'Scan queued':'Scan already pending')});scan.disabled=!!pending||!w.active;const controls=actions(button('Edit',()=>form(w)),scan);
 if(integrationAccess.crm)controls.append(button('Link relationship',()=>integrationOptions('crm',w)));
 if(deepAvailable){
  const deep=button('Deep investigation',async()=>{
   const result=await sb.rpc('sentinel_queue_deep',{p_watch:w.id});
   if(result.error)throw result.error;
   await load();status(result.data?'Deep investigation queued':'Scan already pending');
  });
  deep.classList.add('nw-ai-action');
  deep.disabled=!!pending||!w.active;controls.append(deep);
 }
 c.append(controls)}view.append(c)}}
let refreshTimer;
async function refreshPendingScans(){
 if(document.hidden||page==='Notifications'||view.querySelector('form,input[type="file"],[aria-busy="true"]'))return;
 if(!runs.some(r=>['queued','running'].includes(r.status)))return;
 await load();
}
App.onSession(async(s,p)=>{
 clearInterval(refreshTimer);
 if(!s||!p)return;
 if(org!==App.activeTenantId||user!==s.user.id)selectedWatches.clear();
 org=App.activeTenantId;
 user=s.user.id;
 if(!org)return status('Choose an organization');
 const deep=await sb.rpc('sentinel_deep_available',{p_org:org});
 deepAvailable=!deep.error&&deep.data===true;
 const integrations=await Promise.all(['crm','portfolio_management','work_board','content_studio'].map(async key=>{
  const result=await sb.rpc('sentinel_integration_allowed',{p_org:org,p_feature:key});
  return [key,!result.error&&result.data===true];
 }));
 integrationAccess=Object.fromEntries(integrations);
 const [briefing,riskReview]=await Promise.all(['sentinel_briefing','sentinel_risk_classification'].map(component=>
  sb.rpc('ai_platform_authorized',{p_tenant:org,p_component:component})
 ));
 briefingAvailable=!briefing.error&&briefing.data===true;
 riskReviewAvailable=!riskReview.error&&riskReview.data===true;
 try{await load()}catch(e){status(e.message);return}
 refreshTimer=setInterval(()=>refreshPendingScans().catch(()=>status('Scan status could not refresh. Try Refresh.')),15000);
});
})();