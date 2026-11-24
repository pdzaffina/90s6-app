# Architecture Decision Records

We use Michael Nygard's lightweight ADR structure: **Title, Status, Context, Decision, Consequences**. Number decisions sequentially. Never silently rewrite an accepted decision; supersede it with a new ADR and cross-link both.

These initial records describe decisions inferred from the repository and should be reviewed by maintainers before being marked Accepted.

- [0000 Record architecture decisions](0000-record-architecture-decisions.md)
- [0001 Supabase backend](0001-use-supabase-as-backend.md)
- [0002 Multi-tenant isolation](0002-multi-tenant-data-isolation.md)
- [0003 Role and feature authorization](0003-role-and-feature-authorization.md)
- [0004 JSONB work boards](0004-jsonb-work-board-model.md)

## Action Inbox decisions

- [0005 Exception-oriented design](0005-action-inbox-exception-oriented-design.md)
- [0006 Typed source contracts and Unknown](0006-action-inbox-source-contracts.md)
- [0007 Tenant and source authorization](0007-action-inbox-tenant-security.md)
- [0008 Explicit-record reconciliation](0008-action-inbox-reconciliation.md)
- [0009 Item-level Done status](0009-action-inbox-item-status-completion.md)
- [0010 Versioned rules and scan operations](0010-action-inbox-rule-versions-and-operations.md)

## Backend portability

- [0011 Portable SQLite backend](0011-portable-sqlite-backend.md)
