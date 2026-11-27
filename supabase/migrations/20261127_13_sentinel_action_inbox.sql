begin;

alter table public.sentinel_watches add column inbox_enabled boolean not null default false;

CREATE OR REPLACE FUNCTION public.ainbox_source_visible(p_tenant uuid, p_source text, p_parent text, p_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b uuid; k uuid; portfolio uuid;
begin
 if not public.ainbox_authorized(p_tenant,false) then return false; end if;
 if p_source='sentinel' then
   begin k:=p_parent::uuid; exception when invalid_text_representation then return false; end;
   return public.news_watch_allowed(p_tenant) and exists(
     select 1 from public.sentinel_watches w where w.id=k and w.org_id=p_tenant and w.inbox_enabled
       and (w.owner_id=auth.uid() or w.shared));
 elsif p_source='work_board' then
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
end $function$;

CREATE OR REPLACE FUNCTION public.ainbox_run_rule(p_tenant uuid, p_rule uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.ainbox_rules; cfg jsonb; run_id uuid; b record; item jsonb; col jsonb; article record; initiative record;
 outcome text; due_date date; today_local date; complete boolean; owner uuid; evidence jsonb; total integer:=0; violations integer:=0; unknowns integer:=0;
 active_statuses jsonb; threshold_days integer; board_columns jsonb; source_id text; col_id text; work_owner uuid;
begin
 if not public.ainbox_authorized(p_tenant,true) then raise exception 'Access denied' using errcode='42501'; end if;
 select * into r from public.ainbox_rules where tenant_id=p_tenant and id=p_rule for update;
 if not found or not r.enabled or r.current_version_id is null then raise exception 'Rule disabled or not configured'; end if;
 if exists(select 1 from public.ainbox_scan_runs where tenant_id=p_tenant and rule_id=p_rule and status='running' and lease_expires_at>now()) then raise exception 'Rule scan already running'; end if;
 select configuration into cfg from public.ainbox_rule_versions where id=r.current_version_id and tenant_id=p_tenant;
 select owner_id into work_owner from public.ainbox_workstreams where id=r.workstream_id and tenant_id=p_tenant;
 insert into public.ainbox_scan_runs(tenant_id,rule_id,rule_version_id,trigger_type,status,started_at,lease_expires_at)
 values(p_tenant,p_rule,r.current_version_id,'manual','running',now(),now()+interval '5 minutes') returning id into run_id;
 if r.evaluator_type='SENTINEL' then
   null;
 elsif r.evaluator_type='WORK-001' then
   today_local:=(now() at time zone coalesce(cfg->>'timezone','UTC'))::date;
   for b in select id,owner_id,data,config from public.boards where tenant_id=p_tenant loop
     board_columns:=b.config->'columns';
     if jsonb_typeof(b.data)<>'array' then unknowns:=unknowns+1;continue;end if;
     for item in select value from jsonb_array_elements(b.data) loop
       source_id:=item->>'id';if source_id is null or source_id='' then unknowns:=unknowns+1;continue;end if;
       if nullif(item->>'due','') is null then
         perform ainbox_internal.record_result(p_tenant,run_id,r.id,r.current_version_id,r.workstream_id,'work_board',b.id::text,source_id,'Compliant','{}'::jsonb,work_owner,0);
         continue;
       end if;
       begin due_date:=(item->>'due')::date;exception when others then unknowns:=unknowns+1;continue;end;
       if item->>'status' is not null and item->>'status' not in ('To Do','In Progress','Done') then unknowns:=unknowns+1;continue;end if;
       complete:=item->>'status'='Done';
       outcome:=case when not complete and due_date<today_local then 'Violation' else 'Compliant' end;
       total:=total+1;if outcome='Violation' then violations:=violations+1;end if;
       evidence:=jsonb_build_object('title',left(coalesce(item->>'title','Work item'),140),'summary','Due '||due_date::text||' and status is not Done','next_action','Set the work item status to Done or establish a valid future due date','due',due_date);
       perform ainbox_internal.record_result(p_tenant,run_id,r.id,r.current_version_id,r.workstream_id,'work_board',b.id::text,source_id,outcome,evidence,work_owner,case when outcome='Violation' then 65 else 0 end);
     end loop;
   end loop;
 elsif r.evaluator_type='KB-002' then
   threshold_days:=(cfg->>'threshold_days')::integer;
   for article in select id,title,status,archived_at,draft_entered_at,created_by from public.knowledge_articles
     where tenant_id=p_tenant and content_scope='tenant' loop
     if article.archived_at is not null or article.status<>'draft' then outcome:='Compliant';
     elsif article.draft_entered_at is null then outcome:='Unknown';
     elsif article.draft_entered_at < now()-make_interval(days=>threshold_days) then outcome:='Violation';
     else outcome:='Compliant';end if;
     if outcome='Unknown' then unknowns:=unknowns+1;continue;end if;
     total:=total+1;if outcome='Violation' then violations:=violations+1;end if;
     evidence:=jsonb_build_object('title',left(article.title,140),'summary','Knowledge article draft exceeds '||threshold_days||' calendar days','next_action','Publish, archive, or move the article out of Draft');
     perform ainbox_internal.record_result(p_tenant,run_id,r.id,r.current_version_id,r.workstream_id,'knowledge_base','',article.id::text,outcome,evidence,article.created_by,case when outcome='Violation' then 55 else 0 end);
   end loop;
 elsif r.evaluator_type='PORT-003' then
   active_statuses:=cfg->'active_statuses';
   for initiative in select i.id,i.title,i.status,i.agreed_rank,i.assessment_completed_at,i.portfolio_id
     from public.pm_initiatives i join public.pm_portfolios p on p.id=i.portfolio_id where p.tenant_id=p_tenant loop
     if initiative.status is null then outcome:='Unknown';
     elsif active_statuses ? initiative.status then
       outcome:=case when initiative.assessment_completed_at is null or initiative.agreed_rank is null then 'Violation' else 'Compliant' end;
     else outcome:='Compliant';end if;
     if outcome='Unknown' then unknowns:=unknowns+1;continue;end if;
     total:=total+1;if outcome='Violation' then violations:=violations+1;end if;
     evidence:=jsonb_build_object('title',left(initiative.title,140),'summary',
       case when initiative.assessment_completed_at is null and initiative.agreed_rank is null then 'Assessment and agreed rank missing'
       when initiative.assessment_completed_at is null then 'Assessment incomplete' else 'Agreed rank missing' end,
       'next_action','Complete the assessment and establish an agreed rank');
     perform ainbox_internal.record_result(p_tenant,run_id,r.id,r.current_version_id,r.workstream_id,'portfolio',initiative.portfolio_id::text,initiative.id::text,outcome,evidence,work_owner,case when outcome='Violation' then 70 else 0 end);
   end loop;
 else raise exception 'Unknown evaluator';end if;
 update public.ainbox_scan_runs set status='succeeded',completed_at=now(),lease_expires_at=null,
 evaluated_count=total,violation_count=violations,unknown_count=unknowns,
 coverage=jsonb_build_object('method','explicit_record_evaluation','evaluated',total,'unknown',unknowns) where id=run_id;
 update public.ainbox_rules set last_success_at=now(),next_scan_at=now()+make_interval(mins=>r.scan_interval_minutes),updated_at=now() where id=p_rule;
 return jsonb_build_object('scan_run_id',run_id,'evaluated',total,'violations',violations,'unknown',unknowns);
end $function$;


alter table public.ainbox_rules drop constraint ainbox_rules_evaluator_type_check,
  add constraint ainbox_rules_evaluator_type_check
    check(evaluator_type in ('WORK-001','KB-002','PORT-003','SENTINEL'));

create function sentinel_private.publish_inbox() returns trigger
language plpgsql security definer set search_path='' as $$
declare watch public.sentinel_watches; rule public.ainbox_rules; workstream uuid; version_id uuid; evaluation uuid;
  report jsonb; risk jsonb; findings jsonb:='[]'; finding jsonb; monitor_failure boolean; resolved_monitor boolean;
begin
  if new.status not in ('complete','partial','failed') then return new; end if;
  select * into watch from public.sentinel_watches where id=new.watch_id and org_id=new.org_id and active and inbox_enabled;
  if not found or not sentinel_private.watch_can_run(watch.org_id,watch.owner_id)
    or not exists(select 1 from public.application_registry where feature_key='action_inbox' and active)
    or not exists(select 1 from public.tenant_feature_access where tenant_id=watch.org_id and feature='action_inbox' and enabled)
    or exists(select 1 from public.user_feature_access where user_id=watch.owner_id and feature='action_inbox' and not enabled)
    or exists(select 1 from public.tenant_user_feature_access
      where user_id=watch.owner_id and tenant_id=watch.org_id and feature='action_inbox' and not enabled) then return new; end if;

  monitor_failure:=lower(watch.criticality)='critical' and
    (new.status='failed' or (new.status='partial' and jsonb_array_length(new.evidence)=0));
  resolved_monitor:=new.status='complete' or (new.status='partial' and jsonb_array_length(new.evidence)>0);
  report:=sentinel_private.parse_report(new.assessment);
  for risk in select value from jsonb_array_elements(coalesce(report->'risks','[]'::jsonb)) loop
    if risk->>'severity'='critical' or (risk->>'severity'='high' and risk->>'direction'='deteriorating') then
      if exists(select 1 from jsonb_array_elements(risk->'sources') s(value)
          where new.evidence->((s.value::text)::integer-1)->>'new_development'='true') then
        findings:=findings||jsonb_build_array(risk);
      end if;
    end if;
  end loop;

  if not monitor_failure and jsonb_array_length(findings)=0
    and not (resolved_monitor and exists(select 1 from public.ainbox_exceptions
      where tenant_id=watch.org_id and source_type='sentinel' and source_parent_id=watch.id::text
        and source_id='monitoring' and resolved_at is null)) then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('sentinel-action-inbox:'||watch.org_id::text,0));
  select * into rule from public.ainbox_rules where tenant_id=watch.org_id and rule_key='SENTINEL';
  if not found then
    insert into public.ainbox_workstreams(tenant_id,name,purpose,status,owner_id)
      values(watch.org_id,'External intelligence','Review significant Sentinel findings and coverage failures','active',watch.owner_id)
      returning id into workstream;
    insert into public.ainbox_rules(tenant_id,workstream_id,rule_key,name,evaluator_type,enabled)
      values(watch.org_id,workstream,'SENTINEL','Sentinel intelligence findings','SENTINEL',true)
      returning * into rule;
    insert into public.ainbox_rule_versions(tenant_id,rule_id,version_number,configuration,configuration_hash)
      values(watch.org_id,rule.id,1,'{"event_driven":true}','sentinel-event-v1') returning id into version_id;
    update public.ainbox_rules set current_version_id=version_id where id=rule.id returning * into rule;
  end if;
  if not rule.enabled or rule.current_version_id is null then return new; end if;

  insert into public.ainbox_scan_runs(tenant_id,rule_id,rule_version_id,trigger_type,status,started_at,completed_at,
    evaluated_count,violation_count,coverage)
    values(watch.org_id,rule.id,rule.current_version_id,'scheduled','succeeded',coalesce(new.started_at,now()),now(),
      jsonb_array_length(findings)+1,jsonb_array_length(findings)+case when monitor_failure then 1 else 0 end,
      jsonb_build_object('method','sentinel_scan','scan_id',new.id)) returning id into evaluation;

  if monitor_failure or resolved_monitor then
    perform ainbox_internal.record_result(watch.org_id,evaluation,rule.id,rule.current_version_id,rule.workstream_id,
      'sentinel',watch.id::text,'monitoring',case when monitor_failure then 'Violation' else 'Compliant' end,
      jsonb_build_object('title',left(watch.name||' monitoring needs attention',140),
        'summary','A critical watch did not obtain usable intelligence.',
        'next_action','Review provider availability and retry the watch.', 'scan_id',new.id),
      watch.owner_id,90);
  end if;
  for finding in select value from jsonb_array_elements(findings) loop
    perform ainbox_internal.record_result(watch.org_id,evaluation,rule.id,rule.current_version_id,rule.workstream_id,
      'sentinel',watch.id::text,'risk:'||(finding->>'category'),'Violation',
      jsonb_build_object('title',left(watch.name||' · '||replace(finding->>'category','_',' '),140),
        'summary',left(finding->>'text',800),'next_action','Review the cited assessment and acknowledge the finding.',
        'scan_id',new.id),watch.owner_id,case when finding->>'severity'='critical' then 100 else 85 end);
  end loop;
  update public.ainbox_rules set last_success_at=now(),updated_at=now() where id=rule.id;
  return new;
exception when others then
  raise warning 'Sentinel Action Inbox publishing failed (SQLSTATE %)',sqlstate;
  return new;
end $$;
revoke all on function sentinel_private.publish_inbox() from public,anon,authenticated;

create trigger sentinel_publish_inbox after update of status,assessment on public.sentinel_scan_runs
for each row when (new.status is distinct from old.status or new.assessment is distinct from old.assessment)
execute function sentinel_private.publish_inbox();

commit;
