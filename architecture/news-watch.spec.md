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
