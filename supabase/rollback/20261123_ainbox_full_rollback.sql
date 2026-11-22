-- EMERGENCY ROLLBACK: Action Inbox v1 (destructive for Action Inbox records only).
-- Use after disabling Action Inbox UI and scheduled jobs.
-- Existing Work Boards, Portfolio and Knowledge Base records are retained.
-- WARNING: Drops all Action Inbox exception/history data. Export before execution.
begin;
drop function if exists public.ainbox_run_rule(uuid,uuid);
drop function if exists public.ainbox_get_actions(uuid,boolean);
drop function if exists public.ainbox_get_workstreams(uuid);
drop function if exists public.ainbox_get_rules(uuid);
drop function if exists public.ainbox_bootstrap(uuid,uuid);
drop function if exists public.ainbox_configure_rule(uuid,uuid,boolean,integer,jsonb);
drop function if exists public.ainbox_get_exception_detail(uuid,uuid);
drop function if exists public.ainbox_set_exception_state(uuid,uuid,text,integer,timestamptz);
drop function if exists public.ainbox_save_communication(uuid,uuid,text,text,text);
drop function if exists public.ainbox_approve_communication(uuid,uuid,integer);
drop function if exists public.ainbox_record_communication(uuid,uuid,integer,text,text);
drop function if exists public.ainbox_save_remediation(uuid,uuid,jsonb);
drop function if exists public.ainbox_approve_remediation(uuid,uuid,integer);
drop function if exists public.ainbox_complete_remediation_step(uuid,uuid,boolean);
drop function if exists public.ainbox_source_visible(uuid,text,text,text);
drop function if exists public.ainbox_authorized(uuid,boolean);
drop function if exists public.ainbox_member_directory(uuid);
drop trigger if exists ainbox_kb_draft_entry on public.knowledge_articles;
drop trigger if exists ainbox_assessment_actor on public.pm_initiatives;
drop trigger if exists ainbox_portfolio_assessment_audit on public.pm_initiatives;
drop function if exists public.ainbox_track_draft_entry();
drop function if exists public.ainbox_set_assessment_actor();
drop function if exists public.ainbox_audit_assessment();
drop table if exists public.ainbox_metric_observations;
drop table if exists public.ainbox_activity_events;
drop table if exists public.ainbox_remediation_steps;
drop table if exists public.ainbox_remediation_plans;
drop table if exists public.ainbox_communication_versions;
drop table if exists public.ainbox_communications;
drop table if exists public.ainbox_exceptions;
drop table if exists public.ainbox_scan_runs;
alter table if exists public.ainbox_rules drop constraint if exists ainbox_rules_active_version_fk;
drop table if exists public.ainbox_rule_versions;
drop table if exists public.ainbox_rules;
drop table if exists public.ainbox_metrics;
drop table if exists public.ainbox_workstreams;
drop schema if exists ainbox_internal cascade;
delete from public.tenant_user_feature_access where feature='action_inbox';
delete from public.tenant_feature_access where feature='action_inbox';
delete from public.user_feature_access where feature='action_inbox';
alter table public.knowledge_articles drop column if exists draft_entered_at;
alter table public.pm_initiatives drop column if exists assessment_completed_at;
alter table public.pm_initiatives drop column if exists assessment_completed_by;
-- Admin RPC allowlists require restoring their prior definitions from the pre-release migration or backup.
commit;