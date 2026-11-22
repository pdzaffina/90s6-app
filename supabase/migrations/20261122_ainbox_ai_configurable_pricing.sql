alter table public.ainbox_ai_settings add column if not exists input_usd_per_million numeric(12,6) not null default 1, add column if not exists output_usd_per_million numeric(12,6) not null default 4;
create or replace function public.ainbox_ai_set_rates(p_input numeric,p_output numeric) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then raise exception 'Global admin required' using errcode='42501'; end if;
 if p_input is null or p_output is null or p_input<0 or p_output<0 or p_input>1000 or p_output>1000 then raise exception 'Invalid rates'; end if;
 update public.ainbox_ai_settings set input_usd_per_million=p_input,output_usd_per_million=p_output where id=1;
 return jsonb_build_object('input',p_input,'output',p_output);
end $$;
revoke all on function public.ainbox_ai_set_rates(numeric,numeric) from public,anon;
grant execute on function public.ainbox_ai_set_rates(numeric,numeric) to authenticated;
create or replace function public.ainbox_ai_pricing() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('input',input_usd_per_million,'output',output_usd_per_million,'budget',monthly_budget_usd) from public.ainbox_ai_settings where id=1
$$;
revoke all on function public.ainbox_ai_pricing() from public,anon;
grant execute on function public.ainbox_ai_pricing() to authenticated;