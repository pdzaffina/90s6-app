(()=>{'use strict';
const KEY='work-chunks-board-v1';let WHEN=[],KIND=[],layout=null;
const $=id=>document.getElementById(id);let cells=[];
const examples=[
{title:'Confirm project scope and delivery dates',description:'Get sponsor agreement on milestones and the next decision.',when:'Now',kind:'Have to do',effort:'Small'},
{title:'Define requirements for intake workflow',description:'Document the current state and acceptance criteria.',when:'Now',kind:'Have to do',effort:'Medium'},
{title:'Resolve integration error',description:'Identify root cause and prove a fix in test.',when:'Now',kind:'Have to do',effort:'Medium'},
{title:'Review dependencies with stakeholders',description:'Publish an updated dependency register.',when:'Next',kind:'Have to do',effort:'Small'},
{title:'Validate data mapping',description:'Sign off source-to-target field mapping.',when:'Next',kind:'Have to do',effort:'Medium'},
{title:'Prepare regression test plan',description:'List critical tests before release.',when:'Later',kind:'Have to do',effort:'Medium'},
{title:'Improve weekly status format',description:'Create a one-page decision-focused update.',when:'Now',kind:'Want to do',effort:'Small'},
{title:'Streamline discovery templates',description:'Create a reusable requirements checklist.',when:'Next',kind:'Want to do',effort:'Small'},
{title:'Automate repetitive validation',description:'Prototype checks and measure time saved.',when:'Later',kind:'Want to do',effort:'Large'}
];
let data=[];let dragId=null;let toastTimer;
const DEFAULT_LAYOUT={columns:[{name:'Now',hint:'Actively doing / urgent',id:'now'},{name:'Next',hint:'Ready to start soon',id:'next'},{name:'Later',hint:'Not yet committed',id:'later'}],lanes:[{name:'Have to do',hint:'Commitments, obligations & blockers.'},{name:'Want to do',hint:'Improvements, opportunities & ideas.'}]};
function cleanLayout(l){const f=(arr,def,columns=false)=>{const seen=new Set();const out=(Array.isArray(arr)?arr:[]).map(x=>({name:String(x&&x.name||'').trim().slice(0,30),hint:String(x&&x.hint||'').trim().slice(0,80),...(columns?{id:String(x?.id||crypto.randomUUID())}:{})})).filter(x=>x.name&&!seen.has(x.name.toLowerCase())&&seen.add(x.name.toLowerCase())).slice(0,8);return out.length?out:def.map(x=>({...x}))};return{columns:f(l&&l.columns,DEFAULT_LAYOUT.columns,true),lanes:f(l&&l.lanes,DEFAULT_LAYOUT.lanes)}}
function fillLayoutSelects(){for(const[id,list]of[['when',WHEN],['kind',KIND]]){const s=$(id);const v=s.value;s.replaceChildren(...list.map(n=>new Option(n,n)));if(list.includes(v))s.value=v}}
function buildGrid(){const g=$('board');g.replaceChildren();g.style.setProperty('--cols',layout.columns.length);const last=layout.columns.length-1;const corner=node('div','corner');corner.append(node('small','','Priority matrix'),node('strong','','What to do'));g.append(corner);
layout.columns.forEach((c,i)=>{const h=node('div','colhead'+(i===last?' lastcol':''));h.append(node('h2','',c.name));if(c.hint)h.append(node('p','',c.hint));g.append(h)});
cells=[];layout.lanes.forEach(ln=>{const rh=node('div','rowhead');rh.append(node('span','row-title',ln.name));if(ln.hint)rh.append(node('p','',ln.hint));g.append(rh);layout.columns.forEach((c,i)=>{const cell=node('div','cell'+(i===last?' lastcol':''));cell.dataset.when=c.name;cell.dataset.kind=ln.name;g.append(cell);cells.push(cell);wireCell(cell)})})}
function applyLayout(l){layout=cleanLayout(l);WHEN=layout.columns.map(c=>c.name);KIND=layout.lanes.map(c=>c.name);buildGrid();fillLayoutSelects()}

let view='board';const collapsed=new Set();
const boardFilters={owner:'',when:'',kind:'',effort:'',due:''};
function matchesBoardFilters(x){return (!boardFilters.owner||x.owner===boardFilters.owner)&&(!boardFilters.when||x.when===boardFilters.when)&&(!boardFilters.kind||x.kind===boardFilters.kind)&&(!boardFilters.effort||x.effort===boardFilters.effort)&&(!boardFilters.due||x.due===boardFilters.due)}
function renderBoardFilters(){const wrap=$('boardFilters');if(!wrap)return;wrap.replaceChildren();const choices=[['owner','Owner',[...new Set(data.map(x=>x.owner).filter(Boolean))].sort()],['when','Column',WHEN],['kind','Swimlane',KIND],['effort','Size',['Small','Medium','Large']]];for(const [key,label,values] of choices){const group=node('label','',label);const select=node('select');select.append(new Option('All '+label.toLowerCase()+'s',''));values.forEach(v=>select.append(new Option(v,v)));select.value=boardFilters[key];select.addEventListener('change',()=>{boardFilters[key]=select.value;render()});group.append(select);wrap.append(group)}const dueLabel=node('label','','Due date');const due=node('input');due.type='date';due.value=boardFilters.due;due.addEventListener('change',()=>{boardFilters.due=due.value;render()});dueLabel.append(due);wrap.append(dueLabel);const clear=node('button','','Clear filters');clear.type='button';clear.addEventListener('click',()=>{Object.keys(boardFilters).forEach(k=>boardFilters[k]='');render()});wrap.append(clear)}
function cleanAtts(a){return Array.isArray(a)?a.slice(0,20).filter(f=>f&&typeof f.path==='string'&&f.path.length<300).map(f=>({path:f.path,name:String(f.name||'file').slice(0,120),size:Number.isFinite(f.size)?f.size:0})):[]}
function kidsOf(){const ids=new Set(data.map(x=>x.id));const m=new Map();for(const x of data){const p=ids.has(x.parent)?x.parent:'';if(!m.has(p))m.set(p,[]);m.get(p).push(x)}for(const l of m.values())l.sort((a,b)=>a.order-b.order);return m}
function flatten(m,keep,open){const rows=[];const walk=(pid,depth,prefix)=>{(m.get(pid)||[]).forEach((x,i)=>{const num=prefix?prefix+'.'+(i+1):String(i+1);if(keep&&!keep.has(x.id))return;const n=(m.get(x.id)||[]).length;rows.push({x,depth,num,n});if(n&&(!open||open(x)))walk(x.id,depth+1,num)})};walk('',0,'');return rows}
function fixTree(){const byId=new Map(data.map(x=>[x.id,x]));for(const x of data){if(x.parent===x.id||!byId.has(x.parent))x.parent=''}for(const x of data){const seen=new Set([x.id]);let p=byId.get(x.parent);while(p){if(seen.has(p.id)){x.parent='';break}seen.add(p.id);p=byId.get(p.parent)}}}
function chips(x){const box=node('div','atts');for(const f of x.attachments||[]){const b=node('button','att','\u{1F4CE} '+f.name);b.type='button';b.title=f.name;b.addEventListener('click',ev=>{ev.stopPropagation();const H=window.WCHooks;H&&H.openAtt?H.openAtt(f):showToast('Sign in to open attachments')});box.append(b)}return box}
function fillParents(x,preset){const sel=$('parent');sel.replaceChildren(new Option('None (top level)',''));const banned=new Set();if(x){const add=id=>{banned.add(id);data.filter(a=>a.parent===id).forEach(a=>add(a.id))};add(x.id)}for(const r of flatten(kidsOf())){if(banned.has(r.x.id))continue;sel.append(new Option('\u00a0\u00a0'.repeat(r.depth)+r.num+' '+r.x.title.slice(0,60),r.x.id))}sel.value=(x?x.parent:preset)||'';if(sel.selectedIndex<0)sel.selectedIndex=0}
function setView(v){$('exportWbsBtn').hidden=v!=='wbs';view=v;document.body.classList.toggle('view-wbs',v==='wbs');$('viewBoard').classList.toggle('primary',v==='board');$('viewWbs').classList.toggle('primary',v==='wbs');render()}
function exportWbsExcel(){
 if(view!=='wbs')return;
 if(!window.XLSX){showToast('Excel export is unavailable. Reload and try again.');return}
 const query=$('searchInput').value.trim().toLowerCase();
 let keep=null;
 if(query){
  const byId=new Map(data.map(x=>[x.id,x]));
  keep=new Set();
  for(const x of data){
   if(![x.title,x.description,x.owner].join(' ').toLowerCase().includes(query))continue;
   let p=x;
   while(p&&!keep.has(p.id)){keep.add(p.id);p=byId.get(p.parent)}
  }
 }
 const rows=flatten(kidsOf(),keep);
 const records=rows.map(({x,num,depth})=>({
  'WBS':num,'Work Item':x.title,'Description':x.description,
  'Owner':x.owner,'Column':x.when,'Swimlane':x.kind,
  'Size':x.effort,'Due Date':x.due,'Parent WBS':num.includes('.')?num.slice(0,num.lastIndexOf('.')):'',
  'Level':depth+1,'Attachments':(x.attachments||[]).map(f=>f.name).join('; ')
 }));
 const headers=['WBS','Work Item','Description','Owner','Column','Swimlane','Size','Due Date','Parent WBS','Level','Attachments'];
 const ws=window.XLSX.utils.json_to_sheet(records,{header:headers});
 if(!records.length)window.XLSX.utils.sheet_add_aoa(ws,[headers],{origin:'A1'});
 ws['!cols']=[{wch:15},{wch:48},{wch:65},{wch:24},{wch:22},{wch:22},{wch:12},{wch:15},{wch:16},{wch:9},{wch:45}];
 ws['!autofilter']={ref:'A1:K'+(records.length+1)};
 const wb=window.XLSX.utils.book_new();
 window.XLSX.utils.book_append_sheet(wb,ws,'WBS');
 const boardName=(window.WCBoardName||'work-board').replace(/[^a-z0-9-_ ]/gi,'').trim().replace(/\\s+/g,'-').slice(0,50)||'work-board';
 window.XLSX.writeFile(wb,boardName+'-WBS-'+new Date().toISOString().slice(0,10)+'.xlsx');
}
$('exportWbsBtn').addEventListener('click',exportWbsExcel);
let wbsEditing=false;
const wbsFilters={owner:'',when:'',kind:'',effort:'',due:''};
function renderWbs(){const query=$('searchInput').value.trim().toLowerCase();const filtering=!!query||Object.values(wbsFilters).some(Boolean);const byId=new Map(data.map(x=>[x.id,x]));const hit=x=>(!query||[x.title,x.description,x.owner].join(' ').toLowerCase().includes(query))&&(!wbsFilters.owner||x.owner===wbsFilters.owner)&&(!wbsFilters.when||x.when===wbsFilters.when)&&(!wbsFilters.kind||x.kind===wbsFilters.kind)&&(!wbsFilters.effort||x.effort===wbsFilters.effort)&&(!wbsFilters.due||x.due===wbsFilters.due);let keep=null;if(filtering){keep=new Set();for(const x of data)if(hit(x)){let p=x;while(p&&!keep.has(p.id)){keep.add(p.id);p=byId.get(p.parent)}}}
const rows=flatten(kidsOf(),keep,x=>filtering||!collapsed.has(x.id));const wrap=$('wbs');wrap.replaceChildren();
const top=node('div','wbsTop');const left=node('div','wbsAct wbs-edit');const addTop=node('button','primary','+ Add top-level task');addTop.type='button';addTop.addEventListener('click',()=>openEditor());left.append(addTop);const toggle=node('button',wbsEditing?'primary':'',''+(wbsEditing?'Done editing':'Edit WBS'));toggle.type='button';toggle.addEventListener('click',()=>{wbsEditing=!wbsEditing;render()});left.append(toggle);
const right=node('div','wbsAct');const ex=node('button','','Expand all');ex.type='button';ex.addEventListener('click',()=>{collapsed.clear();render()});const co=node('button','','Collapse all');co.type='button';co.addEventListener('click',()=>{data.forEach(x=>{if(data.some(a=>a.parent===x.id))collapsed.add(x.id)});render()});right.append(ex,co);top.append(left,right);wrap.append(top);
const filterBar=node('div','wbsFilters');
const choices=[
 ['owner','Owner',[...new Set(data.map(x=>x.owner).filter(Boolean))].sort()],
 ['when','Column',WHEN],['kind','Swimlane',KIND],['effort','Size',['Small','Medium','Large']]
];
for(const [key,label,values] of choices){
 const group=node('label','',label);const select=node('select');
 select.append(new Option('All '+label.toLowerCase()+'s',''));
 values.forEach(v=>select.append(new Option(v,v)));
 select.value=wbsFilters[key];
 select.addEventListener('change',()=>{wbsFilters[key]=select.value;render()});
 group.append(select);filterBar.append(group);
}
const dueLabel=node('label','','Due date');const dueInput=node('input');dueInput.type='date';dueInput.value=wbsFilters.due;dueInput.addEventListener('change',()=>{wbsFilters.due=dueInput.value;render()});dueLabel.append(dueInput);filterBar.append(dueLabel);
const clear=node('button','','Clear filters');clear.type='button';clear.addEventListener('click',()=>{Object.keys(wbsFilters).forEach(k=>wbsFilters[k]='');render()});filterBar.append(clear);
wrap.append(filterBar);
const table=node('table');const head=node('tr');['WBS','Task','Owner','Column','Swimlane','Size','Due','Files',''].forEach(t=>head.append(node('th','',t)));const thead=node('thead');thead.append(head);const tbody=node('tbody');
for(const r of rows){const x=r.x;const tr=node('tr');tr.append(node('td','wbsNum',r.num));
const tt=node('td');const w=node('div','wbsTask');w.style.paddingLeft=(r.depth*22)+'px';
if(r.n){const tg=node('button','tg',(!filtering&&collapsed.has(x.id))?'\u25B8':'\u25BE');tg.type='button';tg.setAttribute('aria-label','Toggle subtasks of '+x.title);tg.addEventListener('click',()=>{collapsed.has(x.id)?collapsed.delete(x.id):collapsed.add(x.id);render()});w.append(tg)}else w.append(node('span','tg'));
if(wbsEditing&&!document.body.classList.contains('readonly')){const inp=node('input');inp.value=x.title;inp.maxLength=140;inp.setAttribute('aria-label','Work item name');inp.addEventListener('change',()=>{const v=inp.value.trim();if(!v){inp.value=x.title;showToast('Work item name is required');return}x.title=v;save();render()});w.append(inp)}else w.append(node('span','',x.title));if(r.n)w.append(node('span','crumb','('+r.n+')'));tt.append(w);tr.append(tt);

const editable=wbsEditing&&!document.body.classList.contains('readonly');
const fields=[
 ['owner',null,80],['when',WHEN],['kind',KIND],['effort',['Small','Medium','Large']],['due',null]
];
fields.forEach(([field,options,max])=>{
 const td=node('td');
 if(!editable){td.textContent=x[field]||''}
 else {
  let control;
  if(options){control=node('select');options.forEach(value=>{const opt=node('option','',value);opt.value=value;control.append(opt)});control.value=x[field]}
  else {control=node('input');control.type=field==='due'?'date':'text';control.value=x[field]||'';if(max)control.maxLength=max}
  control.setAttribute('aria-label',field+' for '+x.title);
  control.addEventListener('change',()=>{const value=control.value.trim();if(field==='when'||field==='kind'||field==='effort'){if(!options.includes(value))return}x[field]=value;save();});
  td.append(control);
 }
 tr.append(td);
});
const ft=node('td');ft.append(chips(x));tr.append(ft);
const at=node('td');const ab=node('div','wbsAct wbs-edit');const sub=node('button','','+ Sub');sub.type='button';sub.addEventListener('click',()=>openEditor(null,x.when,x.kind,x.id));const ed=node('button','','Edit');ed.type='button';ed.addEventListener('click',()=>openEditor(x.id));ab.append(sub,ed);at.append(ab);tr.append(at);tbody.append(tr)}
if(!rows.length){const tr=node('tr');const td=node('td','','No tasks match.');td.colSpan=9;tr.append(td);tbody.append(tr)}
table.append(thead,tbody);wrap.append(table);$('countStatus').textContent=rows.length+' rows shown \u00b7 '+data.length+' total'}
function uid(){return typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'chunk-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
function sanitize(item){if(!item||typeof item!=='object'||!item.title)return null;return{id:String(item.id||uid()),title:String(item.title).slice(0,140),description:String(item.description||'').slice(0,600),owner:String(item.owner||'').slice(0,80),owner_id:/^[0-9a-f-]{36}$/i.test(item.owner_id||'')?item.owner_id:null,poc:String(item.poc||item.owner||'').slice(0,80),when:WHEN.includes(item.when)?item.when:WHEN[0],column_id:layout.columns.find(c=>c.id===item.column_id)?.id||layout.columns.find(c=>c.name===item.when)?.id||layout.columns[0].id,kind:KIND.includes(item.kind)?item.kind:KIND[0],status:['To Do','In Progress','Done'].includes(item.status)?item.status:'To Do',effort:['Small','Medium','Large'].includes(item.effort)?item.effort:'Medium',due:/^\d{4}-\d{2}-\d{2}$/.test(item.due||'')?item.due:'',order:Number.isFinite(item.order)?item.order:Date.now(),parent:String(item.parent||"").slice(0,64),attachments:cleanAtts(item.attachments)}}
function samples(){return examples.map((item,i)=>sanitize({...item,id:uid(),order:i}))}
function load(){try{const raw=localStorage.getItem(KEY);if(raw===null){data=samples();save();return}const parsed=JSON.parse(raw);if(!Array.isArray(parsed))throw Error('invalid');data=parsed.map(sanitize).filter(Boolean);fixTree()}catch(e){data=samples();showToast('Storage unavailable or invalid; sample board loaded.')}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(data));window.WCHooks&&window.WCHooks.onSave&&window.WCHooks.onSave(data);return true}catch(e){showToast('Could not save locally. Export your board.');return false}}
function showToast(message){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,3200)}
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el}
function render(){if(view==='wbs'){renderWbs();return}renderBoardFilters();const query=$('searchInput').value.trim().toLowerCase();for(const cell of cells){cell.replaceChildren();const shown=data.filter(x=>x.when===cell.dataset.when&&x.kind===cell.dataset.kind&&matchesBoardFilters(x)&&(!query||[x.title,x.description,x.owner].join(' ').toLowerCase().includes(query))).sort((a,b)=>a.order-b.order);cell.classList.toggle('empty',shown.length===0);for(const x of shown){const card=node('article','chunk');card.draggable=!document.body.classList.contains('readonly');card.dataset.id=x.id;const meta=node('div','meta');meta.append(node('span','pill effort',x.effort),node('span','pill',x.status));const par=data.find(a=>a.id===x.parent);if(par)card.append(node('div','crumb','↳ '+par.title));card.append(meta,node('h3','',x.title));if(x.description)card.append(node('p','',x.description));const kids=data.filter(a=>a.parent===x.id).length;if(kids)card.append(node('div','crumb',kids+(kids===1?' subtask':' subtasks')));card.append(chips(x));const foot=node('footer');const details=[x.owner,x.due?`Due ${x.due}`:''].filter(Boolean).join(' · ');foot.append(node('span','',details));const edit=node('button','edit','Edit');edit.type='button';edit.setAttribute('aria-label','Edit '+x.title);edit.addEventListener('click',()=>openEditor(x.id));foot.append(edit);card.append(foot);card.addEventListener('dragstart',event=>{dragId=x.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',x.id);card.classList.add('is-dragging')});card.addEventListener('dragend',()=>{dragId=null;card.classList.remove('is-dragging');cells.forEach(c=>c.classList.remove('drag-over'))});cell.append(card)}if(!shown.length)cell.append(node('span','empty-hint','Drop a work item here or add one below.'));const add=node('button','add-inline','+ Add here');add.addEventListener('click',()=>openEditor(null,cell.dataset.when,cell.dataset.kind));cell.append(add)}$('countStatus').textContent=`${data.filter(x=>matchesBoardFilters(x)&&(!query||[x.title,x.description,x.owner].join(' ').toLowerCase().includes(query))).length} work items shown · ${data.length} total`}
function openEditor(id,when=WHEN[0],kind=KIND[0],parent=''){const x=data.find(a=>a.id===id);$('chunkForm').reset();$('chunkId').value=x?.id||'';$('modalTitle').textContent=x?'Edit work item':'Add work item';$('deleteBtn').hidden=!x;$('title').value=x?.title||'';$('description').value=x?.description||'';$('owner').value=x?.owner||'';if($('owner_id'))$('owner_id').value=x?.owner_id||'';if($('poc'))$('poc').value=x?.poc||x?.owner||'';$('when').value=x?.when||when;$('kind').value=x?.kind||kind;$('effort').value=x?.effort||'Medium';$('itemStatus').value=x?.status||'To Do';$('due').value=x?.due||'';fillParents(x,parent);$('editor').showModal();window.WCHooks&&window.WCHooks.onEdit&&window.WCHooks.onEdit(x||null);$('title').focus()}
$('chunkForm').addEventListener('submit',event=>{event.preventDefault();const id=$('chunkId').value;const old=data.find(x=>x.id===id);const item=sanitize({id:id||uid(),title:$('title').value.trim(),description:$('description').value.trim(),owner:$('owner_id')?.selectedOptions?.[0]?.value?$('owner_id').selectedOptions[0].textContent:$('owner').value.trim(),owner_id:$('owner_id')?.value||null,poc:$('poc')?.value.trim()||'',when:$('when').value,column_id:layout.columns.find(c=>c.name===$('when').value)?.id,kind:$('kind').value,status:$('itemStatus').value,effort:$('effort').value,due:$('due').value,parent:$('parent').value,attachments:old?old.attachments:[],order:old?.order??(Math.max(0,...data.map(x=>x.order))+1)});if(!item){showToast('Enter a valid work item.');return}if(old)Object.assign(old,item);else data.push(item);save();render();$('editor').close()});
$('deleteBtn').addEventListener('click',()=>{if(!confirm('Delete this work item?'))return;const gone=data.find(x=>x.id===$('chunkId').value);if(gone){data.forEach(a=>{if(a.parent===gone.id)a.parent=gone.parent});window.WCHooks&&window.WCHooks.onRemove&&window.WCHooks.onRemove(gone)}data=data.filter(x=>x.id!==$('chunkId').value);save();render();$('editor').close()});
$('cancelBtn').addEventListener('click',()=>$('editor').close());$('newBtn').addEventListener('click',()=>openEditor());$('searchInput').addEventListener('input',render);
function wireCell(cell){cell.addEventListener('dragover',event=>{if(!dragId)return;event.preventDefault();event.dataTransfer.dropEffect='move';cell.classList.add('drag-over')});cell.addEventListener('dragleave',event=>{if(!cell.contains(event.relatedTarget))cell.classList.remove('drag-over')});cell.addEventListener('drop',event=>{event.preventDefault();cell.classList.remove('drag-over');const x=data.find(a=>a.id===dragId);if(!x)return;x.when=cell.dataset.when;x.column_id=layout.columns.find(c=>c.name===x.when)?.id;x.kind=cell.dataset.kind;x.order=Math.max(0,...data.filter(a=>a.when===x.when&&a.kind===x.kind).map(a=>a.order))+1;save();render()})}
$('exportBtn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='work-items-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)});
$('importInput').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>2_000_000)throw Error('File is too large');const parsed=JSON.parse(await file.text());if(!Array.isArray(parsed))throw Error('Expected a JSON array');const clean=parsed.map(sanitize);if(clean.some(x=>!x))throw Error('File has invalid work items');if(new Set(clean.map(x=>x.id)).size!==clean.length)throw Error('Duplicate IDs in file');if(confirm(`Replace the current board with ${clean.length} imported work items?`)){data=clean;fixTree();save();render();showToast('Board imported')}}catch(err){showToast('Import failed: '+err.message)}finally{event.target.value=''}});
$('resetBtn').addEventListener('click',()=>{if(!confirm('Replace your board with the original sample items? Export first if you need a backup.'))return;data=samples();save();render();showToast('Sample board restored')});
window.WCHooks={};window.WCBoard={get:()=>data,getLayout:()=>layout,toast:showToast,commit:()=>{save();render()},set:(d,l)=>{applyLayout(l);data=d.map(sanitize).filter(Boolean);fixTree();try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){}render()}};$('viewBoard').addEventListener('click',()=>setView('board'));$('viewWbs').addEventListener('click',()=>setView('wbs'));applyLayout(null);load();render();
})();
