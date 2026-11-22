# ADR 0010: Version rule configurations and distinguish manual scans from scheduling

**Status:** Accepted, reflects implemented design; operational verification remains as noted

**Date:** 2026-11-22

## Context
Business Rules settings must be auditable and scans reproducible. The product exposes scan intervals but autonomous scheduling was not verified deployed at initial release.

## Decision
Persist immutable rule versions and reference the active version from each rule and scan. Authorized admins edit through a structured inline form, not browser prompt dialogs. Manual scans invoke guarded SQL. Autonomous scheduling is a separate operational capability that requires its own deployment and verification.

## Consequences
Supports traceability and a better user experience, while leaving a clear operational gap until scheduling and recovery are implemented.

## Alternatives considered
Overwriting rule configuration in place or claiming a timer field itself provides scheduled execution is rejected.

## References
- [RFC-002](../RFC-002-action-inbox-architecture.md)
- [Action Inbox system architecture](../action-inbox-system.md)
- [Action Inbox ERD](../action-inbox-erd.md)
