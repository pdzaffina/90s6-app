-- Action Inbox V1 foundation. Additive, feature-disabled by default.
-- IMPORTANT: review against deployed schema before running. No browser table grants.
begin;
create table if not exists public.ainbox_workstreams (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 name text not null,
 purpose text,
 desired_outcome text,
 owner_id uuid,
 status text not null default 'draft' check(status in ('draft',
 'active',
 'archived')),
 health_status text not null default 'Insufficient Data' check(health_status in ('On Track',
 'At Risk',
 'Off Track',
 'Insufficient Data')),
 health_calculated_at timestamptz,
 revision integer not null default 1,
 unique(tenant_id,id)
);
alter table public.ainbox_workstreams enable row level security;
revoke all on public.ainbox_workstreams from anon,authenticated;
alter table public.ainbox_workstreams add column if not exists updated_at timestamptz not null default now();
create table if not exists public.ainbox_metrics (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 workstream_id uuid not null,
 metric_key text not null,
 name text not null,
 unit text,
 direction text not null check(direction in ('higher',
 'lower')),
 target_value numeric,
 thresholds jsonb not null default '{}'::jsonb,
 freshness_minutes integer not null default 1440 check(freshness_minutes>0),
 enabled boolean not null default true,
 unique(tenant_id,id)
);
alter table public.ainbox_metrics enable row level security;
revoke all on public.ainbox_metrics from anon,authenticated;
alter table public.ainbox_metrics add column if not exists updated_at timestamptz not null default now();
create table if not exists public.ainbox_metric_observations (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 metric_id uuid not null,
 observed_at timestamptz not null,
 value numeric,
 quality_status text not null check(quality_status in ('Valid',
 'Missing',
 'Invalid')),
 source_run_id uuid,
 details jsonb not null default '{}'::jsonb,
 unique(tenant_id,id)
);
alter table public.ainbox_metric_observations enable row level security;
revoke all on public.ainbox_metric_observations from anon,authenticated;
alter table public.ainbox_metric_observations add column if not exists updated_at timestamptz not null default now();
create table if not exists public.ainbox_rules (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 workstream_id uuid not null,
 rule_key text not null,
 name text not null,
 evaluator_type text not null check(evaluator_type in ('WORK-001',
 'KB-002',
 'PORT-003')),
 enabled boolean not null default false,
 current_version_id uuid,
 scan_interval_minutes integer not null default 360 check(scan_interval_minutes>=15),
 next_scan_at timestamptz,
 last_success_at timestamptz,
 unique(tenant_id,id)
);
alter table public.ainbox_rules enable row level security;
revoke all on public.ainbox_rules from anon,authenticated;
alter table public.ainbox_rules add column if not exists updated_at timestamptz not null default now();
create table if not exists public.ainbox_rule_versions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 rule_id uuid not null,
 version_number integer not null check(version_number>0),
 configuration jsonb not null,
 configuration_hash text not null,
 created_by uuid,
 created_at timestamptz not null default now(),
 unique(tenant_id,id)
);
alter table public.ainbox_rule_versions enable row level security;
revoke all on public.ainbox_rule_versions from anon,authenticated;
create table if not exists public.ainbox_scan_runs (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 rule_id uuid not null,
 rule_version_id uuid not null,
 trigger_type text not null check(trigger_type in ('scheduled',
 'manual',
 'verification',
 'preview')),
 status text not null default 'queued' check(status in ('queued',
 'running',
 'succeeded',
 'partial',
 'failed',
 'canceled')),
 started_at timestamptz,
 completed_at timestamptz,
 lease_expires_at timestamptz,
 attempt_count integer not null default 0 check(attempt_count>=0),
 evaluated_count integer not null default 0,
 violation_count integer not null default 0,
 unknown_count integer not null default 0,
 coverage jsonb not null default '{}'::jsonb,
 error_summary jsonb not null default '{}'::jsonb,
 unique(tenant_id,id)
);
alter table public.ainbox_scan_runs enable row level security;
revoke all on public.ainbox_scan_runs from anon,authenticated;
alter table public.ainbox_scan_runs add column if not exists updated_at timestamptz not null default now();
create table if not exists public.ainbox_exceptions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 workstream_id uuid not null,
 rule_id uuid not null,
 rule_version_id uuid not null,
 source_type text not null,
 source_parent_id text not null default '',
 source_id text not null,
 source_key text not null,
 source_owner_id uuid,
 assignee_id uuid,
 status text not null default 'open' check(status in ('open',
 'in_progress',
 'dismissed',
 'resolved')),
 snoozed_until timestamptz,
 priority_score numeric not null default 0,
 priority_version text not null default 'v1',
 first_detected_at timestamptz not null default now(),
 last_detected_at timestamptz not null default now(),
 last_scan_run_id uuid,
 resolved_at timestamptz,
 resolution_reason text,
 evidence jsonb not null default '{}'::jsonb,
 revision integer not null default 1,
 check ((status='resolved')=(resolved_at is not null)),
 unique(tenant_id,id)
);
alter table public.ainbox_exceptions enable row level security;
revoke all on public.ainbox_exceptions from anon,authenticated;
alter table public.ainbox_exceptions add column if not exists updated_at timestamptz not null default now();
create table if not exists public.ainbox_remediation_plans (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 exception_id uuid not null,
 status text not null default 'proposed' check(status in ('proposed',
 'approved',
 'in_progress',
 'completed')),
 revision integer not null default 1,
 approved_revision integer,
 approved_snapshot jsonb,
 approved_by uuid,
 approved_at timestamptz,
 unique(tenant_id,id)
);
alter table public.ainbox_remediation_plans enable row level security;
revoke all on public.ainbox_remediation_plans from anon,authenticated;
alter table public.ainbox_remediation_plans add column if not exists updated_at timestamptz not null default now();
create table if not exists public.ainbox_remediation_steps (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 plan_id uuid not null,
 sequence integer not null check(sequence>0),
 description text not null,
 completed_at timestamptz,
 completed_by uuid,
 unique(tenant_id,id)
);
alter table public.ainbox_remediation_steps enable row level security;
revoke all on public.ainbox_remediation_steps from anon,authenticated;
alter table public.ainbox_remediation_steps add column if not exists updated_at timestamptz not null default now();
create table if not exists public.ainbox_communications (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 exception_id uuid not null,
 recipient text,
 subject text,
 body text,
 status text not null default 'draft' check(status in ('draft',
 'approved',
 'sent',
 'completed')),
 current_version integer not null default 1,
 delivery_record jsonb,
 unique(tenant_id,id)
);
alter table public.ainbox_communications enable row level security;
revoke all on public.ainbox_communications from anon,authenticated;
alter table public.ainbox_communications add column if not exists updated_at timestamptz not null default now();
create table if not exists public.ainbox_communication_versions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 communication_id uuid not null,
 version_number integer not null,
 recipient text,
 subject text,
 body text,
 approved_by uuid not null,
 approved_at timestamptz not null default now(),
 unique(tenant_id,id)
);
alter table public.ainbox_communication_versions enable row level security;
revoke all on public.ainbox_communication_versions from anon,authenticated;
create table if not exists public.ainbox_activity_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 exception_id uuid,
 actor_id uuid,
 event_type text not null,
 before_state jsonb,
 after_state jsonb,
 occurred_at timestamptz not null default now(),
 scan_run_id uuid,
 unique(tenant_id,id)
);
alter table public.ainbox_activity_events enable row level security;
revoke all on public.ainbox_activity_events from anon,authenticated;
alter table public.ainbox_metrics add constraint ainbox_metrics_workstream_id_fk foreign key (tenant_id,workstream_id) references public.ainbox_workstreams(tenant_id,id) on delete restrict;
alter table public.ainbox_metric_observations add constraint ainbox_metric_observations_metric_id_fk foreign key (tenant_id,metric_id) references public.ainbox_metrics(tenant_id,id) on delete restrict;
alter table public.ainbox_rules add constraint ainbox_rules_workstream_id_fk foreign key (tenant_id,workstream_id) references public.ainbox_workstreams(tenant_id,id) on delete restrict;
alter table public.ainbox_rule_versions add constraint ainbox_rule_versions_rule_id_fk foreign key (tenant_id,rule_id) references public.ainbox_rules(tenant_id,id) on delete restrict;
alter table public.ainbox_scan_runs add constraint ainbox_scan_runs_rule_id_fk foreign key (tenant_id,rule_id) references public.ainbox_rules(tenant_id,id) on delete restrict;
alter table public.ainbox_scan_runs add constraint ainbox_scan_runs_rule_version_id_fk foreign key (tenant_id,rule_version_id) references public.ainbox_rule_versions(tenant_id,id) on delete restrict;
alter table public.ainbox_exceptions add constraint ainbox_exceptions_workstream_id_fk foreign key (tenant_id,workstream_id) references public.ainbox_workstreams(tenant_id,id) on delete restrict;
alter table public.ainbox_exceptions add constraint ainbox_exceptions_rule_id_fk foreign key (tenant_id,rule_id) references public.ainbox_rules(tenant_id,id) on delete restrict;
alter table public.ainbox_exceptions add constraint ainbox_exceptions_rule_version_id_fk foreign key (tenant_id,rule_version_id) references public.ainbox_rule_versions(tenant_id,id) on delete restrict;
alter table public.ainbox_remediation_plans add constraint ainbox_remediation_plans_exception_id_fk foreign key (tenant_id,exception_id) references public.ainbox_exceptions(tenant_id,id) on delete restrict;
alter table public.ainbox_remediation_steps add constraint ainbox_remediation_steps_plan_id_fk foreign key (tenant_id,plan_id) references public.ainbox_remediation_plans(tenant_id,id) on delete restrict;
alter table public.ainbox_communications add constraint ainbox_communications_exception_id_fk foreign key (tenant_id,exception_id) references public.ainbox_exceptions(tenant_id,id) on delete restrict;
alter table public.ainbox_communication_versions add constraint ainbox_communication_versions_communication_id_fk foreign key (tenant_id,communication_id) references public.ainbox_communications(tenant_id,id) on delete restrict;
alter table public.ainbox_activity_events add constraint ainbox_activity_events_exception_id_fk foreign key (tenant_id,exception_id) references public.ainbox_exceptions(tenant_id,id) on delete restrict;
alter table public.ainbox_metric_observations add constraint ainbox_metric_observations_source_run_id_fk foreign key (tenant_id,source_run_id) references public.ainbox_scan_runs(tenant_id,id) on delete restrict;
alter table public.ainbox_exceptions add constraint ainbox_exceptions_last_scan_run_id_fk foreign key (tenant_id,last_scan_run_id) references public.ainbox_scan_runs(tenant_id,id) on delete restrict;
alter table public.ainbox_activity_events add constraint ainbox_activity_events_scan_run_id_fk foreign key (tenant_id,scan_run_id) references public.ainbox_scan_runs(tenant_id,id) on delete restrict;
alter table public.ainbox_rules add constraint ainbox_rules_active_version_fk foreign key(tenant_id,current_version_id) references public.ainbox_rule_versions(tenant_id,id) on delete restrict;
create unique index if not exists ainbox_rule_versions_number_uk on public.ainbox_rule_versions(tenant_id,rule_id,version_number);
create unique index if not exists ainbox_rules_key_uk on public.ainbox_rules(tenant_id,rule_key);
create unique index if not exists ainbox_metrics_key_uk on public.ainbox_metrics(tenant_id,workstream_id,metric_key);
create unique index if not exists ainbox_steps_sequence_uk on public.ainbox_remediation_steps(tenant_id,plan_id,sequence);
create unique index if not exists ainbox_comm_version_uk on public.ainbox_communication_versions(tenant_id,communication_id,version_number);
create unique index if not exists ainbox_unresolved_uk on public.ainbox_exceptions(tenant_id,rule_id,source_key) where resolved_at is null;
create index if not exists ainbox_rules_due_idx on public.ainbox_rules(tenant_id,next_scan_at) where enabled;
create index if not exists ainbox_runs_history_idx on public.ainbox_scan_runs(tenant_id,rule_id,started_at desc);
create index if not exists ainbox_actions_idx on public.ainbox_exceptions(tenant_id,assignee_id,priority_score desc) where resolved_at is null;
create index if not exists ainbox_workstream_ex_idx on public.ainbox_exceptions(tenant_id,workstream_id,status,priority_score desc);
create index if not exists ainbox_observations_idx on public.ainbox_metric_observations(tenant_id,metric_id,observed_at desc);
create index if not exists ainbox_activity_idx on public.ainbox_activity_events(tenant_id,exception_id,occurred_at desc);
-- Defense in depth: historical rows cannot be changed even by an accidental writer.
create schema if not exists ainbox_internal;
revoke all on schema ainbox_internal from public,anon,authenticated;
create or replace function ainbox_internal.prevent_history_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Immutable Action Inbox history'; end $$;
revoke all on function ainbox_internal.prevent_history_mutation() from public,anon,authenticated;
create trigger ainbox_rule_versions_immutable before update or delete on public.ainbox_rule_versions for each row execute function ainbox_internal.prevent_history_mutation();
create trigger ainbox_communication_versions_immutable before update or delete on public.ainbox_communication_versions for each row execute function ainbox_internal.prevent_history_mutation();
create trigger ainbox_activity_events_immutable before update or delete on public.ainbox_activity_events for each row execute function ainbox_internal.prevent_history_mutation();
commit;
