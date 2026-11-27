begin;
create function public.sentinel_gdelt_operations(p_collect boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare latest timestamptz:=date_bin(interval '15 minutes',now()-interval '30 minutes',timestamptz '2000-01-01'); first_slot timestamptz;
begin
 if auth.uid() is null or not public.is_active() or not public.is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
 if p_collect then
  perform pg_advisory_xact_lock(913672);
  select coalesce(max(slot)+interval '15 minutes',latest-interval '6 hours') into first_slot from sentinel_private.gdelt_batches;
  insert into sentinel_private.gdelt_batches(slot) select generate_series(greatest(first_slot,latest-interval '4 days'),latest,interval '15 minutes') on conflict do nothing;
  update sentinel_private.gdelt_batches set status='queued',attempts=0,touched_at=now() where status='failed' and slot>=now()-interval '4 days';
 end if;
 return jsonb_build_object('articles',(select count(*) from sentinel_private.gdelt_articles),'bytes',pg_total_relation_size('sentinel_private.gdelt_articles'),'latest',(select max(slot) from sentinel_private.gdelt_batches where status='complete'),'counts',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (select status,count(*) n from sentinel_private.gdelt_batches group by status) s),'history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from (select slot,status,attempts,records,error,touched_at from sentinel_private.gdelt_batches order by slot desc limit 30) h));
end $$;
revoke all on function public.sentinel_gdelt_operations(boolean) from public,anon;
grant execute on function public.sentinel_gdelt_operations(boolean) to authenticated;
commit;