begin;
do $$
declare v_name text;
begin
 for v_name in select conname from pg_constraint where conrelid='public.ai_platform_policy'::regclass and contype='c' and pg_get_constraintdef(oid) like '%payload_retention_days%' loop
 execute format('alter table public.ai_platform_policy drop constraint %I',v_name);
 end loop;
end $$;
alter table public.ai_platform_policy add constraint ai_platform_policy_retention_days_check check(payload_retention_days=0 or payload_retention_days between 1 and 3650);
comment on column public.ai_platform_policy.payload_retention_days is '0 means retain raw AI request and response payloads indefinitely; 1-3650 sets retention days.';
create or replace function public.ai_policy_set(p_days integer,p_redact boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 if p_days is null or not (p_days=0 or p_days between 1 and 3650) or p_redact is null then raise exception 'Invalid retention policy'; end if;
 update public.ai_platform_policy set payload_retention_days=p_days,redact_export=p_redact,updated_by=auth.uid(),updated_at=now() where id=1;
 insert into public.ai_audit_access_log(actor_id,action,details) values(auth.uid(),'policy_change',jsonb_build_object('days',p_days,'retain_forever',p_days=0,'redact_export',p_redact));
 return true;
end $$;
create or replace function public.ai_audit_purge_due() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;v_days integer;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select payload_retention_days into v_days from public.ai_platform_policy where id=1;
 if v_days=0 then
  insert into public.ai_audit_access_log(actor_id,action,details) values(auth.uid(),'retention_purge_skipped',jsonb_build_object('reason','retain_forever'));
  return 0;
 end if;
 update public.ainbox_ai_request_audit a set request_payload='{"retained":false}'::jsonb,response_payload=null
 where a.request_at<now()-v_days*interval '1 day'
 and a.request_payload<>'{"retained":false}'::jsonb;
 get diagnostics n=row_count;
 insert into public.ai_audit_access_log(actor_id,action,details) values(auth.uid(),'retention_purge',jsonb_build_object('records',n,'retention_days',v_days));
 return n;
end $$;
revoke all on function public.ai_policy_set(integer,boolean),public.ai_audit_purge_due() from public,anon;
grant execute on function public.ai_policy_set(integer,boolean),public.ai_audit_purge_due() to authenticated;
commit;