import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { isTransientStatus, MAX_ATTEMPTS, retryAfterSeconds, retryDelay } from './retry.mjs';

import { allowedFeedUrl, describeEvidence, edgarEvidence, evidenceFromDomains, normalizeEvidence, parseFeed, watchQuery } from './evidence.mjs';

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

import { validateReport } from './report.mjs';
import { investigationTerms } from './investigation.mjs';

type Evidence = ReturnType<typeof normalizeEvidence>[number] & {
 source_role?: string;
 story_key?: string;
 new_development?: boolean;
 relevance?: string;
};

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
 const deadline=Date.now()+115000;
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
 let evidence:Evidence[]=[],status='complete',error:string|null=null;
 let failures:unknown[]=[];
 const rss=async(u:URL,provider:string,sourceClass:string)=>{
  const r=await providerFetch(provider,u,{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'});
  try{
   return normalizeEvidence(parseFeed(await boundedBody(r),u.href),provider,sourceClass);
  }catch{throw new ProviderError(provider+' returned an unreadable feed',true);}
 };
 let lastGoogleSearch=0;
 const google=async(search=query)=>{
  lastGoogleSearch=Date.now();
  const u=new URL('https://news.google.com/rss/search');
  for(const [k,v] of Object.entries({q:search+' when:'+lookback+'d',hl:'en-US',gl:'US',ceid:'US:en'}))u.searchParams.set(k,v);
  return rss(u,'google-news-rss','other');
 };
 const gdelt=async(search=query)=>{
  const u=new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  for(const [k,v] of Object.entries({query:search,mode:'artlist',format:'json',maxrecords:'30',timespan:lookback+'d',sort:'datedesc'}))u.searchParams.set(k,v);
  const r=await providerFetch('gdelt',u);
  try{
   const data=JSON.parse(await boundedBody(r));
   if(!Array.isArray(data.articles))throw Error('Invalid GDELT response');
   return normalizeEvidence(data.articles.map((a:any)=>({...a,published:a.seendate,source:a.domain})),'gdelt','other');
  }catch{throw new ProviderError('gdelt returned an unreadable search response',true);}
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
 try{
  const sources=await db.rpc('sentinel_scan_sources',{p_run:job.id,p_started_at:job.started_at});
  if(sources.error)throw Error('Could not load administrator source lists');
  const allDomains:string[]=sources.data??[];
  const current=await db.from('sentinel_scan_runs').select('watch_id,org_id,created_at').eq('id',job.id).single();
  if(current.error)throw Error('Could not load source rotation context');
  const history=await db.from('sentinel_scan_runs').select('id',{count:'exact',head:true}).eq('watch_id',current.data.watch_id).eq('org_id',current.data.org_id).lt('created_at',current.data.created_at);
  if(history.error)throw Error('Could not determine source rotation');
  const batches=Math.ceil(allDomains.length/8);
  const batch=batches?(history.count??0)%batches:0;
  const domains=allDomains.slice(batch*8,batch*8+8);
  if(allDomains.length>domains.length)failures.push(new ProviderError('Source rotation: batch '+(batch+1)+' of '+batches+' ('+domains.length+' of '+allDomains.length+' configured domains selected; others deferred)',false));
  if(domains.length){
   const delay=Math.max(0,2200-(Date.now()-lastGoogleSearch));
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   const scoped=await google(query+' ('+domains.map(domain=>'site:'+domain).join(' OR ')+')');
   const preferred=evidenceFromDomains(scoped,domains);
   const urls=new Set(preferred.map(item=>item.url));
   evidence=[...preferred,...evidence.filter(item=>!urls.has(item.url))];
   coverage=true;
  }
 }catch{
  failures.push(new ProviderError('Administrator source search did not finish',true));
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
 if(context.sec_cik){
  try{
   const userAgent=Deno.env.get('SENTINEL_SEC_USER_AGENT')?.trim();
   if(!userAgent||!/[^\s@]+@[^\s@]+\.[^\s@]+/.test(userAgent)){
    throw new ProviderError('SEC EDGAR contact is not configured.',false);
   }
   const cik=String(context.sec_cik).padStart(10,'0');
   const url=new URL('https://data.sec.gov/submissions/CIK'+cik+'.json');
   const response=await providerFetch('sec-edgar',url,{'User-Agent':userAgent,Accept:'application/json'});
   const data=JSON.parse(await boundedBody(response,2_000_000));
   const earliest=new Date(Date.now()-lookback*86400000).toISOString().slice(0,10);
   evidence.unshift(...edgarEvidence(cik,data,earliest));
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
 const callAI=async <T>(cfg:any, limit:number, read:(raw:string)=>T):Promise<T>=>{
  const usage=cfg.usage_id;
  let input=0,output=0,cost=0,billed=false;
  try{
   const apiKey=Deno.env.get('AINBOX_LLM_API_KEY');
   const base=(Deno.env.get('AINBOX_LLM_BASE_URL')||'https://integrate.api.nvidia.com/v1').replace(/\/+$/,'');
   if(!apiKey||!base.startsWith('https://'))throw Error('AI provider unavailable');
   const remaining=deadline-Date.now();
   if(remaining<1000)throw Error('Execution deadline reached');
   const response=await fetch(base+'/chat/completions',{
    method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
    body:JSON.stringify(cfg.payload),redirect:'error',
    signal:AbortSignal.timeout(Math.min(remaining,limit,Math.max(5000,Number(cfg.timeout_ms)||20000)))
   });
   const data=await response.json();
   input=Number(data?.usage?.prompt_tokens)||0;
   output=Number(data?.usage?.completion_tokens)||0;
   cost=(input*Number(cfg.input_rate)+output*Number(cfg.output_rate))/1000000;
   billed=response.ok;
   const audit=await db.from('ainbox_ai_request_audit').update({
    response_payload:data,response_at:new Date().toISOString(),http_status:response.status,
    provider_request_id:response.headers.get('x-request-id'),input_tokens:input,
    output_tokens:output,estimated_usd:cost,error_message:response.ok?null:'Provider HTTP '+response.status
   }).eq('usage_id',usage);
   if(audit.error)throw Error('AI response audit failed');
   if(!response.ok)throw Error('AI provider HTTP '+response.status);
   const raw=data?.choices?.[0]?.message?.content;
   if(typeof raw!=='string'||!raw.trim()){
    if(data?.choices?.[0]?.finish_reason==='length') {
     throw Error('The selected model used its token limit before writing the report.');
    }
    throw Error('The selected model returned no report.');
   }
   return read(raw);
  }catch(cause){
   await db.from('ainbox_ai_request_audit').update({
    error_message:cause instanceof Error?cause.message:'AI request failed',response_at:new Date().toISOString()
   }).eq('usage_id',usage);
   throw cause;
  }finally{
   const finish=await db.from('ainbox_ai_usage').update({
    status:billed?'completed':'failed',reserved_usd:0,input_tokens:input,
    output_tokens:output,estimated_usd:cost
   }).eq('id',usage).eq('status','reserved');
   if(finish.error)throw Error('AI usage finalization failed');
  }
 };
 const checkpoint=async ()=>{
  const saved=await db.rpc('sentinel_checkpoint_evidence',{
   p_run:job.id,p_started_at:job.started_at,p_evidence:describeEvidence(evidence.slice(0,45),job.name,context),p_error:error
  });
  if(saved.error)return await save({evidence,status:'partial',error:'Evidence indexing is unavailable.',finished_at:new Date().toISOString()})
   ?? reply({status:'partial',count:evidence.length});
  if(!saved.data)return reply({status:'lease-lost'},409);
  evidence=saved.data;
  return null;
 };
 const note=(message:string)=>{
  status='partial';
  error=[error,message].filter(Boolean).join(' · ');
 };
 let assessment:string|null=null;
 if(status!=='failed'&&evidence.length){
  const saved=await checkpoint();
  if(saved)return saved;
  if(context.mode==='deep'){
   const stage=await save({stage:'investigating'});
   if(stage)return stage;
   const seen=new Set<string>();
   const collected=new Set(evidence.map(item=>item.url));
   const priorTopics:string[]=[];
   try{
    const rounds=Math.min(2,Number(context.rounds)||1);
    const maxSearches=Math.min(3,Number(context.searches)||1);
    for(let round=0;round<rounds&&priorTopics.length<maxSearches;round++){
     if(deadline-Date.now()<55000)break;
     const reservation=await db.rpc('sentinel_investigation_begin',{
      p_run:job.id,p_started_at:job.started_at,
      p_component:round===0?'sentinel_investigation_plan':'sentinel_investigation_followup',
      p_evidence:evidence.slice(0,20),p_topics:priorTopics
     });
     if(reservation.error)throw Error('Investigation settings or budget unavailable');
     if(!reservation.data)break;
     const topics=await callAI(reservation.data,18000,raw=>
      investigationTerms(raw,seen,Number(context.relevance),maxSearches-priorTopics.length));
     if(!topics.length)break;
     for(const topic of topics){
      if(deadline-Date.now()<35000||evidence.length>=45)break;
      priorTopics.push(topic);
      const search=query+' "'+topic+'"';
      try{
       const related=await google(search);
       for(const item of related){
        if(collected.has(item.url))continue;
        collected.add(item.url);
        evidence.push(item);
        if(evidence.length>=45)break;
       }
      }catch{note('A follow-up search could not complete.');}
     }
    }
   }catch{note('Deep investigation could not finish. The assessment uses available evidence.');}
   const updated=await checkpoint();
   if(updated)return updated;
  }
  const stage=await save({stage:'assessment'});
  if(stage)return stage;
  try{
   const sources=evidence.slice(0,24);
   const reservation=await db.rpc('sentinel_ai_begin',{
    p_run:job.id,p_evidence:sources.map((item,index)=>({
     source_number:index+1,title:item.title,source:item.source,published:item.published,
     source_role:item.source_role,story_key:item.story_key,
     new_development:item.new_development,relevance:item.relevance,
    }))
   });
   if(reservation.error)throw Error('Assessment settings or budget unavailable');
   if(reservation.data){
    assessment=await callAI(reservation.data,55000,raw=>{
     try{return JSON.stringify(validateReport(raw,sources));}
     catch{throw Error('AI output did not meet the report and citation requirements');}
    });
   }
  }catch(cause){note('Assessment unavailable: '+(cause instanceof Error?cause.message:'AI request failed'));}
 }
 return await save({status,error,evidence,assessment,stage:null,finished_at:new Date().toISOString()})
  ?? reply({status,count:evidence.length});
});