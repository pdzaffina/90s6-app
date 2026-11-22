# ADR 0008: Reconcile only explicitly classified source records

**Status:** Accepted, reflects implemented design; operational verification remains as noted

**Date:** 2026-11-22

## Context
Scans may be incomplete or encounter inaccessible, malformed or historical source data. Treating missing records as compliant would silently close exceptions.

## Decision
Pin the rule version for each scan. Reconcile explicit Violation by creating or refreshing the unresolved occurrence; explicit Compliant by resolving it; Unknown by preserving existing state. Dismissal suppresses a continuous occurrence until verified compliance. Snooze is an overlay.

## Consequences
Prevents false closure and preserves recurrence history. Requires explicit coverage accounting and further partial-scan hardening.

## Alternatives considered
Closing exceptions merely because they were absent from a scan is rejected.

## References
- [RFC-002](../RFC-002-action-inbox-architecture.md)
- [Action Inbox system architecture](../action-inbox-system.md)
- [Action Inbox ERD](../action-inbox-erd.md)
