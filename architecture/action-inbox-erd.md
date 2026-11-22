# Action Inbox entity relationship diagram

**Status:** Logical ERD based on `20261123_01_ainbox_foundation.sql` and subsequent Action Inbox migrations. The diagram omits many secondary indexes and operational columns. Refer to migrations for executable schema.

```mermaid
erDiagram
  TENANTS ||--o{ AINBOX_WORKSTREAMS : owns
  TENANTS ||--o{ AINBOX_RULES : scopes
  TENANTS ||--o{ AINBOX_EXCEPTIONS : scopes
  AINBOX_WORKSTREAMS ||--o{ AINBOX_METRICS : measures
  AINBOX_METRICS ||--o{ AINBOX_METRIC_OBSERVATIONS : records
  AINBOX_WORKSTREAMS ||--o{ AINBOX_RULES : defines
  AINBOX_RULES ||--o{ AINBOX_RULE_VERSIONS : versions
  AINBOX_RULES ||--o{ AINBOX_SCAN_RUNS : executes
  AINBOX_RULE_VERSIONS ||--o{ AINBOX_SCAN_RUNS : pins
  AINBOX_RULES ||--o{ AINBOX_EXCEPTIONS : detects
  AINBOX_WORKSTREAMS ||--o{ AINBOX_EXCEPTIONS : groups
  AINBOX_EXCEPTIONS ||--o{ AINBOX_REMEDIATION_PLANS : remediates
  AINBOX_REMEDIATION_PLANS ||--o{ AINBOX_REMEDIATION_STEPS : contains
  AINBOX_EXCEPTIONS ||--o{ AINBOX_COMMUNICATIONS : communicates
  AINBOX_COMMUNICATIONS ||--o{ AINBOX_COMMUNICATION_VERSIONS : approves
  AINBOX_EXCEPTIONS ||--o{ AINBOX_ACTIVITY_EVENTS : audits
  AINBOX_SCAN_RUNS ||--o{ AINBOX_ACTIVITY_EVENTS : produces

  TENANTS {
    uuid id PK
  }
  AINBOX_WORKSTREAMS {
    uuid id PK
    uuid tenant_id FK
    uuid owner_id
    text name
    text status
    text desired_outcome
    text health_status
  }
  AINBOX_METRICS {
    uuid id PK
    uuid tenant_id FK
    uuid workstream_id FK
    text metric_key
    text direction
    numeric target_value
  }
  AINBOX_METRIC_OBSERVATIONS {
    uuid id PK
    uuid tenant_id FK
    uuid metric_id FK
    timestamptz observed_at
    numeric value
    text quality_status
  }
  AINBOX_RULES {
    uuid id PK
    uuid tenant_id FK
    uuid workstream_id FK
    uuid current_version_id
    text rule_key
    text evaluator_type
    boolean enabled
    int scan_interval_minutes
  }
  AINBOX_RULE_VERSIONS {
    uuid id PK
    uuid tenant_id FK
    uuid rule_id FK
    int version_number
    jsonb configuration
    text configuration_hash
  }
  AINBOX_SCAN_RUNS {
    uuid id PK
    uuid tenant_id FK
    uuid rule_id FK
    uuid rule_version_id FK
    text trigger_type
    text status
    int evaluated_count
    int violation_count
    int unknown_count
  }
  AINBOX_EXCEPTIONS {
    uuid id PK
    uuid tenant_id FK
    uuid workstream_id FK
    uuid rule_id FK
    uuid rule_version_id FK
    text source_type
    text source_parent_id
    text source_id
    text source_key
    uuid assignee_id
    text status
    timestamptz snoozed_until
    timestamptz resolved_at
    numeric priority_score
    jsonb evidence
  }
  AINBOX_REMEDIATION_PLANS {
    uuid id PK
    uuid tenant_id FK
    uuid exception_id FK
    text status
    int revision
    jsonb approved_snapshot
  }
  AINBOX_REMEDIATION_STEPS {
    uuid id PK
    uuid tenant_id FK
    uuid plan_id FK
    int sequence
    text description
    timestamptz completed_at
  }
  AINBOX_COMMUNICATIONS {
    uuid id PK
    uuid tenant_id FK
    uuid exception_id FK
    text recipient
    text subject
    text body
    text status
    int current_version
  }
  AINBOX_COMMUNICATION_VERSIONS {
    uuid id PK
    uuid tenant_id FK
    uuid communication_id FK
    int version_number
    timestamptz approved_at
  }
  AINBOX_ACTIVITY_EVENTS {
    uuid id PK
    uuid tenant_id FK
    uuid exception_id FK
    uuid scan_run_id
    uuid actor_id
    text event_type
    timestamptz occurred_at
  }
```

## Cross-tenant integrity

Each Action Inbox table has a `tenant_id`. Parent-child relationships use composite `(tenant_id,id)` references where defined, and the tables have RLS enabled. Direct browser table privileges are revoked. This is defense in depth, not proof that all RPC paths are safe; negative tests remain necessary.

## External source references

Work Board items are nested in `boards.data` JSONB and are referenced logically by board ID and item ID, not a physical item FK. Knowledge articles and portfolio initiatives are similarly referenced through `source_type`, `source_parent_id`, `source_id` and `source_key`; these references require adapter-level validation and source-specific access checks. Do not infer referential enforcement from the diagram.

## Lifecycle and uniqueness

The intended invariant is one unresolved exception per tenant, rule and canonical source key. Verified compliance sets `resolved_at` and allows a future violation to open a new occurrence. A dismissed exception remains unresolved until compliance is verified. Snooze is a timestamp overlay rather than a separate status.

## Schema sources

- `supabase/migrations/20261123_01_ainbox_foundation.sql`
- `supabase/migrations/20261123_03_ainbox_auth_rpc.sql`
- `supabase/migrations/20261123_04_ainbox_rules_engine.sql`
- `supabase/migrations/20261123_08_ainbox_workflows.sql`
- `supabase/migrations/20261123_09_ainbox_remediation.sql`
- `supabase/migrations/20261123_11_ainbox_item_done_status.sql`
