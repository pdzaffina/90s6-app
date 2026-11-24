# Provider-independent backend: first increment

This is an unconnected foundation, not a replacement for the current frontend. The first vertical slice is the current-user profile contract and Supabase adapter. Existing RLS remains active; no service-role credentials are used.

Next: add contract tests and a same-origin HTTP endpoint, then migrate the shared shell and other domain repositories. SQLite implementation is gated on Supabase-backed feature parity. Do not deploy this increment independently.

Terraform currently lives on feature/oci-deployment. The SQLite feature branch must reconcile that branch before deploying a backend; do not copy partial infrastructure or apply against the existing pilot state. No infrastructure change is required for these unconnected modules.
