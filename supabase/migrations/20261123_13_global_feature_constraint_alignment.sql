-- Align legacy global user entitlements with the centralized application registry.
-- The prior check omitted portfolio_management even though it is a registered app.
begin;
alter table public.user_feature_access
  drop constraint if exists user_feature_access_feature_check;
alter table public.user_feature_access
  add constraint user_feature_access_feature_check
  check (feature in (
    'action_inbox', 'portfolio_management', 'work_board', 'training',
    'prompt_library', 'content_studio', 'studio_courses', 'studio_prompts',
    'studio_knowledge', 'knowledge_base', 'use_case_curator'
  ));
commit;
