begin;

create function public.sentinel_import_watches(p_org uuid,p_rows jsonb,p_update boolean,p_queue boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare user_id uuid:=auth.uid(); item jsonb; watch_id uuid;
  inserted_count integer:=0; updated_count integer:=0; skipped_count integer:=0; queued_count integer:=0;
  inserted boolean; row_number integer:=0;
begin
  if user_id is null or not public.news_watch_allowed(p_org) then
    raise exception 'News Watch access required' using errcode='42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>1000
      or length(p_rows::text)>2000000 then raise exception 'Invalid bulk import size'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    row_number:=row_number+1;
    if jsonb_typeof(item) is distinct from 'object' or exists(
      select 1 from jsonb_each_text(item) where length(value)>1000
    ) then raise exception 'Invalid data on import row %',row_number; end if;
    watch_id:=null;
    insert into public.sentinel_watches as target(org_id,owner_id,name,kind,category,ticker,exchange,sec_cik,
      website,vendor_id,criticality,objective,frequency,recipients,recipients_cc,active)
    values(p_org,user_id,trim(item->>'name'),coalesce(item->>'kind','company'),coalesce(item->>'category','Suppliers'),
      coalesce(item->>'ticker',''),coalesce(item->>'exchange',''),coalesce(item->>'sec_cik',''),
      coalesce(item->>'website',''),coalesce(item->>'vendor_id',''),coalesce(item->>'criticality','Unclassified'),
      coalesce(item->>'objective',''),coalesce(item->>'frequency','manual'),coalesce(item->>'recipients',''),
      coalesce(item->>'recipients_cc',''),coalesce((item->>'active')::boolean,true))
    on conflict(org_id,owner_id,kind,(lower(trim(name)))) do update set
      category=excluded.category,frequency=excluded.frequency,active=excluded.active,
      ticker=case when item?'ticker' then excluded.ticker else target.ticker end,
      exchange=case when item?'exchange' then excluded.exchange else target.exchange end,
      sec_cik=case when item?'sec_cik' then excluded.sec_cik else target.sec_cik end,
      website=case when item?'website' then excluded.website else target.website end,
      vendor_id=case when item?'vendor_id' then excluded.vendor_id else target.vendor_id end,
      criticality=case when item?'criticality' then excluded.criticality else target.criticality end,
      objective=case when item?'objective' then excluded.objective else target.objective end,
      recipients=case when item?'recipients' then excluded.recipients else target.recipients end,
      recipients_cc=case when item?'recipients_cc' then excluded.recipients_cc else target.recipients_cc end
    where p_update
    returning id,(xmax=0) into watch_id,inserted;
    if watch_id is null then skipped_count:=skipped_count+1; continue; end if;
    if inserted then inserted_count:=inserted_count+1; else updated_count:=updated_count+1; end if;
    if p_queue and inserted and coalesce((item->>'active')::boolean,true) then
      insert into public.sentinel_scan_runs(org_id,watch_id) values(p_org,watch_id) on conflict do nothing;
      if found then queued_count:=queued_count+1; end if;
    end if;
  end loop;
  insert into public.audit_log(actor_id,action,target,detail)
  values(user_id,'sentinel.bulk_import',p_org::text,jsonb_build_object(
    'inserted',inserted_count,'updated',updated_count,'skipped',skipped_count,'queued',queued_count));
  return jsonb_build_object('inserted',inserted_count,'updated',updated_count,'skipped',skipped_count,'queued',queued_count);
end $$;
revoke all on function public.sentinel_import_watches(uuid,jsonb,boolean,boolean) from public,anon;
grant execute on function public.sentinel_import_watches(uuid,jsonb,boolean,boolean) to authenticated;

commit;
