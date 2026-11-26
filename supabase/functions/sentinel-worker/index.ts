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
 const seen=new Set<string>();
 const decode=(s:string)=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(m,k)=>{const n=k[0]==='#'?(k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):parseInt(k.slice(1),10)):0;return k[0]==='#'?(n>0&&n<=0x10ffff?String.fromCodePoint(n):m):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[k]||m});
 const field=(s:string,k:string)=>decode(s.match(new RegExp('<'+k+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+k+'>','i'))?.[1]||'').trim();
 const normalize=(articles:any[],provider:string)=>articles.slice(0,30).flatMap(a=>{try{const u=new URL(a.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return [];u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_'))u.searchParams.delete(k);if(seen.has(u.href))return [];seen.add(u.href);return [{url:u.href,title:String(a.title||'').slice(0,300),description:'',published:a.published||null,source:String(a.source||u.hostname).slice(0,200),provider}]}catch{return []}});
 const rss=async()=>{const u=new URL('https://news.google.com/rss/search');for(const [k,v] of Object.entries({q:'"'+name+'" when:7d',hl:'en-US',gl:'US',ceid:'US:en'}))u.searchParams.set(k,v);
 const r=await fetch(u,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/rss+xml, application/xml, text/xml'}});if(!r.ok)throw Error('Google News RSS HTTP '+r.status);
 const xml=await r.text();if(!/<rss[\s>]/i.test(xml)||!/<channel[\s>]/i.test(xml))throw Error('Invalid Google News RSS response');
 return normalize([...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>{const s=m[1],d=new Date(field(s,'pubDate'));return {url:field(s,'link'),title:field(s,'title'),source:field(s,'source'),published:Number.isNaN(d.getTime())?null:d.toISOString()}}),'google-news-rss');};
 const gdelt=async()=>{const u=new URL('https://api.gdeltproject.org/api/v2/doc/doc');for(const [k,v] of Object.entries({query:'"'+name+'"',mode:'artlist',format:'json',maxrecords:'30',timespan:'7d',sort:'datedesc'}))u.searchParams.set(k,v);
 const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('GDELT HTTP '+r.status);const data=await r.json();if(!Array.isArray(data.articles))throw Error('Invalid GDELT response');return normalize(data.articles.map((a:any)=>({...a,published:a.seendate})),'gdelt');};
 try{evidence=await rss();}catch(primary){try{evidence=await gdelt();}catch(secondary){throw Error(String(primary)+'; fallback: '+String(secondary));}}

 }catch(e){status='failed';error=e instanceof Error?e.message:'Search failed'}
 const saved=await db.from('sentinel_scan_runs').update({status,error,evidence,finished_at:new Date().toISOString()}).eq('id',job.id).eq('status','running');
 if(saved.error)return reply({error:'Save failed'},500);
 return reply({status,count:evidence.length});
});