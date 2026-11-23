# Internal Relationship Management CRM

## Scope
This branch introduces the first working internal CRM slice: customers, associates, engagements, commitments, activities, feedback, relationship-health assessments, a dashboard, and organization configuration. Commercial features remain off by default.

## Deployment prerequisites
1. Apply `supabase/migrations/20261123_15_internal_crm_foundation.sql` in the normal migration sequence.
2. Enable the `crm` application in Global Admin for the intended organization.
3. Assign CRM access to the intended users through existing feature controls.
4. Open `/crm/`. An organization admin or superuser can create records and save configuration; other entitled members can read authorized CRM records.

## Current limitations
- This first slice uses organization admins and superusers for write access. CRM Manager/User/Viewer roles and record ownership permissions need the next authorization migration.
- Customer-to-associate affiliation management is modeled but does not yet have an editor.
- Feedback privacy is not fully implemented: do not enter confidential feedback until record-specific policies exist.
- AI assistance is configured but no CRM AI generation endpoint is implemented yet.
- No integration events are emitted to Action Inbox, Work Boards, or Portfolio Management.
- No CRM import/export, custom stages, automated health scoring, or notification scheduler yet.
- Migrations and browser flows have not been executed against a live Supabase environment.

## Manual verification checklist
- Apply migration to a staging database; verify no SQL errors.
- Confirm CRM is disabled for existing organizations by default.
- Enable CRM for one organization; verify only its members can read data.
- Verify a second organization's users cannot read, create, or modify the first organization's records, including by changing org_id.
- Verify the admin can create and edit customers, associates, engagements, commitments, activities, feedback and health assessments.
- Verify navigation hides disabled internal features and rejects API writes to disabled tables.
- Verify disabling CRM removes navigation and blocks direct URL access.
- Verify forecast cannot be enabled without sales.
- Test mobile navigation, keyboard controls, and dark/light theme.

## Future ADRs
Create numbered ADRs for CRM operating modes, shared contacts, engagement versus opportunity boundaries, authorization, and cross-application integration after reconciling with existing ADR numbering.
