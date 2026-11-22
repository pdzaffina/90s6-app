# Action Inbox AI assessment: NVIDIA GPT-OSS 20B

Action Inbox uses a server-side Supabase Edge Function at `supabase/functions/ainbox-ai-assessment/index.ts`. The LLM supplements, but does not replace, deterministic rule scans and health classification.

## Required Supabase Edge Function secrets

| Secret | Value |
| --- | --- |
| `AINBOX_LLM_API_KEY` | NVIDIA Build API key. Never commit or paste it into chat. |
| `AINBOX_LLM_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `AINBOX_LLM_MODEL` | `openai/gpt-oss-20b` |

The function defaults to the above URL and model when the corresponding optional secrets are missing. The API key is mandatory. Configure secrets in Supabase Dashboard > Edge Functions > Secrets.

## Request and scope

The browser calls `sb.functions.invoke('ainbox-ai-assessment', {body:{tenant_id,workstream_id}})`. The Edge Function requires a user JWT, validates the user through Supabase Auth, then uses the caller's JWT to call the guarded `ainbox_get_workstreams` and `ainbox_get_actions` RPCs. It does **not** use the service-role key. No raw evidence or article text is forwarded.

The initial scope is **assigned, source-accessible exceptions for the current user**, not an organization-wide assessment. The function aggregates active/high-priority/in-progress counts and counts by rule. It does not assert scan coverage. This restriction is intentional until an explicitly scoped, authorized organization-wide AI evidence endpoint is built.

## Provider call

OpenAI-compatible `POST /chat/completions`, model `openai/gpt-oss-20b`, 20-second timeout, 300 maximum output tokens, temperature 0.2. The UI shows an error while retaining the deterministic assessment if the provider is unavailable. The AI output is advisory and not stored in the database.

## Security and testing

- Only HTTPS endpoints are accepted. **Before allowing tenant-managed endpoint URLs**, implement a strict provider host allowlist to prevent server-side request forgery.
- Do not put the API key in browser JavaScript or GitHub.
- Keep per-user invocation and rate limiting, spend controls, stronger structured-output validation and audit telemetry on the follow-up security checklist.
- Verify end-to-end with a real authenticated user after the secrets have been installed. Deployment of the Edge Function alone does not verify NVIDIA credentials.
- The existing deterministic health assessment is the fallback and remains authoritative.
