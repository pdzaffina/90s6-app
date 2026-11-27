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
| 1 | Queue eligibility checks, tenant-aware ordering, immediate manual dispatch, pending scan refresh. Shared provider throttling, deferred retries, and lease recovery added. Collection and assessment stages and Global Admin operations panel added. Investigation stage and scheduled and cross-tenant end-to-end tests pending. |
| 2 | GDELT, Google News RSS fallback, configurable RSS/Atom, query terms, lookback, and watch-scoped canonical evidence implemented. SEC EDGAR adapter and CIK watch field added. Production preferred-feed and SEC verification, expanded entity context, source verification, and syndicated-content grouping pending. |
| 3 | Governed assessment supports structured, citation-validated output and legacy Markdown. Bounded deep planning and follow-up share the existing AI budget and audit. Independent risk-classification and briefing features and deep mobile verification pending. |
| 4 | Per-run history, structured risk with independent severity and confidence, relationship-aware assessment, and category comparison added. Corroboration, resolution, and change validation pending. |
| 5 | Threshold alerts, daily and weekly in-app digests, recipient preferences, acknowledgment, manual email with CC, and assessment deep links implemented. End-to-end digest and alert acceptance tests pending. |
| 6 | CRM and Portfolio link records, Work Board task drafting, and Knowledge Base drafts added through existing authorization. Action Inbox and end-to-end integration checks pending. |
| 7 | CSV/XLSX preview, interactive mapping, validation, duplicate skip/update, defaults, selected-watch management, audit, and throttled initial scans implemented. Optional AI enrichment pending. |
| 8 | Coverage, freshness, collection health, risk counts, risk history, recommendations, and dashboard filters implemented. Executive AI briefing and broader history aggregation pending. |

### Queue operations and rollback

`20261127_01_sentinel_queue_eligibility.sql` updates the existing RPCs in place. New manual scans trigger the same private, single-use Cron dispatch function. The minute Cron cadence remains available to process pending jobs. The worker cancels queued scans when watch, user, organization, or application access is withdrawn. Scheduled candidates are interleaved by organization and collected in batches of 50. Claims favor organizations whose jobs were least recently started. The existing unique pending-watch index and row locking still enforce one pending scan per watch.

To roll back, restore the prior definitions of `public.sentinel_queue(uuid)` and `public.sentinel_claim()` from migrations `20261126_01_news_watch.sql` and `20261126_02_sentinel_worker.sql` in a new migration using `create or replace`. The additive indexes and private helper can remain. Revert the matching News Watch UI commit and redeploy GitHub Pages if the issue is in polling or status presentation. Scan history remains available.

### Provider retries and verification

The managed runtime checks GDELT first and uses Google News RSS when GDELT fails. A fallback scan is marked Partial. PostgreSQL coordinates request spacing across workers, with a six-second minimum between GDELT requests and two seconds for Google News RSS. A 429 extends the shared cooldown. If both providers fail and either failure is transient, the scan is deferred with exponential backoff and jitter for up to four total attempts. HTTP Retry-After is honored up to 24 hours. Expired worker leases become retryable, and attempts can save results only while their own lease remains current. Evidence is checkpointed before the AI request.

After the queue eligibility migration, a production manual smoke scan started in 0.24 seconds, completed with eight sources, and stored an AI assessment. Worker claim and token RPC grants were checked, and a tokenless production request returned HTTP 401.

To roll back retries, redeploy the worker from commit `7e67e9cfbb875be2f1d8821b4699fcde81d9551e` and restore the claim function and original private dispatch function in a forward migration. Additive retry columns and private cooldown data may remain. Any queued retry will become eligible under the restored claim semantics.

### Administration and troubleshooting

Global Admin → Sentinel operations shows queue depth, oldest pending scan, recent completion and failure counts, average execution duration, retry counts, audited AI failures, and observed provider status. Refresh to retrieve current metrics. Failed or missing collection is displayed separately from the assessment. A Partial scan can still contain evidence and a valid AI assessment.

After deploying the retry-capable worker, a production manual scan began in 0.35 seconds and stored eight sources with a governed AI assessment. GDELT was unavailable and the scan correctly finished Partial using Google News RSS. A second submission while that scan was active returned no duplicate run, and a transaction-scoped cooldown check denied a GDELT slot during the cooldown.

The operations migration is additive. Reverting the related UI commit hides the panel. The preceding worker version runs without provider result logging. Keep the restricted metrics RPC and columns in place during a frontend or worker rollback.

### Provider interfaces and evidence

Providers return bounded normalized evidence for a watch. GDELT and Google News use the watch name, up to three comma-separated alternate names, required and excluded terms, and lookback days. A watch can also have one preferred RSS or Atom feed. Global operations may authorize trusted feed hostnames with the Edge Function setting `SENTINEL_FEED_HOSTS`. The worker requires an exact approved HTTPS hostname, excludes credentialed URLs and nonstandard ports, rejects redirects and XML external-entity declarations, and limits response size. Use the final feed URL when approving a feed. Corporate or investor-relations feeds must be approved individually before they can provide coverage.

The private evidence table is keyed by organization, watch, and a SHA-256 fingerprint of the canonical URL. The checkpoint preserves the first observation while retaining run-level evidence and visible recently collected versus previously collected labels. URLs and publication timestamps are normalized, and attribution is retained. Historical pre-index assessments and evidence remain readable. A URL match identifies previously indexed evidence for that watch. Cross-publisher syndication and coverage before indexing are outside that measure.

The evidence migration is additive. To roll back the provider changes, deploy the preceding worker and revert the matching UI changes. Retain indexed evidence and watch configuration columns. Keep the service-only checkpoint and context RPCs available for any in-flight invocation.

### SEC collection and structured assessments

For a U.S. reporting watch, enter its verified SEC CIK. The worker calls the fixed SEC EDGAR submissions endpoint and indexes selected material forms as regulatory evidence. Production EDGAR requests require `SENTINEL_SEC_USER_AGENT` with the organization name and a monitored contact email. The adapter reports partial coverage when that configuration is missing. Each public feed and EDGAR use the provider gate independently.

The existing Sentinel assessment feature still owns the model, budget and audit. It now requests versioned structured assessment content, validates every source reference against the evidence passed to the model, and stores history per scan. Reports label the kind of development and display confidence independently from severity. Recommendations are advisory. Compared assessments show changes in risk categories, severity and confidence, without interpreting an omitted risk as resolved. Short links in manual email and copy resolve through the signed-in user's existing watch permissions. Historic Markdown remains readable.

To roll back structured assessments, restore the earlier `sentinel_ai_begin` definition and worker. Keep the newer report renderer deployed to display historical structured reports. The CIK and relationship columns are additive and may remain.

### Notifications and executive dashboard

News Watch → Notifications shows in-app alerts and digests scoped to the signed-in recipient and organization. Watch owners may opt into a severity threshold and control alerts and digest cadence per organization. Alerts require newly indexed cited evidence and an emerging or worsening risk. Notification keys prevent duplicate delivery from a scan. Daily digests and Monday weekly digests summarize finished scans at 14:00 UTC. Email remains a reviewed manual action with watch distribution recipients, CC, an executive summary, sources, and an authenticated link. No external delivery service is required.

Overview uses the latest structured assessment per watch in the selected period for risk and trend views. It shows coverage, freshness, collection health, developments, and advisory actions. The browser uses the 200 most recent accessible scan records and identifies that limit when reached. Signed-in users switch organizations with the existing organization selector.

To stop digest generation, unschedule `sentinel-digests`. To stop new in-app alerts, disable the `sentinel_publish_alert` trigger in a forward migration. Retain generated notification history and RLS. Roll back the UI through GitHub Pages independently.

### Deep investigation

An authorized watch owner can start a deep investigation when both Investigation Planning and Intelligence Assessment are enabled. Follow-up Investigation independently controls the second model round. Each request uses the selected component model, a bounded deadline and token budget, the shared usage budget, and existing request and response auditing. A standard scan collects and assesses without the additional planning requests.

Watch settings bound deep investigation to one or two rounds, one to three search requests, and a minimum model-estimated relevance threshold. Search proposals must be short topics. The worker combines each with the watch query and submits it only to the built-in Google News search endpoint. Evidence from initial collection remains indexed if follow-up searches time out. The final report cites evidence from the combined set. The worker uses deterministic query orchestration and does not depend on native tool-calling support.

To disable deep work, turn off Sentinel Investigation Planning in Global AI Admin. Standard scans and existing reports remain available. A worker rollback may preserve the additional columns and settings.

### Bulk watch management

Use Watchlist → Bulk import to map CSV or first-sheet XLSX columns, preview validation, choose per-import defaults, and skip or update owned duplicates. The server applies eligible rows in one transaction and audits counts. Optional initial scans are inserted into the existing queue for Cron processing. XLSX uses the pinned ExcelJS 4.4.0 MIT-licensed browser build with an integrity hash. Workbooks require literal values, are limited to 2 MB before parsing, and are checked for archive size and entry count. Store vendor IDs with leading zeros as text. The selected-watch editor changes category, activation, schedule, and email recipients subject to ownership and organization access.

### Cross-application links

News Watch can link a watch to an accessible CRM account and a specific assessment to an accessible portfolio initiative. Link creation requires target editor permission. The source watch and destination must remain accessible in the same organization to see the link. CRM and Portfolio show linked reports and their risk severity and confidence. Link creation does not update relationship health or portfolio ordering.

Authorized Work Board editors can open a task draft from an accessible assessment. The task body has an authenticated link and a generic recommendation to review it. Board save and concurrency behavior continue to use the existing editor. For a shared watch, Content Studio creators can make a Knowledge Base draft with attribution and references, and review it through the usual publication workflow.

### Assessment output budget

The 2026-11-27 Aristocrat Interactive scan saved nine sources. The model used all 4,096 configured completion tokens for reasoning before producing report content. The runtime now supplies a model-specific reasoning budget for Nemotron Lightning while preserving the configured model and total output-token limit. Scan History shows a pending assessment as in progress and reserves failure text for terminal or retry states.
