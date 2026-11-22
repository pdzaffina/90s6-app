# ADR 0001: Use Supabase for identity and application persistence

**Status:** Proposed (documents existing implementation)

## Context
The product requires authentication, relational persistence, tenant-scoped authorization and selected privileged administrative operations. Maintaining a bespoke identity service and database API would increase implementation and operating overhead.

## Decision
Use Supabase Auth for identity, Supabase PostgreSQL for application data, PostgreSQL RLS and guarded functions for authorization, Supabase Storage where needed, and Edge Functions for privileged workflows such as admin user management. The browser uses the public client configuration only.

## Consequences
- **Positive:** Common identity, managed database capabilities, SQL migrations and integrated access policies.
- **Negative:** Backend coupling to Supabase conventions; SQL/RLS discipline is essential; migration and operational configuration must be managed.
- **Follow-up:** Validate deployed configuration, backups, service-key handling and function permissions.
