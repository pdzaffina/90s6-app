(function(){
function init(){
 const root=document.getElementById('adminBody')||document.getElementById('tenantAdminPanel');
 if(!root)return;
 const isTenant=!!document.getElementById('tenantAdminPanel');
 let panels=[];
 if(isTenant){
   const sources=root.querySelector('#sentinelSourcePanel');
   const nodes=Array.from(root.children).filter(node=>node!==sources);
   const groups=[
     {title:'Members',start:0,end:nodes.findIndex(n=>n.tagName==='H3'&&/Member application access/i.test(n.textContent))},
     {title:'Application access',start:nodes.findIndex(n=>n.tagName==='H3'&&/Member application access/i.test(n.textContent)),end:nodes.findIndex(n=>n.tagName==='H3'&&/Add or update a member/i.test(n.textContent))},
     {title:'Add or update member',start:nodes.findIndex(n=>n.tagName==='H3'&&/Add or update a member/i.test(n.textContent)),end:nodes.length}
   ];
   groups.forEach(g=>{if(g.start<0||g.end<=g.start)return;const p=document.createElement('section');p.className='ap-panel';const h=document.createElement('h2');h.textContent=g.title;p.append(h);nodes.slice(g.start,g.end).forEach(n=>{if(n.tagName==='H2'||n.tagName==='H3')return;p.append(n)});root.append(p);panels.push(p)});
    if(sources)panels.push(sources);
 }else{panels=Array.from(root.children).filter(n=>n.matches('section.ap-panel'))}
 if(!panels.length)return;
 const workspace=document.createElement('div');workspace.className='admin-workspace';
 const aside=document.createElement('aside');aside.className='admin-sidebar';aside.setAttribute('aria-label','Administration sections');
 const label=document.createElement('div');label.className='admin-sidebar-title';label.textContent=isTenant?'Organization settings':'Platform settings';
 const nav=document.createElement('nav');nav.className='admin-nav';nav.setAttribute('aria-label','Admin sections');
 const content=document.createElement('div');content.className='admin-content';
 aside.append(label,nav);workspace.append(aside,content);root.append(workspace);
 const titles=isTenant?['Members','Application access','Add or update member']:null;
 const globalLabels={
  'AI Configuration':'AI configuration',
  'Create organization':'Create organization',
  'Organization profile':'Organization profile',
  'Organization application access':'Organization app access',
  'Invite a user':'Invite user',
  'Bulk manage users':'Bulk manage users',
  'Users':'Users',
  'Assign selected users to an organization':'Assign users to organization',
  'Application access':'User app access',
  'Audit log':'Audit log'
 };
 const seen=new Set();
 const buttons=[];
 panels.forEach((p,i)=>{content.append(p);const b=document.createElement('button');b.type='button';const heading=p.querySelector(':scope > h2')?.textContent.trim()||'Settings';
 const name=isTenant?(titles[i]||heading):(globalLabels[heading]||heading);
 b.textContent=name;
 if(seen.has(name))console.warn('Duplicate admin navigation heading:',name);
 seen.add(name);b.addEventListener('click',()=>select(i));nav.append(b);buttons.push(b)});
 function select(index){panels.forEach((p,i)=>{p.hidden=i!==index});buttons.forEach((b,i)=>{if(i===index)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});}
 select(0);
 if(!isTenant){const scope=document.getElementById('adminScope');scope?.addEventListener('change',()=>select(0));}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
