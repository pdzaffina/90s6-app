# Shared AI service integration

The authenticated browser client `shared/ai-service.js` provides `NinetysixAI.request({supabase, tenantId, app, content})`.

Supported `app` values: `portfolio`, `workboard`, `knowledge`, `content`. The server maps these to independently configured AI components and enforces organization authorization, enabled features, budgets, and audit logging. Do not send service-role credentials from browsers. Do not allow arbitrary model overrides from app users.

Load `/shared/ai-service.js` after Supabase and call with the currently authorized tenant ID and relevant user-visible content. Display `result.text` and, where appropriate, the model, estimated cost, and audit usage ID. The caller must not infer authorization from UI visibility.

This shared client is an integration building block. Each app still needs an explicit user-triggered AI action and context-selection UX before its integration is complete. Do not send sensitive material without checking organizational policy.
