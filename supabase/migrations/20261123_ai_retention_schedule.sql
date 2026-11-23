create extension if not exists pg_cron with schema pg_catalog;
create or replace function public.ai_audit_retention_job() returns integer language plpgsql security definer set search_path='' as $$
declare n integer:=0;v_days integer;
begin
 select payload_retention_days into v_days from public.ai_platform_policy where id=1;
 if v_days is null or v_days=0 then return 0; end if;
 update public.ainbox_ai_request_audit set request_payload='{"retained":false}'::jsonb,response_payload=null
 where request_at<now()-v_days*interval '1 day'
 and (request_payload is distinct from '{"retained":false}'::jsonb or response_payload is not null);
 get diagnostics n=row_count;
 insert into public.ai_audit_access_log(actor_id,action,details) values(null,'scheduled_retention_purge',jsonb_build_object('records',n,'retention_days',v_days));
 return n;
end $$;
revoke all on function public.ai_audit_retention_job() from public,anon,authenticated;
do $$ begin
 if not exists(select 1 from cron.job where jobname='ai-audit-retention-daily') then
 perform cron.schedule('ai-audit-retention-daily','15 3 * * *','select public.ai_audit_retention_job()');
 end if;
end $$;