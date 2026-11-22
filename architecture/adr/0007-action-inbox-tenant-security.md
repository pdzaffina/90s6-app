# ADR 0007: Guard Action Inbox through tenant, feature and source authorization

**Status:** Accepted, reflects implemented design; operational verification remains as noted

**Date:** 2026-11-22

## Context
Action Inbox aggregates records from multiple tenant-scoped apps. Assignment and administrative roles can otherwise expose records outside a user's source permissions.

## Decision
Enable RLS on all ainbox_* tables, revoke browser direct table grants and use guarded RPC projections. Validate active tenant membership, feature entitlements, management role and source-record access independently. Assignment never grants source access.

## Consequences
Protects cross-tenant and source-specific boundaries, at the cost of more RPC checks and negative test coverage.

## Alternatives considered
Relying on hidden navigation, tenant IDs supplied by the browser or assignee identity alone is insufficient.

## References
- [RFC-002](../RFC-002-action-inbox-architecture.md)
- [Action Inbox system architecture](../action-inbox-system.md)
- [Action Inbox ERD](../action-inbox-erd.md)
