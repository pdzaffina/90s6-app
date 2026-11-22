import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const headers={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"https://app.90s6.com","access-control-allow-headers":"authorization,apikey,x-client-info,content-type","access-control-allow-methods":"POST,OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const auth=req.headers.get("authorization")||"";
 if(!/^Bearer\s+\S+$/i.test(auth))return reply({error:"Authentication required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!anon)return reply({error:"Supabase configuration missing"},503);
 const sb=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:identity,error:identityError}=await sb.auth.getUser(auth.replace(/^Bearer\s+/i,""));
 if(identityError||!identity.user)return reply({error:"Invalid session"},401);
 const {error:adminError}=await sb.rpc("ainbox_ai_get_settings");
 if(adminError)return reply({error:"Global administrator required"},403);
 const key=Deno.env.get("AINBOX_LLM_API_KEY");
 const base=(Deno.env.get("AINBOX_LLM_BASE_URL")||"https://integrate.api.nvidia.com/v1").replace(/\/+$/,"");
 if(!key)return reply({error:"NVIDIA API key is not configured"},503);
 // Only the trusted NVIDIA endpoint is supported for discovery. Avoid arbitrary URL SSRF.
 if(base!=="https://integrate.api.nvidia.com/v1")return reply({error:"Provider model discovery is only enabled for NVIDIA Build's standard endpoint"},422);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch(base+"/models",{headers:{Authorization:"Bearer "+key,Accept:"application/json"},signal:controller.signal});
  if(!response.ok)return reply({error:"Provider model discovery returned HTTP "+response.status},502);
  const payload=await response.json();
  if(!Array.isArray(payload?.data))return reply({error:"Provider did not return an OpenAI-compatible model list"},502);
  const models=payload.data.filter((x:any)=>typeof x?.id==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{1,179}$/.test(x.id)).map((x:any)=>({id:x.id,label:typeof x.name==="string"?x.name.slice(0,120):x.id})).sort((a:any,b:any)=>a.id.localeCompare(b.id));
  return reply({models,source:"provider"});
 }catch{return reply({error:"Could not reach NVIDIA model discovery endpoint"},502)}
 finally{clearTimeout(timer)}
});
