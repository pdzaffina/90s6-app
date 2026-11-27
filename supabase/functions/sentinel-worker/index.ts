import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { isTransientStatus, MAX_ATTEMPTS, retryAfterSeconds, retryDelay } from './retry.mjs';

class ProviderError extends Error {
 constructor(message: string, readonly transient: boolean, readonly retryAfter = 0) {
  super(message);
 }
}

Deno.serve(async req=>{
 const reply=(v:unknown,status=200)=>Response.json(v,{status});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const db=createClient(url,key,{auth:{persistSession:false}});
 let token;try{token=(await req.json()).token}catch{return reply({error:'Unauthorized'},401)}
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return reply({error:'Unauthorized'},401);
 const auth=await db.rpc('sentinel_consume_token',{p_token:token});
 if(auth.error||auth.data!==true)return reply({error:'Unauthorized'},401);
 const result=await db.rpc('sentinel_claim');if(result.error)return reply({error:'Claim failed'},500);
 const job=result.data;if(!job)return reply({status:'idle'});
 const save=async (values:Record<string,unknown>)=>{
  const result=await db.from('sentinel_scan_runs').update(values).eq('id',job.id)
   .eq('status','running').eq('started_at',job.started_at).select('id').maybeSingle();
  return result.error ? reply({error:'Save failed'},500) : result.data ? null : reply({status:'lease-lost'},409);
 };
 const providerFetch=async(provider:string,url:URL,headers?:HeadersInit)=>{
  const gate=await db.rpc('sentinel_provider_gate',{p_provider:provider});
  if(gate.error||!gate.data)throw new ProviderError(provider+' temporarily unavailable',true);
  let response:Response;
  try{response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error',headers});}
  catch{
   await db.rpc('sentinel_note_provider_result',{p_provider:provider,p_status:0});
   throw new ProviderError(provider+' request failed',true);
  }
  await db.rpc('sentinel_note_provider_result',{p_provider:provider,p_status:response.status});
  if(response.ok)return response;
  const delay=retryAfterSeconds(response.headers.get('retry-after'));
  if(response.status===429||delay){
   const cooldown=Math.min(86400,Math.max(delay,60));
   await db.rpc('sentinel_provider_gate',{p_provider:provider,p_cooldown_seconds:cooldown});
  }
  throw new ProviderError(provider+' HTTP '+response.status,isTransientStatus(response.status),delay);
 };
 let evidence:unknown[]=[],status='complete',error=null;
 try{
 const name=String(job.name).replace(/[^\p{L}\p{N}\s.-]/gu,' ').trim().slice(0,200);
 if(!name)throw Error('Empty query');
 const seen=new Set<string>();
 const decode=(s:string)=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(m,k)=>{const n=k[0]==='#'?(k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):parseInt(k.slice(1),10)):0;return k[0]==='#'?(n>0&&n<=0x10ffff?String.fromCodePoint(n):m):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[k]||m});
 const field=(s:string,k:string)=>decode(s.match(new RegExp('<'+k+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+k+'>','i'))?.[1]||'').trim();
 const normalize=(articles:any[],provider:string)=>articles.slice(0,30).flatMap(a=>{try{const u=new URL(a.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return [];u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_'))u.searchParams.delete(k);if(seen.has(u.href))return [];seen.add(u.href);return [{url:u.href,title:String(a.title||'').slice(0,300),description:'',published:a.published||null,source:String(a.source||u.hostname).slice(0,200),provider}]}catch{return []}});
 const rss=async()=>{const u=new URL('https://news.google.com/rss/search');for(const [k,v] of Object.entries({q:'"'+name+'" when:7d',hl:'en-US',gl:'US',ceid:'US:en'}))u.searchParams.set(k,v);
 const r=await providerFetch('google-news-rss',u,{Accept:'application/rss+xml, application/xml, text/xml'});
 const xml=await r.text();if(!/<rss[\s>]/i.test(xml)||!/<channel[\s>]/i.test(xml))throw Error('Invalid Google News RSS response');
 return normalize([...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>{const s=m[1],d=new Date(field(s,'pubDate'));return {url:field(s,'link'),title:field(s,'title'),source:field(s,'source'),published:Number.isNaN(d.getTime())?null:d.toISOString()}}),'google-news-rss');};
 const gdelt=async()=>{const u=new URL('https://api.gdeltproject.org/api/v2/doc/doc');for(const [k,v] of Object.entries({query:'"'+name+'"',mode:'artlist',format:'json',maxrecords:'30',timespan:'7d',sort:'datedesc'}))u.searchParams.set(k,v);
 const r=await providerFetch('gdelt',u);const data=await r.json();if(!Array.isArray(data.articles))throw Error('Invalid GDELT response');return normalize(data.articles.map((a:any)=>({...a,published:a.seendate})),'gdelt');};
 try{evidence=await gdelt();}
 catch(primary){
  try{
   evidence=await rss();
   status='partial';
   error='Primary collection unavailable. Using Google News RSS coverage.';
  }catch(secondary){
   const failures=[primary,secondary].filter((cause):cause is ProviderError=>cause instanceof ProviderError);
   throw new ProviderError(failures.map(cause=>cause.message).join('; ')||'Providers returned invalid data',
    failures.some(cause=>cause.transient),Math.max(0,...failures.map(cause=>cause.retryAfter)));
  }
 }

 }catch(e){
  status='failed';
  error=e instanceof Error?e.message:'Search failed';
  if(e instanceof ProviderError&&e.transient&&job.attempt<MAX_ATTEMPTS){
   const next_attempt_at=new Date(Date.now()+1000*retryDelay(job.attempt,e.retryAfter)).toISOString();
   return await save({status:'queued',next_attempt_at,error}) ?? reply({status:'retry-scheduled'});
  }
 }
 let assessment:string|null=null;
 if(status!=='failed'&&evidence.length){
 const checkpoint=await save({evidence,error});
 if(checkpoint)return checkpoint;
 let usage:string|null=null, input=0,output=0,cost=0,billed=false;
 try{
 const apiKey=Deno.env.get('AINBOX_LLM_API_KEY'),base=(Deno.env.get('AINBOX_LLM_BASE_URL')||'https://integrate.api.nvidia.com/v1').replace(/\/+$/,'');
 if(!apiKey||!base.startsWith('https://'))throw Error('AI provider unavailable');
 const reservation=await db.rpc('sentinel_ai_begin',{p_run:job.id,p_evidence:evidence.map((a:any,i)=>({...a,source_number:i+1}))});
 if(reservation.error)throw Error(reservation.error.message);
 const cfg=reservation.data;
 if(cfg){
 usage=cfg.usage_id;
 const response=await fetch(base+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify(cfg.payload),signal:AbortSignal.timeout(Math.min(85000,Math.max(5000,Number(cfg.timeout_ms)||20000)))});
 const data=await response.json();
 input=Number(data?.usage?.prompt_tokens)||0;output=Number(data?.usage?.completion_tokens)||0;cost=(input*Number(cfg.input_rate)+output*Number(cfg.output_rate))/1000000;billed=response.ok;
 const audit=await db.from('ainbox_ai_request_audit').update({response_payload:data,response_at:new Date().toISOString(),http_status:response.status,provider_request_id:response.headers.get('x-request-id'),input_tokens:input,output_tokens:output,estimated_usd:cost,error_message:response.ok?null:'Provider HTTP '+response.status}).eq('usage_id',usage);
 if(audit.error)throw Error('AI response audit failed');
 if(!response.ok)throw Error('AI provider HTTP '+response.status);
 const raw=data?.choices?.[0]?.message?.content;
 if(typeof raw!=='string'||!raw.trim())throw Error('AI returned no visible assessment; check model and token budget');
 assessment=raw.trim().slice(0,16000);
 }
 }catch(e){status='partial';error='Assessment unavailable: '+(e instanceof Error?e.message:'AI request failed');if(usage)await db.from('ainbox_ai_request_audit').update({error_message:error,response_at:new Date().toISOString()}).eq('usage_id',usage);}
 finally{if(usage){const finish=await db.from('ainbox_ai_usage').update({status:billed?'completed':'failed',reserved_usd:0,input_tokens:input,output_tokens:output,estimated_usd:cost}).eq('id',usage).eq('status','reserved');if(finish.error){assessment=null;status='partial';error='AI usage finalization failed';}}}
 }
 return await save({status,error,evidence,assessment,finished_at:new Date().toISOString()})
  ?? reply({status,count:evidence.length});
});