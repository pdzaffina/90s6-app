begin;
alter table public.ainbox_ai_settings add column if not exists monthly_budget_usd numeric(12,4) not null default 25 check(monthly_budget_usd>=0);
create table if not exists public.ainbox_ai_usage(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,tenant_id uuid not null,
 component_key text not null,model text not null,created_at timestamptz not null default now(),
 status text not null default 'reserved' check(status in ('reserved','completed','failed')),
 reserved_usd numeric(12,6) not null default 0,estimated_usd numeric(12,6) not null default 0,
 input_tokens integer,output_tokens integer,
 constraint usage_tokens_nonnegative check(coalesce(input_tokens,0)>=0 and coalesce(output_tokens,0)>=0)
);
create index if not exists ainbox_ai_usage_month on public.ainbox_ai_usage(created_at,status);
alter table public.ainbox_ai_usage enable row level security;
revoke all on public.ainbox_ai_usage from public,anon,authenticated;
create or replace function public.ainbox_ai_set_budget(p_usd numeric)
returns numeric language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then raise exception 'Global admin required' using errcode='42501'; end if;
 if p_usd is null or p_usd<0 or p_usd>100000 then raise exception 'Invalid budget'; end if;
 update public.ainbox_ai_settings set monthly_budget_usd=p_usd,updated_at=now(),updated_by=auth.uid() where id=1;
 return p_usd;
end $$;
create or replace function public.ainbox_ai_usage_summary()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then raise exception 'Global admin required' using errcode='42501'; end if;
 select jsonb_build_object('budget',s.monthly_budget_usd,'spent',coalesce((select sum(estimated_usd) from public.ainbox_ai_usage where created_at>=date_trunc('month',now()) and status='completed'),0),
 'reserved',coalesce((select sum(reserved_usd) from public.ainbox_ai_usage where created_at>=date_trunc('month',now()) and status='reserved'),0),
 'requests',(select count(*) from public.ainbox_ai_usage where created_at>=date_trunc('month',now())),
 'input_tokens',coalesce((select sum(input_tokens) from public.ainbox_ai_usage where created_at>=date_trunc('month',now())),0),
 'output_tokens',coalesce((select sum(output_tokens) from public.ainbox_ai_usage where created_at>=date_trunc('month',now())),0),
 'components',coalesce((select jsonb_agg(z) from (select component_key,count(*) requests,sum(estimated_usd) cost from public.ainbox_ai_usage where created_at>=date_trunc('month',now()) group by component_key order by component_key) z),'[]'::jsonb))
 into v from public.ainbox_ai_settings s where id=1;
 return v;
end $$;
create or replace function public.ainbox_ai_reserve(p_tenant uuid,p_component text,p_model text,p_estimate numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_budget numeric;v_used numeric;
begin
 if auth.uid() is null or not public.ainbox_authorized(p_tenant,false) then raise exception 'Access denied' using errcode='42501'; end if;
 if not public.ainbox_ai_component_enabled(p_component) then raise exception 'AI component disabled' using errcode='42501'; end if;
 if p_estimate is null or p_estimate<=0 or p_estimate>10 then raise exception 'Invalid reservation'; end if;
 perform pg_advisory_xact_lock(90261122,1);
 select monthly_budget_usd into v_budget from public.ainbox_ai_settings where id=1;
 select coalesce(sum(case when status='reserved' then reserved_usd when status='completed' then estimated_usd else 0 end),0) into v_used from public.ainbox_ai_usage where created_at>=date_trunc('month',now());
 if v_used+p_estimate>v_budget then raise exception 'Monthly AI budget exhausted' using errcode='P0001'; end if;
 insert into public.ainbox_ai_usage(user_id,tenant_id,component_key,model,reserved_usd) values(auth.uid(),p_tenant,p_component,left(p_model,160),p_estimate) returning id into v_id;
 return v_id;
end $$;
create or replace function public.ainbox_ai_finish(p_id uuid,p_input integer,p_output integer,p_cost numeric,p_success boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.ainbox_ai_usage set status=case when p_success then 'completed' else 'failed' end,reserved_usd=0,input_tokens=greatest(0,p_input),output_tokens=greatest(0,p_output),estimated_usd=case when p_success then greatest(0,least(10,p_cost)) else 0 end where id=p_id and user_id=auth.uid() and status='reserved';
end $$;
revoke all on function public.ainbox_ai_set_budget(numeric),public.ainbox_ai_usage_summary(),public.ainbox_ai_reserve(uuid,text,text,numeric),public.ainbox_ai_finish(uuid,integer,integer,numeric,boolean) from public,anon;
grant execute on function public.ainbox_ai_set_budget(numeric),public.ainbox_ai_usage_summary(),public.ainbox_ai_reserve(uuid,text,text,numeric),public.ainbox_ai_finish(uuid,integer,integer,numeric,boolean) to authenticated;
commit;