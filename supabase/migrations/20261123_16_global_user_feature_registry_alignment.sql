create or replace function public.set_user_features(p_users uuid[], p_features text[], p_enabled boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin and not disabled) then raise exception 'Administrator required'; end if;
 if cardinality(p_users)<1 or cardinality(p_users)>500 or cardinality(p_features)<1 or cardinality(p_features)>100
 or exists(select 1 from unnest(p_features) f where not exists(select 1 from public.application_registry r where r.feature_key=f and r.active))
 then raise exception 'Invalid feature assignment'; end if;
 if exists(select 1 from public.profiles where id=any(p_users) and is_admin) then raise exception 'Administrator feature access cannot be disabled or changed'; end if;
 insert into public.user_feature_access(user_id,feature,enabled,updated_at,updated_by)
 select distinct p.id,f,p_enabled,now(),auth.uid() from public.profiles p cross join unnest(p_features) f where p.id=any(p_users)
 on conflict(user_id,feature) do update set enabled=excluded.enabled,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
 get diagnostics n=row_count; return n;
end $$;