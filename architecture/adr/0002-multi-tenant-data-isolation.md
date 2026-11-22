# ADR 0002: Use shared-schema organization tenancy with database-enforced isolation

**Status:** Proposed (documents existing migration direction)

## Context
A user may participate in several customer organizations, while boards, portfolios and organization permissions must remain separate. Browser-selected tenant context is not a trustworthy security boundary.

## Decision
Represent organizations in `tenants`, membership in `tenant_members`, and ownership via tenant identifiers on resources. Enforce access with RLS and guarded SQL functions that verify active membership and applicable roles. Prevent unauthorized changes to resource tenant ownership. Use additive migrations and explicit cutover checks.

## Consequences
- **Positive:** Shared infrastructure and manageable multi-organization membership.
- **Negative:** Every table, RPC, import/export path and public sharing surface must be reviewed for tenant leakage.
- **Follow-up:** Maintain cross-tenant negative tests and reconcile all legacy resource rows.
