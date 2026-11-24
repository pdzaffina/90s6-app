# State and provisioning gate

The current workflow remains plan-only. Before applying, establish a private Object Storage state bucket outside the application compartment, enable versioning, configure a supported remote backend with locking, and verify access and lock behavior. Do not publish state or plans as GitHub artifacts.

Compute uses a reserved public IP and no inbound SSH. Before provisioning, verify unused compute and storage quota, image compatibility, and Run Command IAM permissions. The initial cloud-init deliberately performs no network package installation or disk formatting. The reserved IP is assigned after instance creation; install Docker only after connectivity is verified. No application secrets belong in cloud-init or Terraform state.

No automatic fallback to paid shapes or larger volumes is permitted.

The registered OCI Pilot - State and Provision workflow supports bootstrap and remote plan. Apply is intentionally blocked until quota, budget and management access verification. Use the native OCI backend with Terraform 1.12.2. The bootstrap bucket is managed separately by the OCI CLI, not the application Terraform state.
