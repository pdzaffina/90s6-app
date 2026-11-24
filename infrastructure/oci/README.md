# OCI pilot infrastructure

Phase 1 is deliberately plan-only. It defines the compartment, network, web-only ingress and protected data volume. No compute instance or application is deployed yet. The target is Phoenix, A1 Flex 2 OCPUs / 12 GB, 50 GB boot and 100 GB data. Check unused quotas and actual capacity before provisioning.

The plan workflow uses the oci-pilot environment and existing OCI signing secrets. It never applies, publishes a plan artifact, or prints the raw plan. Local ephemeral state is acceptable only for this initial read-only plan. Before any apply, configure private remote state with locking and restricted access, verify cost and permissions, and add an approved apply workflow. Do not run apply locally.

Production GitHub Pages and Supabase Cloud are independent. Do not reuse production secrets or data. No public SSH ingress; establish a secure management path before deploying compute.
