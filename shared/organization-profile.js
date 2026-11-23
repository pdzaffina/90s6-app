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
 '<div class="ap-row"><button id="orgBrandSave" class="ap-btn primary" type="button">Save organization profile</button><button id="orgBrandReset" class="ap-btn" type="button">Reset colors to 90s6</button></div><p id="orgBrandStatus" class="ap-msg" role="status"></p>';
 if(isGlobal)host.insertAdjacentElement('afterend',panel);else host.prepend(panel);
 let logo=null,tenant=null,loaded=false;
 const status=(t)=>{$('orgBrandStatus').textContent=t};
 const fields={primary_color:$('orgBrandPrimary'),secondary_color:$('orgBrandSecondary'),accent_color:$('orgBrandAccent')};
 const preview=()=>{const img=$('orgBrandPreview');img.hidden=!logo;if(logo)img.src=logo;else img.removeAttribute('src')};
 async function load(id){
  tenant=id;loaded=false;logo=null;preview();status('');
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
 $('orgBrandRemove').onclick=()=>{logo=null;preview();status('Logo removed from preview. Save to apply.')};
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
    logo=png;preview();status('Logo ready. Save to apply.');
   }finally{URL.revokeObjectURL(objectUrl);}
  }catch(err){status(err.message);}
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