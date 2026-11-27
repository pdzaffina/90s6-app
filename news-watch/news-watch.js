(()=>{'use strict';
const sb=App.sb,$=id=>document.getElementById(id),view=$('nwView'),nav=$('crmNav');
const pages=['Overview','Watchlist','Intelligence','Assessments','Scan history'];
const scanStatuses={queued:'Queued',running:'Collecting intelligence',complete:'Complete',partial:'Partial',failed:'Failed'};
const pageFromUrl=()=>pages.find(p=>p.toLowerCase().replace(/ /g,'-')===new URLSearchParams(location.search).get('section'))||'Overview';
let org,user,watches=[],runs=[],page=pageFromUrl();
window.addEventListener('popstate',()=>{page=pageFromUrl();render()});
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
const status=t=>$('nwStatus').textContent=t;
const actions=(...nodes)=>{const a=el('div');a.className='nw-actions';a.append(...nodes);return a};
const button=(label,fn)=>{const b=el('button',label);b.className='ap-btn'+(/^(Add watch|Scan now|Import \d+ watches)$/.test(label)?' primary':'');b.type='button';b.onclick=async()=>{b.disabled=true;b.setAttribute('aria-busy','true');try{await fn()}catch(e){status(e.message||String(e))}finally{b.disabled=false;b.removeAttribute('aria-busy')}};return b};
const fields=[['name','Name'],['kind','Watch type',['company','event','topic']],['category','Category'],['relationship_type','Relationship type',['general_topic','supplier','customer','competitor','strategic_partner','technology_provider','industry','event']],['ticker','Stock ticker'],['sec_cik','SEC CIK'],['exchange','Exchange'],['website','Website'],['vendor_id','Vendor ID'],['criticality','Criticality'],['objective','Monitoring objective'],['alternative_names','Alternative names (comma-separated)'],['custom_terms','Required terms (comma-separated)'],['excluded_terms','Excluded terms (comma-separated)'],['lookback_days','Lookback in days'],['feed_url','Preferred RSS or Atom feed URL'],['frequency','Frequency',['daily','6h','weekly','monthly','manual']],['recipients','Email recipients'],['active','Active',true],['shared','Share with organization',true]];
async function load(){const a=await sb.from('sentinel_watches').select('*').eq('org_id',org).order('name');if(a.error)throw a.error;watches=a.data;const b=await sb.from('sentinel_scan_runs').select('*').eq('org_id',org).order('created_at',{ascending:false}).limit(200);if(b.error)throw b.error;runs=b.data;
 const selectedId=new URLSearchParams(location.search).get('assessment');
 if(selectedId&&/^[0-9a-f-]{36}$/i.test(selectedId)&&!runs.some(run=>run.id===selectedId)){
  const result=await sb.from('sentinel_scan_runs').select('*').eq('org_id',org).eq('id',selectedId).maybeSingle();
  if(result.error)throw result.error;
  if(result.data)runs.push(result.data);
 }
 render()}
function card(){const c=el('article');c.className='nw-card';return c}
function form(w={}){const c=card(),f=el('form');c.append(el('h2',w.id?'Edit watch':'New watch'),f);for(const [k,label,opts] of fields){const l=el('label',label);let i=el(Array.isArray(opts)?'select':k==='objective'?'textarea':'input');i.name=k;if(k==='lookback_days'){i.type='number';i.min=1;i.max=90;i.required=true}if(k==='feed_url')i.type='url';if(k==='sec_cik'){i.pattern='[0-9]{1,10}';i.inputMode='numeric'};if(Array.isArray(opts)){for(const v of opts){const o=el('option',k==='relationship_type'?v.replaceAll('_',' ').replace(/^./,x=>x.toUpperCase()):v);o.value=v;i.append(o)}}else if(opts===true){i.type='checkbox';i.checked=w[k]??k==='active'}if(opts!==true)i.value=w[k]??({category:'Suppliers',criticality:'Unclassified',kind:'company',relationship_type:'general_topic',frequency:'daily',lookback_days:7}[k]||'');i.required=k==='name'||k==='lookback_days';l.append(i);f.append(l)}const save=el('button','Save watch');save.type='submit';save.className='ap-btn primary';f.append(actions(button('Cancel',render),save));f.onsubmit=async e=>{e.preventDefault();save.disabled=true;save.setAttribute('aria-busy','true');save.textContent='Saving…';try{const data=Object.fromEntries(fields.map(([k,,o])=>[k,o===true?f.elements[k].checked:k==='lookback_days'?Number(f.elements[k].value):f.elements[k].value.trim()]));const q=w.id?sb.from('sentinel_watches').update(data).eq('id',w.id).eq('org_id',org):sb.from('sentinel_watches').insert({...data,org_id:org});const r=await q.select('id').single();if(r.error)throw r.error;await load();status('Watch saved')}catch(e){status(e.message)}finally{save.disabled=false;save.removeAttribute('aria-busy');save.textContent='Save watch'}};view.prepend(c)}
function csv(text){const rows=[];let row=[],v='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++}else quoted=!quoted}else if(!quoted&&(c===','||c==='\n'||c==='\r')){row.push(v);v='';if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[]}}else v+=c}if(quoted)throw Error('Unclosed CSV quote');if(v||row.length){row.push(v);rows.push(row)}return rows}
function importer(){const c=card(),file=el('input');file.type='file';file.accept='.csv';c.append(el('h2','Import vendors (CSV)'),el('p','Export Excel as CSV. Required column: Company Name. Optional: Category, Stock Ticker, Website, Vendor ID, Monitoring Objective.'),file);file.onchange=async()=>{try{const f=file.files[0];if(!f)return;if(f.size>2000000)throw Error('File exceeds 2 MB');const [header,...rows]=csv((await f.text()).replace(/^\uFEFF/,''));const keys=header.map(x=>x.trim().toLowerCase());const index=keys.findIndex(x=>['company name','name','vendor name','supplier name'].includes(x));if(index<0)throw Error('Missing company name column');if(rows.length>1000)throw Error('Maximum 1000 rows');const seen=new Set(watches.filter(w=>w.owner_id===user&&w.kind==='company').map(w=>w.name.toLowerCase().trim()));const payload=[];let skipped=0;for(const row of rows){const name=(row[index]||'').trim();if(!name||name.length>300||seen.has(name.toLowerCase())){skipped++;continue}seen.add(name.toLowerCase());const get=k=>(row[keys.indexOf(k)]||'').trim();payload.push({org_id:org,name,category:get('category')||'Suppliers',ticker:get('stock ticker'),website:get('website'),vendor_id:get('vendor id'),objective:get('monitoring objective')})}const p=el('p',payload.length+' ready; '+skipped+' skipped.');c.append(p,button('Import '+payload.length+' watches',async()=>{if(!payload.length)return;const r=await sb.from('sentinel_watches').insert(payload);if(r.error)throw r.error;await load();status(payload.length+' watches imported')}))}catch(e){status(e.message)}};view.prepend(c)}
function formattedAssessment(value){
 const root=el('div');root.className='nw-assessment';
 let source=String(value??'').trim();
 if(source.startsWith('"')){try{const parsed=JSON.parse(source);if(typeof parsed==='string')source=parsed}catch{}}
 source=source.replace(/^\s*\x60{3}(?:markdown|md)?\s*\n/i,'').replace(/\n\s*\x60{3}\s*$/,'');
 if(!source.includes('\n')&&source.includes('\\n'))source=source.replace(/\\n/g,'\n');
 const inline=(node,s)=>{const pattern=/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\x60[^\x60]+\x60)/g;for(const part of s.split(pattern)){const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);if(link){const a=el('a',link[1]);a.href=link[2];a.target='_blank';a.rel='noopener noreferrer';node.append(a)}else if(/^\*\*.*\*\*$|^__.*__$/.test(part))node.append(el('strong',part.slice(2,-2)));else if(/^\*.*\*$|^_.*_$/.test(part))node.append(el('em',part.slice(1,-1)));else if(part.startsWith('\x60')&&part.endsWith('\x60'))node.append(el('code',part.slice(1,-1)));else node.append(document.createTextNode(part))}};
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
 return url.href;
}
function assessment(r){const w=watches.find(x=>x.id===r.watch_id),c=card();c.append(el('h3',w?.name||'Watch'),el('p',(r.status==='queued'&&r.next_attempt_at?'Retry scheduled'
 :r.status==='running'&&r.evidence?.length?'Generating assessment':scanStatuses[r.status]||r.status)+' · '+new Date(r.created_at).toLocaleString()));if(r.status==='queued'&&r.next_attempt_at)c.append(el('p','Next attempt '+new Date(r.next_attempt_at).toLocaleString()));if(r.error)c.append(el('p',r.error));if(!r.assessment&&r.evidence?.length)c.append(el('p','No AI assessment available for this scan.'));if(r.assessment){const report=readStructured(r.assessment),text=report?assessmentText(report):r.assessment;const badge=el('span','✦ AI-assisted');badge.style.cssText='display:inline-block;color:#a78bfa;border:1px solid #a78bfa;border-radius:999px;padding:2px 8px;font-size:12px';c.append(el('h4','Intelligence assessment'),badge,report?structuredAssessment(report,r):formattedAssessment(r.assessment),el('p','AI interpretation of collected headlines and source metadata only.'));const links=(r.evidence||[]).filter(x=>/^https?:\/\//i.test(x.url||'')).map(x=>x.url);const body=(report?report.summary.text:text.slice(0,1200))+'\n\n'+links.slice(0,5).join('\n')+'\n'+assessmentLink(r.id);c.append(actions(button('Email assessment',()=>{location.href='mailto:'+encodeURIComponent(w?.recipients||'')+'?subject='+encodeURIComponent('News Watch | '+(w?.name||'Assessment'))+'&body='+encodeURIComponent(body)}),button('Copy assessment',()=>navigator.clipboard.writeText(text+'\n'+links.join('\n')+'\n'+assessmentLink(r.id)))))}if(Array.isArray(r.evidence)&&r.evidence.length){const list=el('ul');for(const [index,item] of r.evidence.entries()){try{const url=new URL(item.url);if(!['https:','http:'].includes(url.protocol))continue;const li=el('li'),a=el('a',item.title||url.hostname);li.id='source-'+r.id+'-'+(index+1);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';li.append(a);const provenance=[item.source,item.published&&new Date(item.published).toLocaleDateString(),typeof item.new_development==='boolean'?(item.new_development?'Newly collected':'Previously collected'):null].filter(Boolean);if(provenance.length)li.append(el('p',provenance.join(' · ')));if(item.description)li.append(el('p',item.description));list.append(li)}catch{}}c.append(el('h4','Source evidence'),list)}return c}
function render(){nav.replaceChildren();for(const p of ['Overview','Watchlist','Intelligence','Assessments','Scan history']){const b=button(p,()=>{page=p;const u=new URL(location.href);u.searchParams.set('section',p.toLowerCase().replace(/ /g,'-'));u.searchParams.delete('assessment');history.replaceState(history.state,'',u);render()});b.className='';if(p===page)b.setAttribute('aria-current','page');nav.append(b)}view.replaceChildren();view.append(el('h2',page));if(page==='Overview'){view.append(el('p',watches.filter(w=>w.active).length+' active watches · '+runs.filter(r=>r.status==='queued').length+' queued scans'));for(const r of runs.slice(0,5))view.append(assessment(r));return}if(page!=='Watchlist'){view.append(actions(button('Refresh',load)));const assessmentId=page==='Assessments'?new URLSearchParams(location.search).get('assessment'):null;const selected=runs.filter(r=>assessmentId?r.id===assessmentId:page==='Scan history'||(page==='Intelligence'?r.evidence?.length:r.assessment||r.evidence?.length||['queued','running'].includes(r.status)));if(!selected.length)view.append(el('p',assessmentId?'This assessment could not be found or is unavailable.':'No assessments yet. Run a scan from Watchlist.'));for(const r of selected)view.append(assessment(r));return}view.append(actions(button('Add watch',()=>form()),button('Bulk import',importer),button('Refresh',load)));for(const w of watches){const c=card();c.append(el('h3',w.name),el('p',[w.category,w.ticker,w.frequency,w.active?'Active':'Disabled'].filter(Boolean).join(' · ')));if(w.owner_id===user){const pending=runs.find(r=>r.watch_id===w.id&&['queued','running'].includes(r.status));const scan=button(pending?(pending.status==='running'?'Scanning…':pending.next_attempt_at?'Retry scheduled':'Scan queued'):'Scan now',async()=>{const r=await sb.rpc('sentinel_queue',{p_watch:w.id});if(r.error)throw r.error;await load();status(r.data?'Scan queued':'Scan already pending')});scan.disabled=!!pending||!w.active;c.append(actions(button('Edit',()=>form(w)),scan))}view.append(c)}}
let refreshTimer;
async function refreshPendingScans(){
 if(document.hidden||view.querySelector('form,input[type="file"]'))return;
 if(!runs.some(r=>['queued','running'].includes(r.status)))return;
 await load();
}
App.onSession(async(s,p)=>{
 clearInterval(refreshTimer);
 if(!s||!p)return;
 org=App.activeTenantId;
 user=s.user.id;
 if(!org)return status('Choose an organization');
 try{await load()}catch(e){status(e.message);return}
 refreshTimer=setInterval(()=>refreshPendingScans().catch(()=>status('Scan status could not refresh. Try Refresh.')),15000);
});
})();