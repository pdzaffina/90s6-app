create table if not exists public.ai_model_evaluation_scores(
 usage_id uuid primary key references public.ainbox_ai_request_audit(usage_id) on delete restrict,
 evaluator_id uuid not null,accuracy smallint not null check(accuracy between 1 and 5),
 completeness smallint not null check(completeness between 1 and 5),
 actionability smallint not null check(actionability between 1 and 5),
 notes text not null default '',rated_at timestamptz not null default now()
);
alter table public.ai_model_evaluation_scores enable row level security;
revoke all on public.ai_model_evaluation_scores from public,anon,authenticated;
create or replace function public.ai_evaluation_rate(p_usage uuid,p_accuracy integer,p_completeness integer,p_actionability integer,p_notes text default '')
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 if p_accuracy not between 1 and 5 or p_completeness not between 1 and 5 or p_actionability not between 1 and 5 or length(p_notes)>2000 then raise exception 'Invalid evaluation'; end if;
 if not exists(select 1 from public.ainbox_ai_request_audit where usage_id=p_usage and component_key='evaluation') then raise exception 'Not an evaluation request'; end if;
 insert into public.ai_model_evaluation_scores(usage_id,evaluator_id,accuracy,completeness,actionability,notes)
 values(p_usage,auth.uid(),p_accuracy,p_completeness,p_actionability,p_notes)
 on conflict(usage_id) do update set evaluator_id=excluded.evaluator_id,accuracy=excluded.accuracy,completeness=excluded.completeness,actionability=excluded.actionability,notes=excluded.notes,rated_at=now();
 return true;
end $$;
create or replace function public.ai_evaluation_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) into v from
 (select a.model,count(*) as rated,round(avg((s.accuracy+s.completeness+s.actionability)/3.0),2) as mean_quality,
 round(avg(a.estimated_usd),6) as mean_cost_usd,round(avg(extract(epoch from(a.response_at-a.request_at))*1000)) as mean_latency_ms
 from public.ai_model_evaluation_scores s join public.ainbox_ai_request_audit a on a.usage_id=s.usage_id
 group by a.model order by mean_quality desc) z;
 return v;
end $$;
revoke all on function public.ai_evaluation_rate(uuid,integer,integer,integer,text),public.ai_evaluation_summary() from public,anon;
grant execute on function public.ai_evaluation_rate(uuid,integer,integer,integer,text),public.ai_evaluation_summary() to authenticated;