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
 (isGlobal?'<fieldset class="ap-theme-picker ap-theme-access" id="orgThemeAccess" disabled><legend>Special theme availability</legend><p class="ap-msg">Choose which themes this organization can use.</p><div id="orgThemeChoices"></div><button type="button" class="ap-btn primary" id="orgThemeAccessSave">Save theme availability</button><p id="orgThemeAccessStatus" role="status" class="ap-msg"></p></fieldset>':'')+
 '<label class="ap-theme-picker">Organization theme<select id="orgThemeMode" class="ap-input" disabled></select></label>'+
 '<div class="ap-org-brand-fields"><label>Primary color <input type="color" id="orgBrandPrimary"></label><label>Secondary color <input type="color" id="orgBrandSecondary"></label><label>Accent color <input type="color" id="orgBrandAccent"></label></div>'+
 '<div class="ap-org-brand-fields"><label>Organization logo (any browser-supported image, 2 MB max)<input id="orgBrandFile" class="ap-input" type="file" accept=".svg,.png,image/svg+xml,image/png"></label><div><img id="orgBrandPreview" alt="Organization logo preview" hidden><button id="orgBrandRemove" type="button" class="ap-btn sm">Remove logo</button></div></div>'+
 '<div class="ap-row"><button id="orgBrandSuggest" type="button" class="ap-btn" style="background:#e8f3fc;color:#006bb6;border-color:#b7d9ef">✦ Suggest palette with AI</button></div><p id="orgBrandAiStatus" class="ap-msg" role="status"></p><div id="orgBrandAiResult" class="ap-org-ai-result" hidden></div>'+ 
 '<div class="ap-row"><button id="orgBrandSave" class="ap-btn primary" type="button">Save organization profile</button><button id="orgBrandReset" class="ap-btn" type="button">Reset colors to 90s6</button></div><p id="orgBrandStatus" class="ap-msg" role="status"></p>';
 if(isGlobal)host.insertAdjacentElement('afterend',panel);else host.prepend(panel);
 let logo=null,tenant=null,loaded=false;const aiStatus=t=>{$('orgBrandAiStatus').textContent=t};
 const status=(t)=>{$('orgBrandStatus').textContent=t};
 const fields={primary_color:$('orgBrandPrimary'),secondary_color:$('orgBrandSecondary'),accent_color:$('orgBrandAccent')};
 const preview=()=>{const img=$('orgBrandPreview');img.hidden=!logo;if(logo)img.src=logo;else img.removeAttribute('src')};
 const themes=[{id:'wild',name:'Wild Theme',colors:['#C40016','#D6AA7C','#15151B']},{id:'vs',name:'VS',colors:['#E91E63','#F5A9C5','#171317']},{id:'tiffany',name:'Tiffany',colors:['#81D8D0','#007F79','#FFFFFF']}];
 let savedAllowed=[],savedMode='logo',loadVersion=0;
 function syncThemes(allowed,preferred=$('orgThemeMode').value){
  const mode=$('orgThemeMode');
  mode.replaceChildren();
  for(const t of [{id:'default',name:'90s6 Default'},{id:'logo',name:'Logo-generated / custom palette'},...themes.filter(t=>allowed.includes(t.id))]){
   const o=document.createElement('option');o.value=t.id;o.textContent=t.name;mode.append(o);
  }
  mode.value=Array.from(mode.options).some(o=>o.value===preferred)?preferred:'logo';
 }
 function renderAccess(allowed){
  if(!isGlobal)return;
  const host=$('orgThemeChoices');host.replaceChildren();
  for(const t of themes){
   const label=document.createElement('label');label.className='ap-theme-choice';
   const swatches=document.createElement('span');swatches.className='ap-theme-swatches';
   for(const color of t.colors){const sw=document.createElement('span');sw.style.backgroundColor=color;swatches.append(sw);}
   const name=document.createElement('span');name.textContent=t.name;
   const input=document.createElement('input');input.type='checkbox';input.value=t.id;input.checked=allowed.includes(t.id);
   label.append(swatches,name,input);host.append(label);
  }
 }
 const selectedThemes=()=>Array.from($('orgThemeChoices')?.querySelectorAll('input:checked')||[],e=>e.value);
 if(isGlobal)$('orgThemeAccessSave').onclick=async()=>{
  if(!loaded||!tenant)return;
  const id=tenant,allowed=selectedThemes(),btn=$('orgThemeAccessSave'),msg=$('orgThemeAccessStatus');
  btn.disabled=true;$('orgBrandTenant').disabled=true;$('orgBrandSave').disabled=true;msg.textContent='Saving...';
  try{
   const {data,error}=await sb.from('organization_profiles').upsert({tenant_id:id,allowed_special_themes:allowed},{onConflict:'tenant_id'}).select('theme_mode,allowed_special_themes').single();
   if(error)throw error;
   savedAllowed=data.allowed_special_themes||[];savedMode=data.theme_mode||'logo';
   syncThemes(savedAllowed,savedMode);renderAccess(savedAllowed);msg.textContent='Theme availability saved.';
   window.dispatchEvent(new Event('organization-profile-updated'));
  }catch(e){msg.textContent='Save failed: '+e.message;}
  finally{btn.disabled=false;$('orgBrandTenant').disabled=false;$('orgBrandSave').disabled=false;}
 };
 async function load(id){
  const version=++loadVersion;tenant=id;loaded=false;savedAllowed=[];savedMode='logo';$('orgThemeMode').disabled=true;$('orgBrandSave').disabled=true;if(isGlobal){$('orgThemeAccess').disabled=true;renderAccess([]);$('orgThemeAccessStatus').textContent='';}logo=null;preview();status('');$('orgBrandAiResult').hidden=true;aiStatus('');
  Object.entries(fields).forEach(([k,e])=>e.value=defaults[k]);
  const mode=$('orgThemeMode');syncThemes([],'logo');
  if(!id)return;
  const {data,error}=await sb.from('organization_profiles').select('*').eq('tenant_id',id).maybeSingle();
  if(version!==loadVersion)return;
  if(error){status('Could not load profile: '+error.message);return;}
  Object.entries(fields).forEach(([k,e])=>e.value=data?.[k]||defaults[k]);
  const allowed=data?.allowed_special_themes||[];
  savedAllowed=allowed;savedMode=data?.theme_mode||'logo';syncThemes(allowed,savedMode);renderAccess(allowed);
  mode.disabled=false;$('orgBrandSave').disabled=false;if(isGlobal)$('orgThemeAccess').disabled=false;
  logo=data?.logo_data||null;preview();loaded=true;
 }
 if(isGlobal){
  renderAccess([]);
  App.onSession(async(session,profile)=>{if(!session||!profile?.is_admin)return;const select=$('orgBrandTenant');const {data,error}=await sb.from('tenants').select('id,name').order('name');if(error){status(error.message);return;}select.replaceChildren(new Option('Choose organization',''));for(const t of data||[])select.append(new Option(t.name,t.id));const id=App.activeTenantId||data?.[0]?.id;if(id){select.value=id;await load(id);}});
  $('orgBrandTenant').onchange=e=>load(e.target.value);
 }else{
  App.onSession((session,profile)=>{if(!session)return;const id=new URLSearchParams(location.search).get('tenant')||App.activeTenantId;if(id)load(id)});
 }
 $('orgBrandRemove').onclick=()=>{logo=null;$('orgBrandAiResult').hidden=true;preview();status('Logo removed from preview. Save to apply.')};
 $('orgBrandReset').onclick=()=>{$('orgThemeMode').value='default';Object.entries(fields).forEach(([k,e])=>e.value=defaults[k]);status('Default colors selected. Save to apply.')};
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
   }
   const objectUrl=URL.createObjectURL(new Blob([raw],{type:svg?'image/svg+xml':file.type}));
   try{
    const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Could not decode logo.'));img.src=objectUrl;});
    if(!img.naturalWidth||!img.naturalHeight)throw Error('Image has invalid dimensions.');
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
  apply.onclick=()=>{$('orgThemeMode').value='logo';for(const [key,field] of Object.entries(fields))field.value=colors[key];aiStatus('Suggested colors applied. Save organization profile to publish.');};
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
    const {data:visionSettings}=await sb.from('ai_vision_settings').select('enabled').eq('id',true).maybeSingle();
    let data,error;
    if(visionSettings?.enabled){
      ({data,error}=await sb.functions.invoke('organization-logo-vision',{body:{tenant_id:selectedTenant,image:selectedLogo}}));
    }else{
      ({data,error}=await sb.functions.invoke('ai-platform-gateway',{body:{component:'platform_content',tenant_id:selectedTenant,content:prompt}}));
    }
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
  const btn=$('orgBrandSave');btn.disabled=true;if(isGlobal){$('orgBrandTenant').disabled=true;$('orgThemeAccess').disabled=true;}status('Saving...');
  try{
   const payload={tenant_id:tenant,logo_data:logo,theme_mode:$('orgThemeMode').value};
   for(const [k,e] of Object.entries(fields))payload[k]=e.value.toLowerCase()===defaults[k].toLowerCase()?null:e.value;
   const {error}=await sb.from('organization_profiles').upsert(payload,{onConflict:'tenant_id'});
   if(error)throw error;
   status('Organization profile saved.');window.dispatchEvent(new Event('organization-profile-updated'));
  }catch(err){status('Save failed: '+err.message)}
  finally{btn.disabled=false;if(isGlobal){$('orgBrandTenant').disabled=false;$('orgThemeAccess').disabled=false;}}
 };
})();