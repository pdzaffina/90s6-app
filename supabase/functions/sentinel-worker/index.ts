import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
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
 let evidence:unknown[]=[],status='complete',error=null;
 try{
 const name=String(job.name).replace(/[^\p{L}\p{N}\s.-]/gu,' ').trim().slice(0,200);
 if(!name)throw Error('Empty query');
 const u=new URL('https://api.gdeltproject.org/api/v2/doc/doc');
 for(const [k,v] of Object.entries({query:'"'+name+'"',mode:'artlist',format:'json',maxrecords:'30',timespan:'7d',sort:'datedesc'}))u.searchParams.set(k,v);
 const r=await fetch(u,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('GDELT HTTP '+r.status);
 const data=await r.json();if(!Array.isArray(data.articles))throw Error('Invalid GDELT response');
 const seen=new Set<string>();
 evidence=data.articles.slice(0,30).flatMap((a:any)=>{try{const u=new URL(a.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return [];u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_'))u.searchParams.delete(k);if(seen.has(u.href))return [];seen.add(u.href);return [{url:u.href,title:String(a.title||'').slice(0,300),description:'',published:a.seendate||null,source:u.hostname,provider:'gdelt'}]}catch{return []}});
 }catch(e){status='failed';error=e instanceof Error?e.message:'Search failed'}
 const saved=await db.from('sentinel_scan_runs').update({status,error,evidence,finished_at:new Date().toISOString()}).eq('id',job.id).eq('status','running');
 if(saved.error)return reply({error:'Save failed'},500);
 return reply({status,count:evidence.length});
});