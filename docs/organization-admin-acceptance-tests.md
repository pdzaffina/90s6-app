# Organization administration acceptance tests

Release gate: run these against deployed frontend and authenticated Supabase sessions. Do not treat code review as a passing test.

## Global administration
- [ ] Global Admin sees scope selector with Global and all organizations.
- [ ] Selecting an organization opens only that organization's members and roles.
- [ ] Global Admin can create an organization and assign its initial tenant administrator.
- [ ] Tenant Admin sees only their permitted organization administration, never global account controls.
- [ ] Ordinary User and Superuser cannot access administration RPCs or admin pages.

## CSV import
Header: `email,full_name,password,role,active,organization`.
- [ ] Downloaded template includes an organization slug and a global example.
- [ ] Existing user in tenant A with active=N becomes inactive in A but remains active in B.
- [ ] Existing user with active=Y can be reactivated in A without modifying B.
- [ ] New user with organization slug receives membership in that tenant only.
- [ ] New user with role tenant_admin can manage only their tenant.
- [ ] Global admin row with organization=global can disable the global account.
- [ ] Reject role=admin with a tenant slug and reject role=user with organization=global.
- [ ] Reject unknown, inactive or malformed organization slugs.
- [ ] Same email may appear once per organization in the same CSV; repeated email+organization is rejected.
- [ ] CSV preview never displays passwords; audit logs never include passwords.
- [ ] Failed membership creation reports partial provisioning and does not silently claim success.
- [ ] Tenant Admin cannot grant Global Admin role or disable global account.

## Isolation
- [ ] Tenant A user cannot read or edit tenant B boards, portfolios, files, content or profile directory.
- [ ] Portfolio children and public board links preserve intended access.
- [ ] Disabled global accounts cannot access tenant data.
- [ ] Test real browser sessions, including tenant switching and token refresh.

## Deployment
- [ ] Edge Function version and frontend code deployed together.
- [ ] Existing Work Board, Portfolio Management, onboarding, training, Content Studio, audit and CSV features pass regression checks.
