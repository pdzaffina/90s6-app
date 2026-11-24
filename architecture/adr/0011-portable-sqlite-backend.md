# ADR 0011: Portable SQLite backend

**Status:** Proposed; implementation branch authorized. Supersedes ADR 0001 only after validated cutover.

## Context
The application currently relies on Supabase identity, PostgreSQL RLS, storage and Edge Functions. We want a lightweight independently deployable backend without changing the user experience.

## Decision
First establish provider-independent domain repository interfaces and a backend API, with Supabase as the initial working adapter. Preserve existing behavior and authorization through this adapter; validate feature parity and tenant isolation before implementing SQLite. No application module may depend directly on provider-specific clients or query builders after this milestone. Define explicit transaction, identity and storage boundaries; do not assume an ORM makes SQL dialects interchangeable.

After the Supabase-backed framework passes its acceptance tests, implement SQLite as a second adapter and run the same repository contract tests against both providers. Select the provider through deployment configuration, never through browser input. Keep Terraform and deployment configuration synchronized at both milestones. Do not remove the working Supabase adapter during SQLite development.

Use a modular TypeScript monolith with a same-origin API, centralized default-deny authorization and tenant-scoped repositories. Use SQLite on persistent local storage with WAL, foreign keys and bounded write transactions. Retain existing UUIDs and JSON document semantics. Do not introduce OPA or another external policy engine. Use an established authentication library; validate identity migration before cutover. Preserve Supabase production until parity and recovery tests pass.

Terraform and deployment changes are part of each implementation increment. Keep pilot state isolated from production, provision persistent storage, restrict network exposure, and never put secrets or database contents in Terraform state. Validate plans before applying; no production apply or cutover is authorized by this ADR.

## Consequences
Application authorization replaces database RLS and must be tested for cross-tenant access, resource permissions, app entitlements and privileged operations. SQLite serializes writes; benchmark representative workloads. Backups must use consistent snapshots and off-host encrypted storage with restore tests. No multi-host shared SQLite file. Keep PostgreSQL portability at repository boundaries while retaining the working Supabase adapter throughout migration; independent PostgreSQL is a future option.
