create or replace function public.ai_evaluation_quality_trend(p_component text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.day,x.model),'[]'::jsonb) from (
 select date_trunc('day',a.request_at)::date as day,a.model,coalesce(src.component_key,'unknown') as feature,count(*) as rated,round(avg((s.accuracy+s.completeness+s.actionability)::numeric/3),2) as quality
 from public.ainbox_ai_request_audit a join public.ai_model_evaluation_scores s on s.usage_id=a.usage_id
 left join public.ainbox_ai_request_audit src on src.usage_id=a.replay_of
 where a.component_key='evaluation' and (p_component is null or src.component_key=p_component)
 group by 1,2,3 order by 1,2
 ) x);
end $$;
revoke all on function public.ai_evaluation_quality_trend(text) from public,anon;
grant execute on function public.ai_evaluation_quality_trend(text) to authenticated;