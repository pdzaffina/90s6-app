# ADR 0003: Separate organization roles, resource permissions and feature entitlements

**Status:** Proposed (documents existing implementation)

## Context
Global administrators, organization administrators, superusers and ordinary users require different powers. Organization-level application availability and per-member access differ from permissions to edit an individual board or portfolio.

## Decision
Keep global administrator status in `profiles`, organization roles in `tenant_members`, feature entitlements in `tenant_feature_access` and `tenant_user_feature_access`, and resource-level memberships in the relevant board/portfolio membership tables. Enforce privileged changes on the backend. Use browser checks for presentation only.

## Consequences
- **Positive:** Granular access without multiplying global roles.
- **Negative:** Effective permission calculation spans several dimensions and can drift across pages.
- **Follow-up:** Centralize effective-access tests, including inactive membership, disabled profiles and global administrator delegation.
