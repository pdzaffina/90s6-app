import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { isTransientStatus, MAX_ATTEMPTS, retryAfterSeconds, retryDelay } from './retry.mjs';

import { allowedFeedUrl, normalizeEvidence, parseFeed, watchQuery } from './evidence.mjs';

async function boundedBody(response:Response, maxBytes=1_000_000){
 const reader=response.body?.getReader();
 if(!reader)throw new Error('Provider response was empty');
 const decoder=new TextDecoder();
 let text='', bytes=0;
 try{
  while(true){
   const chunk=await reader.read();
   if(chunk.done)return text+decoder.decode();
   bytes+=chunk.value.byteLength;
   if(bytes>maxBytes)throw new Error('Provider response exceeded the size limit');
   text+=decoder.decode(chunk.value,{stream:true});
  }
 }finally{
  await reader.cancel().catch(()=>{});
 }
}

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
 const config=await db.rpc('sentinel_watch_context',{p_run:job.id,p_started_at:job.started_at});
 if(config.error||!config.data){
  return await save({status:'failed',error:'The watch is no longer available.',finished_at:new Date().toISOString()})
   ?? reply({status:'failed'});
 }
 const context=config.data;
 let query:string;
 try{query=watchQuery(job.name,context);}
 catch{
  return await save({status:'failed',error:'The watch needs a searchable name.',finished_at:new Date().toISOString()})
   ?? reply({status:'failed'});
 }
 const lookback=Number(context.lookback_days)||7;
 let evidence:ReturnType<typeof normalizeEvidence>=[],status='complete',error:string|null=null;
 let failures:unknown[]=[];
 const rss=async(u:URL,provider:string,sourceClass:string)=>{
  const r=await providerFetch(provider,u,{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'});
  return normalizeEvidence(parseFeed(await boundedBody(r),u.href),provider,sourceClass);
 };
 const google=async()=>{
  const u=new URL('https://news.google.com/rss/search');
  for(const [k,v] of Object.entries({q:query+' when:'+lookback+'d',hl:'en-US',gl:'US',ceid:'US:en'}))u.searchParams.set(k,v);
  return rss(u,'google-news-rss','other');
 };
 const gdelt=async()=>{
  const u=new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  for(const [k,v] of Object.entries({query,mode:'artlist',format:'json',maxrecords:'30',timespan:lookback+'d',sort:'datedesc'}))u.searchParams.set(k,v);
  const r=await providerFetch('gdelt',u);
  const data=JSON.parse(await boundedBody(r));
  if(!Array.isArray(data.articles))throw Error('Invalid GDELT response');
  return normalizeEvidence(data.articles.map((a:any)=>({...a,published:a.seendate,source:a.domain})),'gdelt','other');
 };
 let coverage=false;
 try{
  evidence=await gdelt();
  coverage=true;
 }catch(primary){
  failures.push(primary);
  try{
   evidence=await google();
   coverage=true;
  }catch(secondary){
   failures.push(secondary);
  }
 }
 if(context.feed_url){
  try{
   const hosts=new Set((Deno.env.get('SENTINEL_FEED_HOSTS')||'').toLowerCase().split(',').map(host=>host.trim()).filter(Boolean));
   const url=allowedFeedUrl(context.feed_url,hosts);
   if(!url)throw new ProviderError('Preferred feed domain is unavailable. Ask an administrator to approve it.',false);
   const sourceItems=await rss(url,'configured-feed','other');
   const earliest=Date.now()-lookback*86400000;
   const urls=new Set(evidence.map(item=>item.url));
   evidence.push(...sourceItems.filter(item=>!urls.has(item.url)&&(!item.published||Date.parse(item.published)>=earliest)));
   coverage=true;
  }catch(failure){
   failures.push(failure);
  }
 }
 if(failures.length){
  const typed=failures.filter((cause):cause is ProviderError=>cause instanceof ProviderError);
  status=coverage?'partial':'failed';
  error=failures.map(cause=>cause instanceof ProviderError?cause.message:'Provider returned invalid data').join('; ');
  if(!coverage&&typed.some(cause=>cause.transient)&&job.attempt<MAX_ATTEMPTS){
   const next_attempt_at=new Date(Date.now()+1000*retryDelay(job.attempt,Math.max(0,...typed.map(cause=>cause.retryAfter)))).toISOString();
   return await save({status:'queued',next_attempt_at,error}) ?? reply({status:'retry-scheduled'});
  }
 }
 let assessment:string|null=null;
 if(status!=='failed'&&evidence.length){
 const checkpoint=await db.rpc('sentinel_checkpoint_evidence',{
  p_run:job.id,p_started_at:job.started_at,p_evidence:evidence.slice(0,45),p_error:error
 });
 if(checkpoint.error)return await save({evidence,status:'partial',error:'Evidence indexing is unavailable.',finished_at:new Date().toISOString()})
  ?? reply({status:'partial',count:evidence.length});
 if(!checkpoint.data)return reply({status:'lease-lost'},409);
 evidence=checkpoint.data;
 let usage:string|null=null, input=0,output=0,cost=0,billed=false;
 try{
 const apiKey=Deno.env.get('AINBOX_LLM_API_KEY'),base=(Deno.env.get('AINBOX_LLM_BASE_URL')||'https://integrate.api.nvidia.com/v1').replace(/\/+$/,'');
 if(!apiKey||!base.startsWith('https://'))throw Error('AI provider unavailable');
 const reservation=await db.rpc('sentinel_ai_begin',{p_run:job.id,p_evidence:evidence.map((a:any,i)=>({...a,source_number:i+1}))});
 if(reservation.error)throw Error(reservation.error.message);
 const cfg=reservation.data;
 if(cfg){
 usage=cfg.usage_id;
 const response=await fetch(base+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify(cfg.payload),signal:AbortSignal.timeout(Math.min(65000,Math.max(5000,Number(cfg.timeout_ms)||20000)))});
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