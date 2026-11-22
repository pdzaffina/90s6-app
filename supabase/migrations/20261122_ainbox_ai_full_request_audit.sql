create table if not exists public.ainbox_ai_request_audit(
 usage_id uuid primary key references public.ainbox_ai_usage(id) on delete restrict,
 tenant_id uuid not null,user_id uuid not null,component_key text not null,model text not null,
 request_payload jsonb not null, response_payload jsonb,
 request_at timestamptz not null default now(),response_at timestamptz,
 http_status integer,provider_request_id text,error_message text,
 input_tokens integer,output_tokens integer,total_tokens integer,estimated_usd numeric(12,6)
);
alter table public.ainbox_ai_request_audit enable row level security;
revoke all on public.ainbox_ai_request_audit from public,anon,authenticated;
create or replace function public.ainbox_ai_audit_request(p_usage uuid,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or pg_column_size(p_payload)>131072 then raise exception 'Invalid audit request'; end if;
 insert into public.ainbox_ai_request_audit(usage_id,tenant_id,user_id,component_key,model,request_payload)
 select id,tenant_id,user_id,component_key,model,p_payload from public.ainbox_ai_usage
 where id=p_usage and user_id=auth.uid() and status='reserved';
 if not found then raise exception 'Invalid usage reservation'; end if;
 return true;
end $$;
create or replace function public.ainbox_ai_audit_response(p_usage uuid,p_payload jsonb,p_http integer,p_provider_id text,p_error text,p_input integer,p_output integer,p_cost numeric)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or (p_payload is not null and pg_column_size(p_payload)>524288) then raise exception 'Invalid audit response'; end if;
 update public.ainbox_ai_request_audit set response_payload=p_payload,response_at=now(),http_status=p_http,
 provider_request_id=left(p_provider_id,200),error_message=left(p_error,1000),
 input_tokens=p_input,output_tokens=p_output,total_tokens=coalesce(p_input,0)+coalesce(p_output,0),estimated_usd=p_cost
 where usage_id=p_usage and user_id=auth.uid() and response_at is null;
 if not found then raise exception 'Missing audit request'; end if;
 return true;
end $$;
create or replace function public.ainbox_ai_audit_list(p_limit integer default 100)
returns table(usage_id uuid,tenant_id uuid,user_id uuid,component_key text,model text,request_at timestamptz,response_at timestamptz,http_status integer,input_tokens integer,output_tokens integer,total_tokens integer,estimated_usd numeric,error_message text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then raise exception 'Global admin required' using errcode='42501'; end if;
 return query select a.usage_id,a.tenant_id,a.user_id,a.component_key,a.model,a.request_at,a.response_at,a.http_status,a.input_tokens,a.output_tokens,a.total_tokens,a.estimated_usd,a.error_message from public.ainbox_ai_request_audit a order by a.request_at desc limit least(greatest(coalesce(p_limit,100),1),250);
end $$;
create or replace function public.ainbox_ai_audit_detail(p_usage uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then raise exception 'Global admin required' using errcode='42501'; end if;
 select to_jsonb(a) into v from public.ainbox_ai_request_audit a where a.usage_id=p_usage;
 return v;
end $$;
revoke all on function public.ainbox_ai_audit_request(uuid,jsonb),public.ainbox_ai_audit_response(uuid,jsonb,integer,text,text,integer,integer,numeric),public.ainbox_ai_audit_list(integer),public.ainbox_ai_audit_detail(uuid) from public,anon;
grant execute on function public.ainbox_ai_audit_request(uuid,jsonb),public.ainbox_ai_audit_response(uuid,jsonb,integer,text,text,integer,integer,numeric),public.ainbox_ai_audit_list(integer),public.ainbox_ai_audit_detail(uuid) to authenticated;
create index if not exists ainbox_ai_request_audit_time_idx on public.ainbox_ai_request_audit(request_at desc);