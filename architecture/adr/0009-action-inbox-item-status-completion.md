# ADR 0009: Use Work Board item Done status for completion

**Status:** Accepted, reflects implemented design; operational verification remains as noted

**Date:** 2026-11-22

## Context
The initial WORK-001 contract used designated completion columns. This required layout configuration and classified many existing records as Unknown, despite completion being a property of the item.

## Decision
An item's own status is authoritative: Done means complete; To Do and In Progress mean incomplete. The evaluator treats legacy missing status as To Do. Board layout columns have no completion semantics. WORK-001 flags incomplete items with valid due dates before the rule-local current date.

## Consequences
Users can organize columns freely. Legacy missing status has a conservative incomplete interpretation, and unrecognized explicit status remains Unknown. The board UI must persist item status reliably.

## Alternatives considered
Completion columns and inferring Done from column names are rejected.

## References
- [RFC-002](../RFC-002-action-inbox-architecture.md)
- [Action Inbox system architecture](../action-inbox-system.md)
- [Action Inbox ERD](../action-inbox-erd.md)
