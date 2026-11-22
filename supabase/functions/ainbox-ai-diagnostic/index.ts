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

 let input:any={};try{input=await req.json()}catch{}
 const test=String(input.test||"minimal");
 if(!["connectivity","minimal","alternate","stream"].includes(test))return reply({error:"Invalid diagnostic test"},400);
 const selected=String(input.model||"");
 const model=test==="alternate"?selected:String(settings.model);
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{1,179}$/.test(model))return reply({error:"Invalid model identifier"},400);
 const timeoutMs=Math.min(60000,Math.max(5000,Number(settings.timeout_ms)||20000));
 const controller=new AbortController(),start=performance.now(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 let headersMs:number|null=null,bodyMs:number|null=null,firstTokenMs:number|null=null;
 try{
  const streaming=test==="stream";
  const response=await fetch(base+(test==="connectivity"?"/models":"/chat/completions"),{
   method:test==="connectivity"?"GET":"POST",signal:controller.signal,
   headers:{"authorization":"Bearer "+key,"content-type":"application/json",...(streaming?{"accept":"text/event-stream"}:{})},
   ...(test==="connectivity"?{}:{body:JSON.stringify({model,max_tokens:64,messages:[{role:"user",content:"Reply with exactly: OK"}],...(streaming?{stream:true}:{})})})
  });
  headersMs=Math.round(performance.now()-start);
  let raw="",visible=false,finishReason:null|string=null,completionTokens:null|number=null,reasoningTokens:null|number=null,providerErrorType:null|string=null,providerErrorCode:null|string=null,modelCount:null|number=null;
  if(streaming&&response.ok&&response.body){
   const reader=response.body.getReader(),decoder=new TextDecoder();
   let buffer="",events=0;
   while(true){
    const {done,value}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    let boundary;
    while((boundary=buffer.indexOf("\n"))>=0){
     const line=buffer.slice(0,boundary).trim();buffer=buffer.slice(boundary+1);
     if(!line.startsWith("data:"))continue;
     const data=line.slice(5).trim();if(data==="[DONE]")continue;
     events++;
     if(events>1000)throw Error("Stream event limit exceeded");
     try{
      const chunk=JSON.parse(data);
      const delta=chunk?.choices?.[0]?.delta;
      if(firstTokenMs===null&&delta&&Object.keys(delta).length>0)firstTokenMs=Math.round(performance.now()-start);
      if(typeof delta?.content==="string"&&delta.content.length>0)visible=true;
      if(chunk?.choices?.[0]?.finish_reason)finishReason=String(chunk.choices[0].finish_reason);
      if(chunk?.usage?.completion_tokens!=null)completionTokens=Number(chunk.usage.completion_tokens);
     }catch{}
    }
   }
  }else{
   raw=await response.text();
   let payload:any={};try{payload=JSON.parse(raw)}catch{}
   if(test==="connectivity")modelCount=Array.isArray(payload?.data)?payload.data.length:null;
   else{
    const choice=payload?.choices?.[0],content=choice?.message?.content;
    visible=typeof content==="string"?content.trim().length>0:Array.isArray(content)?content.some((part:any)=>part?.type==="text"&&typeof part.text==="string"&&part.text.trim()):false;
    finishReason=choice?.finish_reason??null;
    completionTokens=payload?.usage?.completion_tokens??null;
    reasoningTokens=payload?.usage?.completion_tokens_details?.reasoning_tokens??null;
   }
   providerErrorType=payload?.error?.type??null;providerErrorCode=payload?.error?.code??null;
  }
  bodyMs=Math.round(performance.now()-start);
  const result={test,model,http_status:response.status,headers_ms:headersMs,first_token_ms:firstTokenMs,body_ms:bodyMs,visible_text:visible,finish_reason:finishReason,completion_tokens:completionTokens,reasoning_tokens:reasoningTokens,model_count:modelCount,provider_error_type:providerErrorType,provider_error_code:providerErrorCode};
  console.info("AI_DIAGNOSTIC",JSON.stringify(result));return reply(result);
 }catch(e){
  const result={test,model,http_status:null,headers_ms:headersMs,first_token_ms:firstTokenMs,body_ms:bodyMs,elapsed_ms:Math.round(performance.now()-start),timed_out:controller.signal.aborted,error_type:e instanceof Error?e.name:"Unknown"};
  console.warn("AI_DIAGNOSTIC",JSON.stringify(result));return reply(result);
 }finally{clearTimeout(timer)}

});
