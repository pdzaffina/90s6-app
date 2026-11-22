# 90s6 App architecture

Architecture documentation for the 90s6 application. These documents describe the implementation as evidenced by repository code and migrations as of 2026-11-21. They are living documents, not proof of production deployment.

- [System architecture](system-architecture.md): context, components, trust boundaries and runtime flows.
- [Data model and ERD](data-model-erd.md): relational model and JSONB boundaries.
- [RFC-001](RFC-001-platform-architecture.md): project-wide rationale, requirements, risks and roadmap.
- [Architecture decision records](adr/README.md): Nygard-style decisions and their consequences.

## Maintenance
Update diagrams and ADRs when changes affect authorization, persistence, deployment, or integration. Validate actual production schema against migrations before asserting deployment state.
