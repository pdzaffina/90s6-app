/* Organization branding editor. Logos are rasterized to bounded PNGs before persistence. */
(() => {
 'use strict';
 const sb=App.sb, $=id=>document.getElementById(id);
 const defaults={primary_color:'#006BB6',secondary_color:'#0A192F',accent_color:'#708090'};
 const isGlobal=location.pathname.startsWith('/admin/');
 const host=isGlobal?$('globalCreateOrgForm')?.closest('section'):$('tenantAdminPanel');
 if(!host)return;
 const panel=document.createElement('section');
 panel.className=isGlobal?'ap-panel':'ap-org-profile';
 panel.innerHTML='<h2>Organization profile</h2><p class="ap-msg">Customize the active organization. Leave colors at their defaults to use the 90s6 palette.</p>'+
 (isGlobal?'<label>Organization <select id="orgBrandTenant" class="ap-input"><option value="">Choose organization</option></select></label>':'')+
 '<div class="ap-org-brand-fields"><label>Primary color <input type="color" id="orgBrandPrimary"></label><label>Secondary color <input type="color" id="orgBrandSecondary"></label><label>Accent color <input type="color" id="orgBrandAccent"></label></div>'+
 '<div class="ap-org-brand-fields"><label>Organization logo (SVG or PNG, 2 MB max)<input id="orgBrandFile" class="ap-input" type="file" accept=".svg,.png,image/svg+xml,image/png"></label><div><img id="orgBrandPreview" alt="Organization logo preview" hidden><button id="orgBrandRemove" type="button" class="ap-btn sm">Remove logo</button></div></div>'+
 '<div class="ap-row"><button id="orgBrandSuggest" type="button" class="ap-btn" style="background:#e8f3fc;color:#006bb6;border-color:#b7d9ef">✦ Suggest palette with AI</button></div><p id="orgBrandAiStatus" class="ap-msg" role="status"></p><div id="orgBrandAiResult" class="ap-org-ai-result" hidden></div>'+ 
 '<div class="ap-row"><button id="orgBrandSave" class="ap-btn primary" type="button">Save organization profile</button><button id="orgBrandReset" class="ap-btn" type="button">Reset colors to 90s6</button></div><p id="orgBrandStatus" class="ap-msg" role="status"></p>';
 if(isGlobal)host.insertAdjacentElement('afterend',panel);else host.prepend(panel);
 let logo=null,tenant=null,loaded=false;const aiStatus=t=>{$('orgBrandAiStatus').textContent=t};
 const status=(t)=>{$('orgBrandStatus').textContent=t};
 const fields={primary_color:$('orgBrandPrimary'),secondary_color:$('orgBrandSecondary'),accent_color:$('orgBrandAccent')};
 const preview=()=>{const img=$('orgBrandPreview');img.hidden=!logo;if(logo)img.src=logo;else img.removeAttribute('src')};
 async function load(id){
  tenant=id;loaded=false;logo=null;preview();status('');$('orgBrandAiResult').hidden=true;aiStatus('');
  Object.entries(fields).forEach(([k,e])=>e.value=defaults[k]);
  if(!id)return;
  const {data,error}=await sb.from('organization_profiles').select('*').eq('tenant_id',id).maybeSingle();
  if(error){status('Could not load profile: '+error.message);return;}
  if(tenant!==id)return;
  Object.entries(fields).forEach(([k,e])=>e.value=data?.[k]||defaults[k]);
  logo=data?.logo_data||null;preview();loaded=true;
 }
 if(isGlobal){
  (async()=>{const {data,error}=await sb.from('tenants').select('id,name').order('name');if(error){status(error.message);return;}for(const t of data||[]){const o=document.createElement('option');o.value=t.id;o.textContent=t.name;$('orgBrandTenant').append(o);} })();
  $('orgBrandTenant').onchange=e=>load(e.target.value);
 }else{
  App.onSession((session,profile)=>{if(!session)return;const id=new URLSearchParams(location.search).get('tenant')||App.activeTenantId;if(id)load(id)});
 }
 $('orgBrandRemove').onclick=()=>{logo=null;$('orgBrandAiResult').hidden=true;preview();status('Logo removed from preview. Save to apply.')};
 $('orgBrandReset').onclick=()=>{Object.entries(fields).forEach(([k,e])=>e.value=defaults[k]);status('Default colors selected. Save to apply.')};
 $('orgBrandFile').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
   if(file.size>2*1024*1024)throw Error('Maximum logo size is 2 MB.');
   if(!/\.(png|svg)$/i.test(file.name))throw Error('Upload an SVG or PNG.');
   const svg=/\.svg$/i.test(file.name);
   if(svg && !/svg/i.test(file.type||'image/svg+xml'))throw Error('Invalid SVG file.');
   if(!svg && file.type!=='image/png')throw Error('Invalid PNG file.');
   const raw=await file.arrayBuffer();
   if(svg){
    const source=new TextDecoder().decode(raw);
    if(!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source)||/<script|<foreignObject|\bon\w+\s*=|(?:href|url)\s*=\s*["']?\s*(?:https?:|javascript:|data:)|<!ENTITY|<!DOCTYPE/i.test(source))throw Error('SVG contains unsupported or unsafe content.');
   }else{const b=new Uint8Array(raw);if(b.slice(0,8).join(',')!=='137,80,78,71,13,10,26,10')throw Error('Invalid PNG signature.');}
   const objectUrl=URL.createObjectURL(new Blob([raw],{type:svg?'image/svg+xml':'image/png'}));
   try{
    const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Could not decode logo.'));img.src=objectUrl;});
    const scale=Math.min(1,512/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const png=canvas.toDataURL('image/png');if(png.length>700000)throw Error('Logo is too complex. Try a smaller image.');
    logo=png;$('orgBrandAiResult').hidden=true;preview();status('Logo ready. Save to apply.');
   }finally{URL.revokeObjectURL(objectUrl);}
  }catch(err){status(err.message);}
 };

 const hex=n=>'#'+Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0');
 const luminance=rgb=>{const c=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
 const contrast=(a,b)=>{const l1=luminance(a),l2=luminance(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)};
 const parseColor=s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16));
 const normalize=s=>/^#[0-9a-f]{6}$/i.test(s||'')?s.toUpperCase():null;
 async function sampleLogo(){
  const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Could not analyze the logo.'));img.src=logo});
  const c=document.createElement('canvas');c.width=96;c.height=96;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,96,96);
  const scale=Math.min(96/img.width,96/img.height);ctx.drawImage(img,(96-img.width*scale)/2,(96-img.height*scale)/2,img.width*scale,img.height*scale);
  const pixels=ctx.getImageData(0,0,96,96).data;const buckets=new Map();
  for(let i=0;i<pixels.length;i+=4){
   if(pixels[i+3]<160)continue;
   const rgb=[pixels[i],pixels[i+1],pixels[i+2]];
   const spread=Math.max(...rgb)-Math.min(...rgb);
   if(spread<16&&(rgb[0]>225||rgb[0]<28))continue;
   const key=rgb.map(v=>Math.min(255,Math.round(v/24)*24)).join(',');
   const item=buckets.get(key)||{count:0,sum:[0,0,0]};item.count++;rgb.forEach((v,j)=>item.sum[j]+=v);buckets.set(key,item);
  }
  const ranked=[...buckets.values()].sort((a,b)=>b.count-a.count).slice(0,14).map(x=>({hex:'#'+x.sum.map(v=>hex(v/x.count).slice(1)).join('').toUpperCase(),count:x.count}));
  if(!ranked.length)throw Error('The logo has too few opaque colors to analyze.');
  return ranked;
 }
 function renderSuggestion(colors,explanation,source){
  const result=$('orgBrandAiResult');result.replaceChildren();
  const heading=document.createElement('strong');heading.textContent=source==='ai'?'AI suggested palette':'Image-derived palette';
  const note=document.createElement('p');note.className='ap-msg';note.textContent=explanation;
  const swatches=document.createElement('div');swatches.className='ap-org-ai-swatches';
  for(const [key,label] of [['primary_color','Primary'],['secondary_color','Secondary'],['accent_color','Accent']]){
   const wrap=document.createElement('div');const swatch=document.createElement('span');swatch.className='ap-org-ai-swatch';swatch.style.background=colors[key];
   const caption=document.createElement('span');caption.textContent=label+' '+colors[key];wrap.append(swatch,caption);swatches.append(wrap);
  }
  const apply=document.createElement('button');apply.type='button';apply.className='ap-btn primary sm';apply.textContent='Apply suggested colors';
  apply.onclick=()=>{for(const [key,field] of Object.entries(fields))field.value=colors[key];aiStatus('Suggested colors applied. Save organization profile to publish.');};
  result.append(heading,swatches,note,apply);result.hidden=false;
 }
 $('orgBrandSuggest').onclick=async()=>{
  if(!tenant||!loaded){aiStatus('Select an organization first.');return;}
  if(!logo){aiStatus('Upload an organization logo before requesting a palette.');return;}
  const selectedTenant=tenant,selectedLogo=logo,btn=$('orgBrandSuggest');btn.disabled=true;aiStatus('Analyzing logo colors and requesting AI suggestions…');$('orgBrandAiResult').hidden=true;
  try{
   const samples=await sampleLogo();
   if(tenant!==selectedTenant||logo!==selectedLogo)return;
   const distinct=samples.filter((x,i,a)=>a.findIndex(y=>Math.hypot(...parseColor(x.hex).map((v,j)=>v-parseColor(y.hex)[j]))<55)===i);
   const primary=distinct[0]?.hex||defaults.primary_color;
   const secondary=distinct.find(x=>luminance(parseColor(x.hex))<.19)?.hex||defaults.secondary_color;
   const accent=distinct.find(x=>x.hex!==primary&&x.hex!==secondary)?.hex||defaults.accent_color;
   const fallback={primary_color:primary,secondary_color:secondary,accent_color:accent};
   let colors=fallback,reason='Dominant colors extracted directly from the uploaded logo.',source='image';
   try{
    const prompt='You are a professional UI brand designer. Recommend exactly three accessible hex colors for a web application based on these sampled colors from its organization logo: '+JSON.stringify(samples)+'. Current platform defaults: '+JSON.stringify(defaults)+'. Return ONLY JSON with keys primary_color, secondary_color, accent_color, explanation. Use #RRGGBB hex colors, choose a readable dark secondary color for navigation and a strong primary for interactive controls. Do not claim to have viewed the image; you received sampled pixels. Explain the tradeoff in one sentence.';
    const {data,error}=await sb.functions.invoke('ai-platform-gateway',{body:{component:'platform_content',tenant_id:selectedTenant,content:prompt}});
    if(error||data?.error)throw Error(data?.error||error.message);
    const response=String(data?.content||'').replace(/^\s*```(?:json)?/i,'').replace(/```\s*$/,'').trim();
    const parsed=JSON.parse(response);
    const candidate=Object.fromEntries(Object.keys(defaults).map(k=>[k,normalize(parsed[k])]));
    if(Object.values(candidate).some(v=>!v))throw Error('AI returned invalid color values.');
    if(contrast(parseColor(candidate.secondary_color),[255,255,255])<4.5)throw Error('AI secondary color has insufficient white-text contrast.');
    colors=candidate;reason=String(parsed.explanation||'Suggested using the sampled logo colors.').slice(0,300);source='ai';
   }catch(err){reason='AI unavailable ('+err.message+'). Showing a palette derived from the logo pixels instead.';}
   if(tenant!==selectedTenant||logo!==selectedLogo)return;
   renderSuggestion(colors,reason,source);aiStatus(source==='ai'?'AI palette ready for review.':'Logo color palette ready for review.');
  }catch(err){aiStatus('Palette suggestion failed: '+err.message)}
  finally{btn.disabled=false;}
 };
 $('orgBrandSave').onclick=async()=>{
  if(!tenant||!loaded){status('Select an organization and wait for its profile to load.');return;}
  const btn=$('orgBrandSave');btn.disabled=true;status('Saving...');
  try{
   const payload={tenant_id:tenant,logo_data:logo};
   for(const [k,e] of Object.entries(fields))payload[k]=e.value.toLowerCase()===defaults[k].toLowerCase()?null:e.value;
   const {error}=await sb.from('organization_profiles').upsert(payload,{onConflict:'tenant_id'});
   if(error)throw error;
   status('Organization profile saved.');window.dispatchEvent(new Event('organization-profile-updated'));
  }catch(err){status('Save failed: '+err.message)}
  finally{btn.disabled=false;}
 };
})();