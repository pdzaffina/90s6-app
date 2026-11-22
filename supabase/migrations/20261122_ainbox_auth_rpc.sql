-- Action Inbox feature registration and strict server authorization.
begin;
alter table public.tenant_feature_access drop constraint if exists tenant_feature_access_feature_check;
alter table public.tenant_feature_access add constraint tenant_feature_access_feature_check check(feature in ('portfolio_management','work_board','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator','action_inbox'));
alter table public.tenant_user_feature_access drop constraint if exists tenant_user_feature_access_feature_check;
alter table public.tenant_user_feature_access add constraint tenant_user_feature_access_feature_check check(feature in ('portfolio_management','work_board','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator','action_inbox'));
alter table public.user_feature_access drop constraint if exists user_feature_access_feature_check;
alter table public.user_feature_access add constraint user_feature_access_feature_check check(feature in ('work_board','training','prompt_library','content_studio','use_case_curator','studio_courses','studio_prompts','studio_knowledge','knowledge_base','action_inbox'));
-- Explicit opt-in: a new application is disabled for every organization.
insert into public.tenant_feature_access(tenant_id,feature,enabled)
select id,'action_inbox',false from public.tenants on conflict do nothing;
create or replace function public.ainbox_authorized(p_tenant uuid,p_manage boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
select public.is_active()
and (public.is_admin() or public.is_tenant_member(p_tenant))
and (public.is_admin() or (
 public.has_feature('action_inbox')
 and coalesce((select enabled from public.tenant_feature_access where tenant_id=p_tenant and feature='action_inbox'),false)
 and coalesce((select enabled from public.tenant_user_feature_access where tenant_id=p_tenant and user_id=auth.uid() and feature='action_inbox'),true)
))
and (not p_manage or public.is_admin() or public.tenant_role(p_tenant) in ('tenant_admin','superuser'))
$$;
revoke all on function public.ainbox_authorized(uuid,boolean) from public,anon;
grant execute on function public.ainbox_authorized(uuid,boolean) to authenticated;
-- Source authorization is separate from assignment.
create or replace function public.ainbox_source_visible(p_tenant uuid,p_source text,p_parent text,p_id text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare b uuid; k uuid; portfolio uuid;
begin
 if not public.ainbox_authorized(p_tenant,false) then return false; end if;
 if p_source='work_board' then
   begin b:=p_parent::uuid; exception when invalid_text_representation then return false; end;
   return exists(select 1 from public.boards x where x.id=b and x.tenant_id=p_tenant and public.has_feature('work_board') and
    (public.is_admin() or public.is_tenant_admin(p_tenant) or (public.is_tenant_member(p_tenant) and
      (x.owner_id=auth.uid() and public.tenant_role(p_tenant)='superuser' or public.is_member(b)))));
 elsif p_source='portfolio' then
   begin portfolio:=p_parent::uuid; exception when invalid_text_representation then return false; end;
   return public.has_feature('portfolio_management') and exists(select 1 from public.pm_portfolios x where x.id=portfolio and x.tenant_id=p_tenant and public.pm_access(portfolio,'viewer'));
 elsif p_source='knowledge_base' then
   begin k:=p_id::uuid; exception when invalid_text_representation then return false; end;
   return exists(select 1 from public.knowledge_articles x where x.id=k
     and ((x.content_scope='tenant' and x.tenant_id=p_tenant) or (x.content_scope='platform' and x.tenant_id is null))
     and public.can_read_content(x.content_scope,x.tenant_id)
     and public.has_feature('content_studio') and public.has_feature('studio_knowledge')
     and public.can_manage_content(x.content_scope,x.tenant_id));
 end if;
 return false;
end $$;
revoke all on function public.ainbox_source_visible(uuid,text,text,text) from public,anon;
grant execute on function public.ainbox_source_visible(uuid,text,text,text) to authenticated;
create or replace function public.ainbox_get_actions(p_tenant uuid,p_all boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Access denied' using errcode='42501'; end if;
 if p_all and not public.ainbox_authorized(p_tenant,true) then raise exception 'Administrator required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.priority_score desc,q.first_detected_at asc),'[]'::jsonb) into result
 from (
 select e.id,e.workstream_id,w.name as workstream,e.rule_id,r.rule_key,r.name as rule_name,
 e.source_type,e.source_parent_id,e.source_id,e.status,e.snoozed_until,
 e.priority_score,e.assignee_id,e.first_detected_at,e.last_detected_at,e.resolved_at,e.revision,
 e.evidence->>'title' as title,e.evidence->>'summary' as summary,
 e.evidence->>'next_action' as next_action
 from public.ainbox_exceptions e
 join public.ainbox_workstreams w on w.id=e.workstream_id and w.tenant_id=e.tenant_id
 join public.ainbox_rules r on r.id=e.rule_id and r.tenant_id=e.tenant_id
 where e.tenant_id=p_tenant and (p_all or e.assignee_id=auth.uid())
 and public.ainbox_source_visible(p_tenant,e.source_type,e.source_parent_id,e.source_id)
 ) q;
 return result;
end $$;
revoke all on function public.ainbox_get_actions(uuid,boolean) from public,anon;
grant execute on function public.ainbox_get_actions(uuid,boolean) to authenticated;
create or replace function public.ainbox_get_workstreams(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Access denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'desired_outcome',desired_outcome,'health_status',health_status,'owner_id',owner_id,'status',status) order by name),'[]'::jsonb)
 into result from public.ainbox_workstreams where tenant_id=p_tenant and status<>'archived';
 return result;
end $$;
revoke all on function public.ainbox_get_workstreams(uuid) from public,anon;
grant execute on function public.ainbox_get_workstreams(uuid) to authenticated;
create or replace function public.ainbox_set_exception_state(p_tenant uuid,p_id uuid,p_status text,p_revision integer,p_snoozed_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ainbox_exceptions; updated public.ainbox_exceptions;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Access denied' using errcode='42501'; end if;
 select * into e from public.ainbox_exceptions where id=p_id and tenant_id=p_tenant for update;
 if not found then raise exception 'Not found'; end if;
 if e.assignee_id is distinct from auth.uid() and not public.ainbox_authorized(p_tenant,true) then raise exception 'Access denied' using errcode='42501'; end if;
 if not public.ainbox_source_visible(p_tenant,e.source_type,e.source_parent_id,e.source_id) then raise exception 'Source access denied' using errcode='42501'; end if;
 if p_revision<>e.revision then raise exception 'Stale revision'; end if;
 if e.resolved_at is not null or p_status not in ('open','in_progress','dismissed','snoozed') then raise exception 'Invalid transition'; end if;
 if p_status='snoozed' and (p_snoozed_until is null or p_snoozed_until<=now()) then raise exception 'Future snooze date required'; end if;
 update public.ainbox_exceptions set status=case when p_status='snoozed' then 'open' else p_status end,
 snoozed_until=case when p_status='snoozed' then p_snoozed_until else null end,
 revision=revision+1,updated_at=now() where id=p_id returning * into updated;
 insert into public.ainbox_activity_events(tenant_id,exception_id,actor_id,event_type,before_state,after_state)
 values(p_tenant,p_id,auth.uid(),'state_changed',jsonb_build_object('status',e.status,'snoozed_until',e.snoozed_until),
 jsonb_build_object('status',updated.status,'snoozed_until',updated.snoozed_until));
 return jsonb_build_object('id',updated.id,'status',updated.status,'revision',updated.revision);
end $$;
revoke all on function public.ainbox_set_exception_state(uuid,uuid,text,integer,timestamptz) from public,anon;
grant execute on function public.ainbox_set_exception_state(uuid,uuid,text,integer,timestamptz) to authenticated;
commit;