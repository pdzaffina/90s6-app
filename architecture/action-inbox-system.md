# Action Inbox system architecture

**Status:** As-implemented logical architecture, 2026-11-22. Read alongside [RFC-002](RFC-002-action-inbox-architecture.md). Solid arrows are implemented interactions; dashed arrows are planned or operationally unverified.

## Component diagram

```mermaid
flowchart TB
  U["Authenticated user / administrator"] --> WEB["Action Inbox browser UI<br/>action-inbox/index.html + inbox.js"]
  WEB --> SHELL["90s6 shared session + tenant shell"]
  SHELL --> CLIENT["Supabase JS client"]
  CLIENT --> AUTH["Supabase Auth"]
  CLIENT --> RPC["Guarded public.ainbox_* RPCs"]
  RPC --> AUTHZ{"Tenant + feature + role<br/>and source access"}
  AUTHZ -->|authorized| READ["Sanitized actions, rules,<br/>workstreams, exception details"]
  AUTHZ -->|authorized admin| ENGINE["public.ainbox_run_rule"]
  AUTHZ -->|authorized user| FLOW["State, remediation,<br/>communication RPCs"]
  ENGINE --> ADAPTERS["Typed rule evaluation"]
  ADAPTERS --> BOARD[("boards.data JSONB<br/>item status + due date")]
  ADAPTERS --> KB[("knowledge_articles<br/>draft_entered_at")]
  ADAPTERS --> PORT[("pm_initiatives<br/>assessment + rank")]
  ENGINE --> RECON["ainbox_internal.record_result"]
  RECON --> DATA[("12 ainbox_* PostgreSQL tables<br/>RLS and tenant-scoped FKs")]
  READ --> DATA
  FLOW --> DATA
  SCHED["Autonomous scheduler<br/>not verified deployed"] -.-> ENGINE
```

## Rule evaluation and exception lifecycle

```mermaid
flowchart TD
  A["Authorized manual scan"] --> B["Load enabled rule and pinned version"]
  B --> C["Evaluate source records"]
  C --> D{"Classification"}
  D -->|Violation| E{"Unresolved occurrence exists?"}
  E -->|No| F["Create Open exception + detection activity"]
  E -->|Yes| G["Refresh evidence, preserve user state"]
  D -->|Compliant| H["Resolve existing occurrence if present"]
  D -->|Unknown| I["Preserve existing state; increment unknown count"]
  F --> J["Record scan counts and outcome"]
  G --> J
  H --> J
  I --> J
```

A scan's **evaluated**, **violations** and **unknown** counters are distinct. Unknown is not a failed scan and not an indication that the record is compliant. The current Work Board rule uses item-level Done status, not board column identity.

## Trust boundaries

1. **Browser boundary:** The UI may display and request actions, but it does not enforce authorization.
2. **RPC boundary:** `ainbox_authorized` checks user, tenant, feature and management role. `ainbox_source_visible` separately checks underlying source visibility.
3. **Evaluator boundary:** Trusted SQL scans and reconciles records, with restricted direct table access and append-only activity history.
4. **Source boundary:** Source apps own their records. Action Inbox records exceptions and guidance, not source mutations.

## Deployment and known gaps

The application is delivered from the 90s6 repository and uses the production Supabase project. Initial production rollout enabled the 90s6 organization. A manual rule scan is available; autonomous scheduling, complete partial-scan recovery, robust health metrics and comprehensive authorization regression testing remain outstanding. Do not depict those as operational services without subsequent verification.

## Related

- [Action Inbox ERD](action-inbox-erd.md)
- [RFC-002](RFC-002-action-inbox-architecture.md)
- [Existing platform diagram](system-architecture.md)
- [Architecture decision records](adr/README.md)
