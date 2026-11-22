(()=>{'use strict';const $=id=>document.getElementById(id);let articles=[],selected=null;const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e};
function inlineMarkdown(source){
  const fragment=document.createDocumentFragment();
  const pattern=/(!?\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last=0,match;
  while((match=pattern.exec(source))){
    if(match.index>last)fragment.append(document.createTextNode(source.slice(last,match.index)));
    if(match[2]!==undefined){
      const url=match[3];
      if(match[1].startsWith('!')){
        const img=el('img');img.src=url;img.alt=match[2];img.loading='lazy';fragment.append(img);
      }else{
        const a=el('a',match[2]);a.href=url;a.target='_blank';a.rel='noopener noreferrer';fragment.append(a);
      }
    }else if(match[4]!==undefined)fragment.append(el('strong',match[4]));
    else if(match[5]!==undefined)fragment.append(el('em',match[5]));
    else fragment.append(el('code',match[6]));
    last=pattern.lastIndex;
  }
  if(last<source.length)fragment.append(document.createTextNode(source.slice(last)));
  return fragment;
}
function renderMarkdown(source){
  const root=document.createDocumentFragment(),lines=String(source||'').split(/\r?\n/);
  let list=null,code=null;
  for(let i=0;i<lines.length;i++){
    const line=lines[i],trimmed=line.trim();
    if(/^\x60{3}/.test(trimmed)){
      if(code){root.append(code);code=null}else{code=el('pre');code.append(el('code'))}
      list=null;continue;
    }
    if(code){code.firstChild.textContent+=(code.firstChild.textContent?'\n':'')+line;continue}
    if(!trimmed){list=null;continue}
    if(/^\|/.test(trimmed)&&i+1<lines.length&&/^\|?\s*:?-{3,}/.test(lines[i+1].trim())){
      const table=el('table'),head=el('thead'),body=el('tbody');
      const cells=row=>row.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      const addRow=(target,row,tag)=>{const tr=el('tr');cells(row).forEach(c=>{const cell=el(tag);cell.append(inlineMarkdown(c));tr.append(cell)});target.append(tr)};
      addRow(head,line,'th');i+=2;
      while(i<lines.length&&lines[i].trim().startsWith('|')){addRow(body,lines[i],'td');i++}
      i--;table.append(head,body);root.append(table);list=null;continue;
    }
    const heading=line.match(/^(#{1,6})\s+(.+)$/);
    if(heading){const h=el('h'+heading[1].length);h.append(inlineMarkdown(heading[2]));root.append(h);list=null;continue}
    const bullet=line.match(/^\s*[-*+]\s+(.+)$/),numbered=line.match(/^\s*\d+\.\s+(.+)$/);
    if(bullet||numbered){const type=bullet?'ul':'ol';if(!list||list.tagName.toLowerCase()!==type){list=el(type);root.append(list)}const li=el('li');li.append(inlineMarkdown((bullet||numbered)[1]));list.append(li);continue}
    list=null;
    if(/^>\s?/.test(line)){const quote=el('blockquote');quote.append(inlineMarkdown(line.replace(/^>\s?/,'')));root.append(quote);continue}
    const p=el('p');p.append(inlineMarkdown(line));root.append(p);
  }
  if(code)root.append(code);
  return root;
}
function render(){const q=$('kbSearch').value.toLowerCase().trim(),cat=$('kbCategory').value;const filtered=articles.filter(a=>(!cat||a.category===cat)&&(!q||[a.title,a.summary,a.body,a.category,...a.tags].join(' ').toLowerCase().includes(q)));$('kbStatus').textContent=filtered.length+' article'+(filtered.length===1?'':'s');const list=$('kbList');list.replaceChildren();filtered.forEach(a=>{const b=el('button');b.type='button';b.className='kb-item'+(a.id===selected?.id?' active':'');b.append(el('small',a.category),el('strong',a.title),el('span',a.summary||'Read article'));b.onclick=()=>{selected=a;render()};list.append(b)});if(!filtered.some(a=>a.id===selected?.id))selected=filtered[0]||null;$('kbArticle').hidden=!selected;if(selected){$('kbArticleCategory').textContent=selected.category;$('kbArticleTitle').textContent=selected.title;$('kbArticleSummary').textContent=selected.summary;$('kbArticleBody').replaceChildren(renderMarkdown(selected.body));$('kbArticleTags').replaceChildren(...selected.tags.map(t=>{const s=el('span',t);s.className='kb-tag';return s}))}list.querySelectorAll('button').forEach((b,i)=>b.classList.toggle('active',filtered[i].id===selected?.id))}
$('kbSearch').oninput=render;$('kbCategory').onchange=render;
App.onSession(async s=>{if(!s)return;const {data,error}=await App.sb.from('knowledge_articles').select('id,title,category,summary,body,tags,updated_at').eq('status','published').is('archived_at',null).order('updated_at',{ascending:false});if(error){$('kbStatus').textContent='Unable to load articles: '+error.message;return}articles=data||[];const categories=[...new Set(articles.map(a=>a.category))].sort();categories.forEach(c=>{const o=el('option',c);o.value=c;$('kbCategory').append(o)});render()});
})();