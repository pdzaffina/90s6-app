import {createClient} from 'npm:@supabase/supabase-js@2.57.0';
import {unzipSync} from 'npm:fflate@0.8.2';
Deno.serve(async req=>{
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 if(req.method!=='POST')return new Response('Unauthorized',{status:401});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false}});
 const token=(await req.json().catch(()=>({}))).token;
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return new Response('Unauthorized',{status:401});
 const auth=await db.rpc('sentinel_consume_token',{p_token:token});if(auth.error||auth.data!==true)return new Response('Unauthorized',{status:401});
 const claim=await db.rpc('sentinel_gdelt_claim');
 if(claim.error)return Response.json({error:claim.error.message},{status:500});
 const slot=claim.data;if(!slot)return Response.json({status:'idle'});
 let records=0;
 try{
  const stamp=new Date(slot).toISOString().replace(/[-:T]/g,'').slice(0,14);
  const response=await fetch('https://data.gdeltproject.org/gdeltv2/'+stamp+'.gkg.csv.zip',{signal:AbortSignal.timeout(25000),redirect:'error'});
  if(!response.ok)throw Error('GDELT HTTP '+response.status);
  const reader=response.body!.getReader();let size=0;const chunks=[];
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>20_000_000)throw Error('Archive exceeds limit');chunks.push(r.value)}}finally{await reader.cancel().catch(()=>{})}
  const zip=new Uint8Array(size);let offset=0;for(const c of chunks){zip.set(c,offset);offset+=c.length}
  const files=unzipSync(zip,{filter:f=>f.name===stamp+'.gkg.csv'&&f.originalSize<=100_000_000});
  const raw=Object.values(files)[0];if(!raw)throw Error('Missing or oversized GKG member');
  const lines=new TextDecoder().decode(raw).split('\n');let batch=[];
  for(const line of lines){
   const c=line.split('\t');if(c.length<15||!c[0]||!/^https?:\/\//i.test(c[4]))continue;
   batch.push({id:c[0],observed:slot,url:c[4].slice(0,4096),source:c[3].slice(0,255),organizations:(c[13]||'').slice(0,4000),themes:(c[7]||'').slice(0,4000)});
   if(batch.length>=200){const r=await db.rpc('sentinel_gdelt_store',{p_rows:batch});if(r.error)throw Error(r.error.message);records+=batch.length;batch=[]}
  }
  if(batch.length){const r=await db.rpc('sentinel_gdelt_store',{p_rows:batch});if(r.error)throw Error(r.error.message);records+=batch.length}
  if(!records)throw Error('No usable GKG records');
  const done=await db.rpc('sentinel_gdelt_finish',{p_slot:slot,p_records:records});if(done.error)throw Error(done.error.message);
  return Response.json({slot,records});
 }catch(e){await db.rpc('sentinel_gdelt_finish',{p_slot:slot,p_records:records,p_error:String(e).slice(0,500)});return Response.json({slot,error:String(e)},{status:502})}
});