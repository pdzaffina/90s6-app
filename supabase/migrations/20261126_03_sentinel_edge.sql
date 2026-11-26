create extension if not exists pg_net;
create schema if not exists sentinel_private;
revoke all on schema sentinel_private from public,anon,authenticated;
create table if not exists sentinel_private.tokens(token text primary key, expires_at timestamptz not null);
create or replace function public.sentinel_consume_token(p_token text) returns boolean language sql security definer set search_path='' as $$ with consumed as (delete from sentinel_private.tokens where token=p_token and expires_at>now() returning token) select exists(select 1 from consumed) $$;
revoke all on function public.sentinel_consume_token(text) from public,anon,authenticated;
grant execute on function public.sentinel_consume_token(text) to service_role;
create or replace function sentinel_private.dispatch() returns bigint language plpgsql set search_path='' as $$ declare t text; begin
delete from sentinel_private.tokens where expires_at<=now();
t:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
insert into sentinel_private.tokens values(t,now()+interval '2 minutes');
return net.http_post(url:='https://ohsrtfnlnlbipylyqpnh.supabase.co/functions/v1/sentinel-worker',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('token',t),timeout_milliseconds:=40000);
end $$;
revoke all on function sentinel_private.dispatch() from public,anon,authenticated;
select cron.schedule('sentinel-edge-worker','* * * * *','select sentinel_private.dispatch()');