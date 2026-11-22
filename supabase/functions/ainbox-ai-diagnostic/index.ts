import {createClient} from "npm:@supabase/supabase-js@2.57.0";
const headers={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"https://app.90s6.com","access-control-allow-headers":"authorization,apikey,x-client-info,content-type","access-control-allow-methods":"POST,OPTIONS"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const auth=req.headers.get("authorization")||"";
 if(!/^Bearer\s+\S+$/i.test(auth))return reply({error:"Authentication required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),key=Deno.env.get("AINBOX_LLM_API_KEY");
 if(!url||!anon||!key)return reply({error:"AI provider credentials not configured"},503);
 const sb=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:user,error:userError}=await sb.auth.getUser(auth.replace(/^Bearer\s+/i,""));
 if(userError||!user.user)return reply({error:"Invalid session"},401);
 const {data:settings,error:adminError}=await sb.rpc("ainbox_ai_get_settings");
 if(adminError||!settings)return reply({error:"Global administrator required"},403);
 const base=(Deno.env.get("AINBOX_LLM_BASE_URL")||"https://integrate.api.nvidia.com/v1").replace(/\/+$/,"");
 if(base!=="https://integrate.api.nvidia.com/v1")return reply({error:"Diagnostics currently support NVIDIA's standard endpoint only"},422);
 const model=String(settings.model);
 const timeoutMs=Math.min(60000,Math.max(5000,Number(settings.timeout_ms)||20000));
 const controller=new AbortController(),start=performance.now(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 let headersMs:number|null=null,bodyMs:number|null=null;
 try{
  const response=await fetch(base+"/chat/completions",{method:"POST",signal:controller.signal,headers:{"authorization":"Bearer "+key,"content-type":"application/json"},body:JSON.stringify({model,max_tokens:64,temperature:0,messages:[{role:"user",content:"Reply with exactly: OK"}]})});
  headersMs=Math.round(performance.now()-start);
  const raw=await response.text();
  bodyMs=Math.round(performance.now()-start);
  let payload:any={};try{payload=JSON.parse(raw)}catch{}
  const choice=payload?.choices?.[0];
  const content=choice?.message?.content;
  const visible=typeof content==="string"?content.trim().length>0:Array.isArray(content)?content.some((part:any)=>part?.type==="text"&&typeof part.text==="string"&&part.text.trim()):false;
  const result={model,http_status:response.status,headers_ms:headersMs,body_ms:bodyMs,finish_reason:choice?.finish_reason??null,visible_text:!!visible,completion_tokens:payload?.usage?.completion_tokens??null,reasoning_tokens:payload?.usage?.completion_tokens_details?.reasoning_tokens??null,provider_error_code:payload?.error?.code??null,provider_error_type:payload?.error?.type??null};
  console.info("AI_DIAGNOSTIC",JSON.stringify(result));
  return reply(result);
 }catch(e){
  const result={model,http_status:null,headers_ms:headersMs,body_ms:bodyMs,elapsed_ms:Math.round(performance.now()-start),timed_out:controller.signal.aborted,error_type:e instanceof Error?e.name:"Unknown"};
  console.warn("AI_DIAGNOSTIC",JSON.stringify(result));
  return reply(result);
 }finally{clearTimeout(timer)}
});
