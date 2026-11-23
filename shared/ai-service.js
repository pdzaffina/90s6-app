/* Shared AI gateway client for 90s6 apps. Uses the existing authenticated Supabase session. */
(function(global){
 'use strict';
 const components=Object.freeze({portfolio:'platform_portfolio',workboard:'platform_workboard',knowledge:'platform_knowledge',content:'platform_content'});
 async function request({supabase,tenantId,app,content}){
  if(!supabase?.functions?.invoke)throw new Error('An authenticated Supabase client is required');
  const component=components[app]||app;
  if(!Object.values(components).includes(component))throw new Error('Unsupported AI app component');
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(tenantId||'')))throw new Error('Organization ID required');
  if(typeof content!=='string'||!content.trim()||content.length>20000)throw new Error('Content must be 1 to 20,000 characters');
  const {data,error}=await supabase.functions.invoke('ai-platform-gateway',{body:{tenant_id:tenantId,component,content}});
  if(error){let message=error.message;try{const details=await error.context?.json();message=details?.error||message}catch{}throw new Error(message)}
  if(data?.error)throw new Error(data.error);
  return {text:data.content||'',model:data.model,usageId:data.usage_id,inputTokens:data.input_tokens,outputTokens:data.output_tokens,estimatedUsd:data.estimated_usd};
 }
 global.NinetysixAI=Object.freeze({request,components});
})(window);
