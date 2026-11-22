# ADR 0004: Store work board items and layout in JSONB

**Status:** Proposed (documents existing schema)

## Context
Work boards support configurable columns, WBS views and flexible item layouts. The initial schema stores board-level data and configuration together.

## Decision
Persist work items in `boards.data` JSONB and board configuration in `boards.config` JSONB, with relational records for board identity, tenant ownership and membership. Reconsider normalization when query scale, reporting or concurrent editing warrants it.

## Consequences
- **Positive:** Flexible layouts and straightforward board-level serialization and export.
- **Negative:** More difficult item-level SQL queries, integrity constraints, concurrent updates and partial auditing.
- **Follow-up:** Define versioning, conflict behavior, schema validation and import/export compatibility.
