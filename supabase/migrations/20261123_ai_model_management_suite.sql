create table if not exists public.ai_model_config_history(id bigint generated always as identity primary key,component_key text not null,old_settings jsonb not null,new_settings jsonb not null,changed_by uuid,changed_at timestamptz not null default now(),restored_from bigint);
alter table public.ai_model_config_history enable row level security;
revoke all on public.ai_model_config_history from public,anon,authenticated;
create or replace function public.ai_model_config_capture() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(old.model_override,old.timeout_override_ms,old.tokens_override_ms) is distinct from row(new.model_override,new.timeout_override_ms,new.tokens_override_ms) then
 insert into public.ai_model_config_history(component_key,old_settings,new_settings,changed_by) values(new.component_key,jsonb_build_object('model',old.model_override,'timeout_ms',old.timeout_override_ms,'tokens',old.tokens_override_ms),jsonb_build_object('model',new.model_override,'timeout_ms',new.timeout_override_ms,'tokens',new.tokens_override_ms),auth.uid());
 end if;
 return new;
end $$;
drop trigger if exists ai_model_config_capture on public.ainbox_ai_components;
create trigger ai_model_config_capture after update on public.ainbox_ai_components for each row execute function public.ai_model_config_capture();
create or replace function public.ai_model_config_list(p_component text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(h) order by h.changed_at desc),'[]'::jsonb) from (select id,component_key,old_settings,new_settings,changed_by,changed_at from public.ai_model_config_history where p_component is null or component_key=p_component order by id desc limit 100) h);
end $$;
create or replace function public.ai_model_config_restore(p_id bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare h record;
begin
 if not public.ai_platform_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select * into h from public.ai_model_config_history where id=p_id;
 if not found then raise exception 'History record missing'; end if;
 update public.ainbox_ai_components set model_override=h.old_settings->>'model',timeout_override_ms=(h.old_settings->>'timeout_ms')::integer,tokens_override=(h.old_settings->>'tokens')::integer,updated_by=auth.uid(),updated_at=now() where component_key=h.component_key;
 return true;
end $$;
create or replace function public.ai_evaluation_sessions(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
 select a.replay_of as source_usage_id,a.usage_id as usage_a,b.usage_id as usage_b,a.model as model_a,b.model as model_b,a.request_at as created_at,a.tenant_id,
 p.id as proposal_id,p.proposed,p.agreed_at,
 sa.accuracy as accuracy_a,sa.completeness as completeness_a,sa.actionability as actionability_a,
 sb.accuracy as accuracy_b,sb.completeness as completeness_b,sb.actionability as actionability_b
 from public.ainbox_ai_request_audit a
 join lateral (select z.* from public.ainbox_ai_request_audit z where z.component_key='evaluation' and z.replay_of=a.replay_of and z.tenant_id=a.tenant_id and z.usage_id<>a.usage_id and z.request_at>=a.request_at and z.request_at<=a.request_at+interval '10 minutes' order by z.request_at limit 1) b on true
 left join lateral (select q.* from public.ai_evaluation_proposals q where q.usage_a=a.usage_id and q.usage_b=b.usage_id order by q.created_at desc limit 1) p on true
 left join public.ai_model_evaluation_scores sa on sa.usage_id=a.usage_id
 left join public.ai_model_evaluation_scores sb on sb.usage_id=b.usage_id
 where a.component_key='evaluation' and a.http_status between 200 and 299 and b.http_status between 200 and 299 and a.replay_of is not null
 order by a.request_at desc limit least(greatest(p_limit,1),100)
 ) x);
end $$;
create or replace function public.ai_evaluation_leaderboard(p_component text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.quality desc nulls last,x.rated desc),'[]'::jsonb) from (
 select a.model,coalesce(src.component_key,'unknown') as feature,count(*) filter(where s.usage_id is not null) as rated,
 round(avg((s.accuracy+s.completeness+s.actionability)::numeric/3),2) as quality,
 round(avg(a.estimated_usd),5) as average_cost,
 round(avg(extract(epoch from (a.response_at-a.request_at))*1000)) as average_ms
 from public.ainbox_ai_request_audit a
 join public.ai_model_evaluation_scores s on s.usage_id=a.usage_id
 left join public.ainbox_ai_request_audit src on src.usage_id=a.replay_of
 where a.component_key='evaluation' and (p_component is null or src.component_key=p_component)
 group by a.model,src.component_key
 ) x);
end $$;
create or replace function public.ai_model_reliability(p_days integer default 30) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.requests desc),'[]'::jsonb) from (
 select model,component_key,count(*) as requests,count(*) filter(where http_status between 200 and 299 and coalesce(response_payload#>>'{choices,0,message,content}','')<>'') as successful,
 count(*) filter(where http_status not between 200 and 299 or http_status is null) as errors,
 count(*) filter(where error_message ilike '%timeout%') as timeouts,
 count(*) filter(where http_status between 200 and 299 and coalesce(response_payload#>>'{choices,0,message,content}','')='') as empty_responses,
 round(avg(extract(epoch from(response_at-request_at))*1000)) as mean_ms
 from public.ainbox_ai_request_audit where request_at>=now()-least(greatest(p_days,1),365)*interval '1 day' group by model,component_key
 ) x);
end $$;
create or replace function public.ai_model_recommendations(p_min_ratings integer default 3) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.feature,x.quality desc),'[]'::jsonb) from (
 select src.component_key as feature,a.model,count(*) as ratings,round(avg((s.accuracy+s.completeness+s.actionability)::numeric/3),2) as quality,round(avg(a.estimated_usd),5) as avg_cost,
 count(*) filter(where p.agreed_at is not null) as accepted_ai_suggestions
 from public.ainbox_ai_request_audit a join public.ai_model_evaluation_scores s on s.usage_id=a.usage_id
 join public.ainbox_ai_request_audit src on src.usage_id=a.replay_of
 left join public.ai_evaluation_proposals p on p.agreed_at is not null and (p.usage_a=a.usage_id or p.usage_b=a.usage_id)
 where a.component_key='evaluation' group by src.component_key,a.model having count(*)>=greatest(p_min_ratings,3)
 ) x);
end $$;
revoke all on function public.ai_model_config_list(text),public.ai_model_config_restore(bigint),public.ai_evaluation_sessions(integer),public.ai_evaluation_leaderboard(text),public.ai_model_reliability(integer),public.ai_model_recommendations(integer) from public,anon;
grant execute on function public.ai_model_config_list(text),public.ai_model_config_restore(bigint),public.ai_evaluation_sessions(integer),public.ai_evaluation_leaderboard(text),public.ai_model_reliability(integer),public.ai_model_recommendations(integer) to authenticated;