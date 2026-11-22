-- SAFE ROLLBACK / RELEASE STOP: preserves all Action Inbox records.
-- Run this first if a production issue occurs.
begin;
update public.tenant_feature_access set enabled=false,updated_at=now() where feature='action_inbox';
update public.ainbox_rules set enabled=false,next_scan_at=null,updated_at=now() where enabled;
-- Stop scheduled job separately if one has been installed.
commit;
-- To fully remove the feature and its history, use 20261123_ainbox_full_rollback.sql
-- only after taking a backup and accepting loss of Action Inbox data.
