begin;
insert into public.ainbox_ai_components(component_key,label,description,enabled) values('evaluation_judge','AI Evaluation Judge','Suggest comparative quality scores for two audited outputs',true) on conflict(component_key) do nothing;
create table if not exists public.ai_evaluation_proposals(
 id uuid primary key default gen_random_uuid(),source_usage_id uuid not null,usage_a uuid not null,usage_b uuid not null,judge_usage_id uuid not null unique,
 proposed jsonb not null,created_by uuid not null,created_at timestamptz not null default now(),agreed_by uuid,agreed_at timestamptz,
 constraint ai_eval_proposal_distinct check(usage_a<>usage_b)
);
alter table public.ai_evaluation_proposals enable row level security;
revoke all on public.ai_evaluation_proposals from public,anon,authenticated;
create or replace function public.ai_evaluation_pair(p_a uuid,p_b uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a record;b record;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select * into a from public.ainbox_ai_request_audit where usage_id=p_a and component_key='evaluation' and http_status between 200 and 299;
 select * into b from public.ainbox_ai_request_audit where usage_id=p_b and component_key='evaluation' and http_status between 200 and 299;
 if a.usage_id is null or b.usage_id is null or a.usage_id=b.usage_id or a.tenant_id<>b.tenant_id or a.replay_of is null or a.replay_of is distinct from b.replay_of then raise exception 'Two successful evaluations of the same source required'; end if;
 return jsonb_build_object('tenant_id',a.tenant_id,'source_usage_id',a.replay_of,'a',jsonb_build_object('usage_id',a.usage_id,'model',a.model,'content',a.response_payload #>> '{choices,0,message,content}'),'b',jsonb_build_object('usage_id',b.usage_id,'model',b.model,'content',b.response_payload #>> '{choices,0,message,content}'));
end $$;
create or replace function public.ai_evaluation_propose(p_a uuid,p_b uuid,p_judge uuid,p_proposal jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_pair jsonb;v_id uuid;v_tenant uuid;
begin
 v_pair:=public.ai_evaluation_pair(p_a,p_b);
 if jsonb_typeof(p_proposal)<>'object' or length(p_proposal::text)>12000 then raise exception 'Invalid proposal'; end if;
 if not ((p_proposal->'a'->>'accuracy')::integer between 1 and 5 and (p_proposal->'a'->>'completeness')::integer between 1 and 5 and (p_proposal->'a'->>'actionability')::integer between 1 and 5 and (p_proposal->'b'->>'accuracy')::integer between 1 and 5 and (p_proposal->'b'->>'completeness')::integer between 1 and 5 and (p_proposal->'b'->>'actionability')::integer between 1 and 5) then raise exception 'Scores must be 1-5'; end if;
 v_tenant:=(v_pair->>'tenant_id')::uuid;
 if not exists(select 1 from public.ainbox_ai_request_audit where usage_id=p_judge and component_key='evaluation_judge' and user_id=auth.uid() and tenant_id=v_tenant and http_status between 200 and 299) then raise exception 'Judge audit required'; end if;
 insert into public.ai_evaluation_proposals(source_usage_id,usage_a,usage_b,judge_usage_id,proposed,created_by)
 values((v_pair->>'source_usage_id')::uuid,p_a,p_b,p_judge,p_proposal,auth.uid()) returning id into v_id;
 return v_id;
end $$;
create or replace function public.ai_evaluation_agree(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare v record;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select * into v from public.ai_evaluation_proposals where id=p_id for update;
 if v.id is null then raise exception 'Proposal not found'; end if;
 if v.agreed_at is not null then return true; end if;
 perform public.ai_evaluation_rate(v.usage_a,(v.proposed->'a'->>'accuracy')::integer,(v.proposed->'a'->>'completeness')::integer,(v.proposed->'a'->>'actionability')::integer,left('Accepted AI suggestion: '||coalesce(v.proposed->'a'->>'reason',''),2000));
 perform public.ai_evaluation_rate(v.usage_b,(v.proposed->'b'->>'accuracy')::integer,(v.proposed->'b'->>'completeness')::integer,(v.proposed->'b'->>'actionability')::integer,left('Accepted AI suggestion: '||coalesce(v.proposed->'b'->>'reason',''),2000));
 update public.ai_evaluation_proposals set agreed_by=auth.uid(),agreed_at=now() where id=p_id;
 return true;
end $$;
create or replace function public.ai_evaluation_proposal_latest(p_a uuid,p_b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select to_jsonb(p) into v from public.ai_evaluation_proposals p where p.usage_a=p_a and p.usage_b=p_b order by created_at desc limit 1;
 return v;
end $$;
revoke all on function public.ai_evaluation_pair(uuid,uuid),public.ai_evaluation_propose(uuid,uuid,uuid,jsonb),public.ai_evaluation_agree(uuid),public.ai_evaluation_proposal_latest(uuid,uuid) from public,anon;
grant execute on function public.ai_evaluation_pair(uuid,uuid),public.ai_evaluation_propose(uuid,uuid,uuid,jsonb),public.ai_evaluation_agree(uuid),public.ai_evaluation_proposal_latest(uuid,uuid) to authenticated;
commit;