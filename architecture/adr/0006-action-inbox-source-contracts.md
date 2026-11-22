# ADR 0006: Typed source contracts with explicit Unknown classification

**Status:** Accepted, reflects implemented design; operational verification remains as noted

**Date:** 2026-11-22

## Context
Work Boards, Knowledge Base and Portfolio expose different data models and some historical records lack reliable timestamps or completion signals.

## Decision
Use typed WORK-001, KB-002 and PORT-003 evaluators. Return Violation, Compliant or Unknown; never infer compliance from absent, malformed or incomplete evidence. Historical KB drafts without trustworthy entry dates remain Unknown. Portfolio assessment completion is an explicit audited indicator, not a weighted score.

## Consequences
Source-specific rules are testable and avoid false resolution, but incomplete source records can produce visible Unknown counts.

## Alternatives considered
Generic SQL or arbitrary script-based rules would be harder to constrain and audit.

## References
- [RFC-002](../RFC-002-action-inbox-architecture.md)
- [Action Inbox system architecture](../action-inbox-system.md)
- [Action Inbox ERD](../action-inbox-erd.md)
