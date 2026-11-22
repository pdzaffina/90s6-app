# ADR 0005: Exception-oriented Action Inbox rather than a second task manager

**Status:** Accepted, reflects implemented design; operational verification remains as noted

**Date:** 2026-11-22

## Context
Organizations need an actionable view of conditions that require intervention without duplicating Work Board and Portfolio systems.

## Decision
Action Inbox detects exceptions, assigns accountability, guides remediation and links users to source applications. It does not automatically edit source records.

## Consequences
Users have one place to review exceptions; source systems remain authoritative. Remediation completion alone cannot resolve an exception.

## Alternatives considered
A separate task-management system would duplicate state and create competing sources of truth.

## References
- [RFC-002](../RFC-002-action-inbox-architecture.md)
- [Action Inbox system architecture](../action-inbox-system.md)
- [Action Inbox ERD](../action-inbox-erd.md)
