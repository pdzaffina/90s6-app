# RFC-002: Action Inbox exception detection and remediation architecture

- **Status:** Implemented baseline with open operational gaps
- **Date:** 2026-11-22
- **Scope:** Action Inbox at `app.90s6.com/action-inbox/`
- **Supersedes:** None. Complements [RFC-001](RFC-001-platform-architecture.md).
- **Sources:** `action-inbox/`, `supabase/migrations/20261123_01_ainbox_foundation.sql` through `20261123_11_ainbox_item_done_status.sql`, and existing Work Board, Knowledge Base and Portfolio implementations.

## Summary and problem

Action Inbox is an exception-oriented execution surface for the multi-tenant 90s6 platform. It evaluates business rules against source applications, creates actionable exceptions, supports owner-guided remediation and communication, and resolves exceptions only after explicit verification of source compliance. It is **not** a replacement task manager. Users retain responsibility for changing source records in their owning application.

## Goals

1. Detect overdue work, stale Knowledge Base drafts and unprioritized active portfolio initiatives.
2. Prioritize business exceptions and assign actionable ownership within an authorized organization.
3. Provide **My Actions**, authorized **All Exceptions**, workstream context, Business Rules administration, and a detail panel for remediation, communication and activity.
4. Preserve auditability, immutable rule versions, and an explicit distinction between remediation progress and verified compliance.
5. Enforce tenant, feature, member and source-record authorization on the server.
6. Treat missing or unreliable evidence as **Unknown**, never as proof of compliance.
7. Allow a reversible, controlled production rollout.

## Non-goals

- Automatically modifying Work Board, Knowledge Base or Portfolio records.
- Automatically delivering email or chat messages.
- Using a Work Board column to infer item completion.
- Treating assigned ownership as permission to view a source record.
- Claiming that scheduled scans, comprehensive KPI calculation, complete source-specific deep links or end-to-end production security certification are already implemented.

## System context

See [Action Inbox system diagram](action-inbox-system.md) and [Action Inbox ERD](action-inbox-erd.md). The browser uses the shared 90s6 session/tenant shell and Supabase client. Public, authenticated, guarded PostgreSQL RPCs perform authorized reads and writes; a privileged SQL evaluator and reconciliation routine maintain scan and exception state. The present UI invokes scans manually. `scan_interval_minutes` and `next_scan_at` exist as configuration, but **a reliable autonomous scheduler has not been verified as deployed**.

## Source contracts

| Rule | Source | Violation | Compliant | Unknown |
| --- | --- | --- | --- | --- |
| WORK-001 | `boards.data` work items | Valid past due date, status not Done | Done, future/current due date, or no due date | Invalid date, missing source identity, unsupported status or malformed board data |
| KB-002 | `knowledge_articles` | Tenant-scoped, non-archived Draft older than configured calendar-day threshold | Published/non-Draft or archived; Draft within threshold | Historical Draft with no trustworthy `draft_entered_at` |
| PORT-003 | `pm_initiatives` | Eligible active initiative lacking audited assessment completion or agreed rank | Eligible active initiative with both | Source evidence that cannot be safely classified |

**WORK-001 decision update:** The work item's own `status` is authoritative. `Done` is complete, `To Do` and `In Progress` are incomplete. Legacy missing status is treated as To Do by the current evaluator. Board layout completion-column flags are no longer required. The due-date comparison uses the rule's configured IANA time zone.

**KB-002 decision:** Existing Draft rows without a reliable Draft entry timestamp remain Unknown until a trustworthy baseline exists. Edits do not restart Draft age; a later Draft transition establishes a new entry timestamp.

**PORT-003 decision:** Explicit, audited assessment completion and agreed rank are independent requirements. A weighted score or Strategy Canvas position is not sufficient evidence.

## Logical architecture and data

Twelve `public.ainbox_*` tables implement workstreams, metrics, metric observations, rules, immutable rule versions, scan runs, exceptions, remediation plans, remediation steps, communication drafts, approved communication versions and activity events. All twelve have RLS enabled and browser table grants revoked. Tenant-scoped composite relationships reduce accidental cross-tenant joins. See the ERD for exact names.

Rule versions pin evaluator configuration for a scan. Source adapters produce Violation, Compliant or Unknown. `ainbox_internal.record_result` reconciles **explicitly evaluated records**: Violation creates or refreshes an unresolved occurrence; Compliant resolves an existing occurrence; Unknown leaves it unresolved. Absence from a query is not proof of compliance. A later violation following a verified resolution creates a new occurrence.

Exceptions can be open, in progress, dismissed or resolved, with a separate snooze timestamp. Remediation plans and checklist steps do not resolve an exception. Communications are drafted, approved by version and manually recorded as delivered. Approval alone is not delivery.

## Security and trust boundaries

- **Identity and organization:** Supabase Auth, active profile and membership, organization feature entitlement and per-user feature entitlement.
- **Source authorization:** Work Board membership/ownership, portfolio access and Knowledge Base content-scope policies are checked independently of assignment.
- **Database boundary:** `ainbox_authorized` and `ainbox_source_visible` guard public RPCs. Internal evaluator functions are not browser-callable.
- **Data exposure:** Exception evidence and activity payloads must remain behind sanitized projections and source-specific access checks. A source-inaccessible assignment must not leak source content.
- **Global administration:** Any cross-organization action must validate explicit tenant context.
- **Negative tests required:** Cross-tenant read/write, unauthorized source details, inactive users, feature-disabled users, stale revisions, privilege escalation and malicious rule configuration.

## Operational behavior and status

| Capability | Current implementation | Outstanding verification or work |
| --- | --- | --- |
| Manual Business Rules configuration | Inline editor and versioned configuration RPC | Full validation and configuration-schema hardening |
| Manual scans | Guarded `ainbox_run_rule` RPC | Large-dataset coverage, timeout and retry testing |
| Scheduled scans | Scheduling fields exist | Autonomous scheduler and recovery not verified |
| Exception reconciliation | Explicit Violation/Compliant/Unknown | Complete partial-coverage and concurrency tests |
| Remediation | Plans, approvals and step completion | End-to-end multi-user testing |
| Communication | Draft, approval, manual delivery record | End-to-end authorization and revision testing |
| Workstream health | Health fields and display | Reliable metric observations and deterministic calculation not fully delivered |
| Tenant isolation | RLS enabled, RPC guards | Multi-tenant negative test suite |
| Production rollout | Initial 90s6 organization enabled | Controlled expansion and operational monitoring |

## Deployment and rollback

Schema changes are migration-controlled in `supabase/migrations/`. The production database received Action Inbox migrations during initial rollout. The repository includes `supabase/rollback/20261123_ainbox_disable_preserve_data.sql` as the preferred **non-destructive feature stop** and `supabase/rollback/20261123_ainbox_full_rollback.sql` for a destructive removal requiring a backup and review. `20261123_11_ainbox_restore_column_completion.sql` is a narrowly scoped historical evaluator rollback and **does not represent the current product decision**. Never run destructive rollback without checking the deployed function and schema versions.

## Acceptance criteria

1. WORK-001 flags an overdue To Do/In Progress item, does not flag Done, and handles legacy missing status as To Do.
2. KB-002 preserves Unknown for historical Drafts without trustworthy timestamps.
3. PORT-003 requires both explicit audited assessment completion and agreed rank for active initiatives.
4. Compliant evidence resolves an exception; Unknown or omitted records do not.
5. Assignment never grants source visibility; cross-tenant and feature-disabled requests fail.
6. Remediation completion, communication approval and manual delivery recording do not independently resolve exceptions.
7. Rule changes create immutable versions; only authorized administrators can configure or scan.
8. Safe rollback disables the feature without deleting source records or exception history.

## Architectural decisions

See ADRs [0005](adr/0005-action-inbox-exception-oriented-design.md), [0006](adr/0006-action-inbox-source-contracts.md), [0007](adr/0007-action-inbox-tenant-security.md), [0008](adr/0008-action-inbox-reconciliation.md), [0009](adr/0009-action-inbox-item-status-completion.md), and [0010](adr/0010-action-inbox-rule-versions-and-operations.md). Existing ADRs 0000–0004 remain unchanged.
