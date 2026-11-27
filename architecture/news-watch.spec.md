# News Watch / Sentinel feature specification

## Purpose
Monitor external developments about companies, events and topics, assess business impact and recommend accountable human action. News Watch is the UI; Sentinel is a reusable background service.

## Functional requirements
- Unified nested navigation: Overview, Watchlist, Intelligence, Assessments, Scan History, Settings.
- Organization-defined categories, initially Suppliers, Competitors, Customers, Technology, Regulatory, Industry, Events and Custom.
- Watches: name (required), type (company/event/topic), category, ticker/exchange, official website, vendor ID, criticality, objective, include/exclude terms, owner, visibility (private/shared), active flag, distribution list and schedule. Optional company enrichment must cite sources and require confirmation of uncertain matches.
- On-demand and scheduled scans (6 hours, daily, weekly, monthly), queued with bounded concurrency, retries, idempotency, quotas and audit. No overlapping runs per watch. Record coverage, failures and last successful scan.
- Provider-independent collection: configured web/news search APIs, RSS/Atom, official newsrooms and regulatory sources. Never claim exhaustive web coverage. Normalize URLs and deduplicate evidence. Treat retrieved text as untrusted; prevent SSRF and prompt injection; keep secrets server-side.
- Persist evidence with title, URL, source, publication/retrieval dates and excerpt. AI assessment must cite evidence IDs, explain relevance, changes since previous assessment, risk direction, impact, confidence, time horizon, opportunities and recommended actions. Distinguish no material change from failed/incomplete collection. Never automatically modify vendor risk.
- Assessment history, stale indicators, feedback, executive briefings and manual reassessment without retrieval. Purple AI-generated labels and light blue AI action controls.
- Email Assessment button uses encoded mailto subject/body/To/CC, concise plain text, source links and authenticated deep link. Organization defaults with watch overrides; user reviews and sends. Copy fallback for URL length/client limitations.
- Bulk import Excel XLSX and CSV: downloadable template, column mapping, defaults, preview, validation, duplicate skip/update, optional enrichment, approval, import summary and optional queued initial scan. Name only required. Columns: name, type, category, ticker, exchange, website, vendor ID, criticality, objective, frequency, owner, email recipients, active. Preserve vendor IDs as strings. Validate ownership and categories server-side. Do not execute spreadsheet formulas; cap file size and rows. Audit imports; support export and bulk scan/category/frequency/criticality/owner/distribution/enable/archive.
- Optional permission-aware integrations: Action Inbox material exceptions, Relationships company links, Work Boards accepted recommendations, Portfolio and Knowledge Base. No cross-tenant leakage.

## Architecture and administration
Register News Watch in centralized app registry and organization/user access. Global admin configures provider credentials, limits, AI feature toggles/model/timeouts/tokens and usage audit. Org admins manage categories, defaults and access. Users manage authorized watches. Global disable stops relevant execution. Use existing database abstraction and versioned migrations; maintain Terraform parity for deployment configuration.
Logical entities: sentinel_categories, sentinel_watches, sentinel_sources, sentinel_schedules, sentinel_scan_runs, sentinel_articles, sentinel_findings, sentinel_assessments, sentinel_recommendations, sentinel_watch_access, sentinel_import_runs. Tenant isolation and owner/shared authorization enforced server-side and in RLS where applicable. Scheduler uses least privilege and validates current access. Retain history and soft archive.
## Acceptance criteria
1. Authorized user creates and edits all watch types; unauthorized users cannot access records or trigger scans.
2. XLSX/CSV import handles quoted fields, leading-zero vendor IDs, duplicates, invalid rows and mapping; preview does not write records.
3. Configured providers return attributable evidence; unavailable providers produce explicit partial/failure status.
4. Scheduled and manual scans share queue, quotas and deduplication; repeat scans do not duplicate evidence.
5. AI outputs validated against evidence and persisted; disabled AI is hidden and blocked server-side.
6. Email button opens a populated draft; no automatic send; copy fallback works.
7. Responsive navigation, app access, audit, migration and deployment tests pass before production merge.

## Delivery
Foundation, import, collection, AI, scheduling, dashboard and integrations. Search provider credentials are deployment prerequisites; no fabricated live results. Feature branch until verified.

## Search provider decision (2026-11-26)
GDELT DOC API is the default keyless news discovery provider. Brave is optional and selected only through SENTINEL_SEARCH_PROVIDER=brave plus its secret. GDELT returns indexed article metadata, not full text. Default lookback is seven days; requests are paced. RSS and governed Nemotron tool calling are follow-on work. Do not treat empty coverage as proof of no risk.

## Verified production baseline (2026-11-27)

- GitHub main at `ea87a1efc13c7d896b03f3069dd73320ccb5aa2f` includes the native worker, Cron dispatch, removal of the GitHub runtime, governed assessment generation, and formatted Markdown reports.
- Production had Sentinel worker version 3, four Sentinel-related migrations, and an active every-minute `sentinel-edge-worker` Cron job. Cron recorded 60 successful SQL dispatches in the checked hour. SQL dispatch success alone does not establish Edge Function success.
- Across 11 production scans, nine were complete, one partial, and one failed. Six complete scans had stored AI assessments. The assessment path exists in both main and the production database. Further end-to-end testing is required to distinguish model, authorization, budget, and collection outcomes.
- The existing six Node tests cover the retired worker's provider and configuration behavior. They do not exercise the production Edge Function or database.

## Implementation checklist

| Phase | Current scope and remaining verification |
| --- | --- |
| 0 | Main, production schema and migrations, Cron, assessment counts, and local test baseline inspected. Full deployed-source and log comparison pending. |
| 1 | Queue eligibility checks, tenant-aware ordering, immediate manual dispatch, pending scan refresh. Shared provider throttling, deferred retries, and lease recovery added. Detailed stages, monitoring, and scheduled and cross-tenant end-to-end tests pending. |
| 2 | Existing Google News RSS and GDELT fallback. Modular providers, watch configuration, SEC, configured feeds, and cross-scan normalization pending. |
| 3 | Existing single governed assessment and Markdown renderer. Bounded investigation, structured citations, independent AI features, and model and mobile verification pending. |
| 4 | Existing per-run assessment history. Structured risk and longitudinal comparison pending. |
| 5 | Existing manual email and copy. Threshold alerts, digests, preferences, acknowledgment, and assessment deep links pending. |
| 6 | Existing application registry and access controls. Integration implementation and permissions tests pending. |
| 7 | Existing CSV import with basic duplicate detection. Native XLSX, mapping, and bulk management pending. |
| 8 | Existing watch overview. Executive intelligence metrics, filters, trends, and briefing generation pending. |

### Queue operations and rollback

`20261127_01_sentinel_queue_eligibility.sql` updates the existing RPCs in place. New manual scans trigger the same private, single-use Cron dispatch function. The minute Cron cadence remains available to process pending jobs. The worker cancels queued scans when watch, user, organization, or application access is withdrawn. Scheduled candidates are interleaved by organization and collected in batches of 50. Claims favor organizations whose jobs were least recently started. The existing unique pending-watch index and row locking still enforce one pending scan per watch.

To roll back, restore the prior definitions of `public.sentinel_queue(uuid)` and `public.sentinel_claim()` from migrations `20261126_01_news_watch.sql` and `20261126_02_sentinel_worker.sql` in a new migration using `create or replace`. The additive indexes and private helper can remain. Revert the matching News Watch UI commit and redeploy GitHub Pages if the issue is in polling or status presentation. Scan history remains available.

### Provider retries and verification

The managed runtime checks GDELT first and uses Google News RSS when GDELT fails. A fallback scan is marked Partial. PostgreSQL coordinates request spacing across workers, with a six-second minimum between GDELT requests and two seconds for Google News RSS. A 429 extends the shared cooldown. If both providers fail and either failure is transient, the scan is deferred with exponential backoff and jitter for up to four total attempts. HTTP Retry-After is honored up to 24 hours. Expired worker leases become retryable, and attempts can save results only while their own lease remains current. Evidence is checkpointed before the AI request.

After the queue eligibility migration, a production manual smoke scan started in 0.24 seconds, completed with eight sources, and stored an AI assessment. Worker claim and token RPC grants were checked, and a tokenless production request returned HTTP 401.

To roll back retries, redeploy the worker from commit `7e67e9cfbb875be2f1d8821b4699fcde81d9551e` and restore the claim function and original private dispatch function in a forward migration. Additive retry columns and private cooldown data may remain. Any queued retry will become eligible under the restored claim semantics.
