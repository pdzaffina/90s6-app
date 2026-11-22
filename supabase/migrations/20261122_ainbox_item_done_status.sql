begin;
create or replace function public.ainbox_run_rule(p_tenant uuid,p_rule uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
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
 if r.evaluator_type='WORK-001' then
   today_local:=(now() at time zone coalesce(cfg->>'timezone','UTC'))::date;
   for b in select id,owner_id,data,config from public.boards where tenant_id=p_tenant loop
     board_columns:=b.config->'columns';
     if jsonb_typeof(b.data)<>'array' then unknowns:=unknowns+1;continue;end if;
     for item in select value from jsonb_array_elements(b.data) loop
       source_id:=item->>'id';if source_id is null or source_id='' then unknowns:=unknowns+1;continue;end if;
       -- Completion is an item state, independent of the board column or swimlane.
       -- Legacy records without status are treated as To Do, never as Done.
       if coalesce(nullif(item->>'status',''),'To Do') not in ('To Do','In Progress','Done') then
         unknowns:=unknowns+1;continue;
       end if;
       if coalesce(nullif(item->>'status',''),'To Do')='Done' or nullif(item->>'due','') is null then
         perform ainbox_internal.record_result(p_tenant,run_id,r.id,r.current_version_id,r.workstream_id,'work_board',b.id::text,source_id,'Compliant','{}'::jsonb,work_owner,0);
         total:=total+1;continue;
       end if;
       begin due_date:=(item->>'due')::date;exception when others then unknowns:=unknowns+1;continue;end;
       outcome:=case when due_date<today_local then 'Violation' else 'Compliant' end;
       total:=total+1;if outcome='Violation' then violations:=violations+1;end if;
       evidence:=jsonb_build_object('title',left(coalesce(item->>'title','Work item'),140),'summary','Due '||due_date::text||' and status is '||coalesce(nullif(item->>'status',''),'To Do'),'next_action','Set the item status to Done or set a valid future due date','due',due_date,'status',coalesce(nullif(item->>'status',''),'To Do'));
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
end $$;
revoke all on function public.ainbox_run_rule(uuid,uuid) from public,anon;
grant execute on function public.ainbox_run_rule(uuid,uuid) to authenticated;
commit;