# Multi-tenant release security gate

Status: NOT PASSED. Do not merge or onboard a second tenant until every item passes.

## Authorization matrix
- Global Admin: can list/read/update/manage all tenant boards and portfolios.
- Tenant Admin: can list/read/update/manage all boards and portfolios in own tenant, including resources they did not create.
- Superuser: can create in active tenant, manage own boards/portfolios, and view/edit explicitly shared resources according to resource role.
- User: cannot create or share; can view/edit only explicitly shared resources according to resource role.
- Inactive user, suspended tenant, removed membership: deny all tenant data access.
- Cross-tenant board/portfolio IDs, memberships, invitations, uploads, downloads, and RPC calls: deny.
- Attempts to change tenant_id or owner_id on existing resources: deny unless explicitly authorized via audited transfer workflow.

## Coverage
- boards, board_members, board_invites, board_public_links
- pm_portfolios, pm_portfolio_members, pm_initiatives, pm_organizations, pm_portfolio_orgs, pm_initiative_orgs, pm_scenarios, pm_scenario_items, pm_scenario_history, pm_workshop_settings, pm_audit
- training_courses, training_course_shares, prompt_library_items, knowledge_articles
- profiles, user_feature_access, audit_log
- storage.objects attachment policies; all security-definer functions; admin-users Edge Function
- public board token access: read-only, no attachments, revocable, scoped to board

## Release requirements
1. Seed two isolated test tenants and four role-specific test identities, with a resource owned by another user in each tenant.
2. Run actual authenticated Supabase API calls for each matrix cell, including direct IDs, joins, RPCs, and storage URLs.
3. Run regression checks for board editing, public sharing, portfolio prioritization, training, Content Studio, bulk user import, activation, and tour resets.
4. Confirm original records and membership counts, no null tenant IDs, no orphan relationships.
5. Review Supabase security advisors and remediate unauthorized SECURITY DEFINER exposure.
6. Do not deploy incomplete policy changes or merge until tests pass.
