(() => {
'use strict';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const token=new URLSearchParams(location.search).get('token');
const fail=message=>{$('status').textContent=message};
if(!token||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)){fail('This share link is invalid.');return}
const sb=window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL,window.APP_CONFIG.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
(async()=>{
 const {data,error}=await sb.rpc('get_public_board',{p_token:token});
 if(error||!data){fail('This board is unavailable or its public link has been disabled.');return}
 const items=Array.isArray(data.data)?data.data:[];
 const layout=data.config||{};
 const columns=Array.isArray(layout.columns)&&layout.columns.length?layout.columns:[{name:'Now'},{name:'Next'},{name:'Later'}];
 const lanes=Array.isArray(layout.lanes)&&layout.lanes.length?layout.lanes:[{name:'Have to do'},{name:'Want to do'}];
 $('title').textContent=data.name||'Shared Work Board';document.title=(data.name||'Work Board')+' | 90S6';
 const grid=node('div',undefined,'grid');grid.style.setProperty('--cols',columns.length);
 grid.append(node('div','Swimlanes / Columns','corner'));
 for(const col of columns){const head=node('div',undefined,'head');head.append(node('h2',col.name||''));if(col.hint)head.append(node('p',col.hint));grid.append(head)}
 for(const lane of lanes){const side=node('div',undefined,'lane');side.append(node('strong',lane.name||''));if(lane.hint)side.append(node('p',lane.hint));grid.append(side);
  for(const col of columns){const cell=node('div',undefined,'cell');for(const x of items.filter(x=>x.kind===lane.name&&x.when===col.name).sort((a,b)=>(a.order||0)-(b.order||0))){
   const card=node('article',undefined,'item');card.append(node('h3',x.title||'Untitled'));if(x.description)card.append(node('p',x.description));const meta=[x.owner,x.effort,x.due?'Due '+x.due:''].filter(Boolean).join(' · ');if(meta)card.append(node('div',meta,'meta'));cell.append(card)
  }grid.append(cell)}
 }
 $('board').append(grid);
 const table=node('table');const thead=node('thead');const hr=node('tr');['WBS','Work Item','Owner','Column','Swimlane','Size','Due'].forEach(h=>hr.append(node('th',h)));thead.append(hr);table.append(thead);
 const tbody=node('tbody'),byParent=new Map(),ids=new Set(items.map(x=>x.id));
 for(const x of items){const p=ids.has(x.parent)&&x.parent!==x.id?x.parent:'';if(!byParent.has(p))byParent.set(p,[]);byParent.get(p).push(x)}
 for(const arr of byParent.values())arr.sort((a,b)=>(a.order||0)-(b.order||0));
 const visited=new Set();
 function walk(parent,prefix,depth){(byParent.get(parent)||[]).forEach((x,i)=>{if(visited.has(x.id))return;visited.add(x.id);const num=prefix?prefix+'.'+(i+1):String(i+1);const tr=node('tr');[num,x.title,x.owner,x.when,x.kind,x.effort,x.due].forEach((v,j)=>{const td=node('td',v||'');if(j===1)td.style.paddingLeft=(11+depth*20)+'px';tr.append(td)});tbody.append(tr);walk(x.id,num,depth+1)})}
 walk('','',0);table.append(tbody);$('wbs').append(table);
 $('status').hidden=true;$('content').hidden=false;
 const mode=wbs=>{$('board').hidden=wbs;$('wbs').hidden=!wbs;$('boardMode').classList.toggle('primary',!wbs);$('wbsMode').classList.toggle('primary',wbs)};
 $('boardMode').onclick=()=>mode(false);$('wbsMode').onclick=()=>mode(true);
})().catch(()=>fail('Could not load the shared board.'));
})();