# RFC-001: 90s6 unified application platform architecture

- **Status:** Proposed documentation baseline
- **Date:** 2026-11-21
- **Scope:** Whole 90s6 App project
- **Decision authority:** Project maintainers

## Summary
90s6 is a multi-organization application connecting learning, knowledge capture, custom planning, portfolio prioritization and work execution. This RFC records its purpose, current architectural direction and required guardrails for continued evolution. It does not retroactively assert approval of every implementation choice.

## Problem
Organizations scatter training, reusable knowledge, planning, prioritization and execution across disconnected tools. Context is lost and decisions are hard to trace. 90s6 provides a common workspace while supporting independent customer organizations and differentiated access.

## Goals
1. Provide coherent navigation and sign-on across the product modules.
2. Allow users to belong to multiple organizations without data leakage.
3. Enforce global admin, organization admin, superuser and member capabilities at the server boundary.
4. Control application availability per organization and per member.
5. Support work boards, WBS views, portfolio scoring and resource comparison.
6. Enable authorized content creation and reusable training, prompts and knowledge.
7. Support auditable administration, data export/import and carefully limited public sharing.
8. Keep the platform maintainable with migrations, tests, documentation and ADRs.

## Non-goals
- A single shared dataset visible to all tenants.
- Browser-only access controls.
- Guaranteed real-time synchronization across every module.
- A fully normalized work-item model without a separate migration decision.
- Claims about production availability, compliance certification or disaster recovery without verification.

## Existing architectural direction
The repository uses a browser-based JavaScript application with a shared shell and Supabase backend. Supabase Auth manages identity; PostgreSQL stores application data and enforces RLS; guarded RPCs and an administrative Edge Function implement privileged operations. Tenant-scoped data and feature grants are being introduced via additive migrations and cutovers. See [system architecture](system-architecture.md) and [ERD](data-model-erd.md).

## Requirements and acceptance criteria
| Area | Requirement | Evidence / acceptance |
| --- | --- | --- |
| Identity | Authenticate users and disable access when inactive | Disabled users cannot reach protected data |
| Tenant isolation | Scope every resource operation to authorized tenant | Cross-tenant negative tests for read/write/export |
| Roles | Separate global, organization and resource-level permissions | Server-side checks for every privileged operation |
| Feature access | Organization and member overrides | UI and database behavior agree |
| Data | Preserve work board and portfolio state | Import/export round-trip tests |
| Public sharing | Read-only, scoped, revocable links | Anonymous write attempts fail |
| Administration | Safe bulk changes and meaningful audit | Authorization, validation and audit tests |
| Operations | Reproducible migrations and rollback planning | CI validation and migration review |

## Security and privacy
Treat the browser as untrusted. Validate access in PostgreSQL RLS and security-definer functions, with carefully restricted EXECUTE grants. Verify tenant membership is active, tenant is active and profile is enabled. Do not put privileged Supabase keys in client assets. Guard bulk imports, invitations, public links and cross-tenant resource moves. Document retention and recovery once configured.

## Alternatives and tradeoffs
- Separate backend API: more control over domain logic but adds operations and latency; not required for every current CRUD path.
- Fully normalized board items: stronger relational querying but larger migration and UX compatibility costs.
- One database per tenant: stronger physical separation but significantly more operational complexity.
The chosen direction is a shared Supabase/PostgreSQL backend with explicit tenant isolation, subject to ongoing security verification.

## Risks
- RLS regressions during migrations.
- Inconsistent feature checks between shell, pages and database.
- JSONB update conflicts and limited fine-grained querying.
- Public share links exposing more than intended.
- Schema drift between deployed database and repository.
- Administrative operations lacking sufficient audit detail.

## Implementation and verification plan
1. Inventory all tables, functions, policies, storage buckets and deployment configuration.
2. Reconcile migrations with the live schema and expand the ERD.
3. Run tenant isolation and privilege escalation regression tests, including disabled/inactive users.
4. Test content and board/portfolio exports and imports for integrity.
5. Add CI checks for Mermaid/Markdown links and database migration validation.
6. Record future material architectural choices in `architecture/adr`.

## Open questions
- What are the authoritative production hosting, backup, recovery and observability configurations?
- Which content entities are global versus organization-scoped?
- What are the expected portfolio/work-board scale and concurrency requirements?
- What is the desired public-link expiration/revocation policy?

## References
[Architecture overview](README.md) | [System diagram](system-architecture.md) | [ERD](data-model-erd.md) | [ADRs](adr/README.md)
