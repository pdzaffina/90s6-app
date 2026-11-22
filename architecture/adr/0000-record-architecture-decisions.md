# ADR 0000: Record architecture decisions using ADRs

**Status:** Accepted

## Context

90s6 is evolving across multiple application modules, tenant boundaries, security policies, data models and deployment decisions. Without a lightweight, durable record, the reasoning behind consequential choices can be lost, revisited repeatedly or misunderstood by future contributors.

## Decision

We will document architecturally significant decisions as Architecture Decision Records (ADRs) in `architecture/adr/`, following Michael Nygard's lightweight format:

- **Title:** A numbered, descriptive decision.
- **Status:** Proposed, Accepted, Superseded or Deprecated, as appropriate.
- **Context:** The forces and constraints motivating the decision.
- **Decision:** The choice made, stated clearly.
- **Consequences:** Positive, negative and follow-up implications.

ADRs are numbered sequentially beginning with **0000**, this decision to use ADRs. New decisions receive the next available number. Accepted records remain part of the historical record. If a decision changes, write a new ADR and mark the prior one Superseded with a link to its replacement rather than silently rewriting history.

An ADR should be created or updated as part of the same change that introduces a material architectural decision. Small implementation details do not require an ADR.

## Consequences

- **Positive:** Architectural reasoning is discoverable, reviewable and version-controlled alongside the code.
- **Positive:** Contributors can understand tradeoffs without reconstructing past conversations.
- **Negative:** Writing and maintaining ADRs adds a modest documentation responsibility.
- **Follow-up:** Maintain an index in this directory and review proposed ADRs before marking them Accepted.
