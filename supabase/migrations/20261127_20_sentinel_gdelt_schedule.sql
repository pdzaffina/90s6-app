begin;
create function sentinel_private.gdelt_enqueue() returns void language plpgsql set search_path='' as $$
declare local_time timestamp:=now() at time zone 'America/Chicago'; latest timestamptz:=date_bin(interval '15 minutes',now()-interval '30 minutes',timestamptz '2000-01-01'); first_slot timestamptz;
begin
 if extract(isodow from local_time)>5 or extract(hour from local_time) not in (6,12,17) or extract(minute from local_time)<>0 then return; end if;
 select coalesce(max(slot)+interval '15 minutes',latest-interval '6 hours') into first_slot from sentinel_private.gdelt_batches;
 insert into sentinel_private.gdelt_batches(slot) select generate_series(greatest(first_slot,latest-interval '4 days'),latest,interval '15 minutes') on conflict do nothing;
 delete from sentinel_private.gdelt_articles where observed<now()-interval '30 days';
 delete from sentinel_private.gdelt_batches where slot<now()-interval '30 days';
end $$;
create function sentinel_private.gdelt_dispatch() returns void language plpgsql set search_path='' as $$
declare t text;
begin
 if not exists(select 1 from sentinel_private.gdelt_batches where attempts<5 and (status='queued' or (status='running' and touched_at<now()-interval '10 minutes'))) then return; end if;
 if exists(select 1 from sentinel_private.gdelt_batches where status='running' and touched_at>=now()-interval '10 minutes') then return; end if;
 t:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into sentinel_private.tokens values(t,now()+interval '2 minutes');
 perform net.http_post(url:='https://ohsrtfnlnlbipylyqpnh.supabase.co/functions/v1/sentinel-gdelt-ingest',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('token',t),timeout_milliseconds:=130000);
end $$;
select cron.schedule('sentinel-gdelt-enqueue','0 * * * *','select sentinel_private.gdelt_enqueue()');
select cron.schedule('sentinel-gdelt-dispatch','* * * * *','select sentinel_private.gdelt_dispatch()');
insert into sentinel_private.gdelt_batches(slot) values(date_bin(interval '15 minutes',now()-interval '30 minutes',timestamptz '2000-01-01')) on conflict do nothing;
commit;