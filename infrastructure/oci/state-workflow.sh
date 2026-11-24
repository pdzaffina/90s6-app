#!/usr/bin/env bash
set -euo pipefail
umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$HOME/.oci"
printf '%s\n' "$OCI_PRIVATE_KEY" > "$work/key.pem"
printf '[DEFAULT]\nuser=%s\ntenancy=%s\nfingerprint=%s\nregion=%s\nkey_file=%s\n' "$OCI_USER_OCID" "$OCI_TENANCY_OCID" "$OCI_FINGERPRINT" "$OCI_REGION" "$work/key.pem" > "$HOME/.oci/config"
chmod 600 "$HOME/.oci/config" "$work/key.pem"
export OCI_private_key_path="$work/key.pem"
export OCI_tenancy_ocid="$OCI_TENANCY_OCID" OCI_user_ocid="$OCI_USER_OCID" OCI_fingerprint="$OCI_FINGERPRINT" OCI_region="$OCI_REGION"
export TF_IN_AUTOMATION=true
if [[ "$OPERATION" == budget ]]; then
  : "${OCI_BUDGET_EMAIL:?Budget email secret required}"
  name=90s6-pilot-cost-guardrail
  oci budgets budget budget list --compartment-id "$OCI_TENANCY_OCID" --all > "$work/budgets.json" 2>"$work/error" || { echo "::error::Budget listing failed"; exit 1; }
  id=$(jq -r --arg name "$name" '[.data[] | select(."display-name" == $name and ."lifecycle-state" == "ACTIVE")] | if length > 1 then error("Duplicate budgets") else .[0].id // empty end' "$work/budgets.json")
  if [[ -z "$id" ]]; then
    targets=$(jq -cn --arg id "$OCI_TENANCY_OCID" '[$id]')
    oci budgets budget budget create --compartment-id "$OCI_TENANCY_OCID" --amount 5 --reset-period MONTHLY --target-type COMPARTMENT --targets "$targets" --display-name "$name" > "$work/budget.json" 2>"$work/error" || { echo "::error::Budget creation failed"; exit 1; }
    id=$(jq -er '.data.id' "$work/budget.json")
  fi
  oci budgets budget budget get --budget-id "$id" > "$work/budget.json" 2>"$work/error" || { echo "::error::Budget lookup failed"; exit 1; }
  jq -e '.data | .amount == 5 and ."reset-period" == "MONTHLY"' "$work/budget.json" >/dev/null || { echo "::error::Existing budget does not match requested settings"; exit 1; }
  for spec in ACTUAL:50 ACTUAL:80 ACTUAL:100 FORECAST:100; do
    type=${spec%:*}
    threshold=${spec#*:}
    oci budgets budget alert-rule list --budget-id "$id" --all > "$work/rules.json" 2>"$work/error" || { echo "::error::Budget alert listing failed"; exit 1; }
    if ! jq -e --arg type "$type" --argjson threshold "$threshold" --arg email "$OCI_BUDGET_EMAIL" 'any(.data[]; .type == $type and .threshold == $threshold and ."threshold-type" == "PERCENTAGE" and .recipients == $email)' "$work/rules.json" >/dev/null; then
      oci budgets budget alert-rule create --budget-id "$id" --type "$type" --threshold "$threshold" --threshold-type PERCENTAGE --recipients "$OCI_BUDGET_EMAIL" > "$work/rule.json" 2>"$work/error" || { echo "::error::Budget alert creation failed"; exit 1; }
    fi
    echo "Verified or created $type alert at $threshold percent."
  done
  echo "Five dollar monthly budget configured."
  exit 0
fi
namespace=$(oci os ns get --query data --raw-output 2>"$work/error")
bucket=90s6-pilot-tfstate
if [[ "$OPERATION" == bootstrap ]]; then
  if ! oci os bucket get --namespace-name "$namespace" --bucket-name "$bucket" > "$work/bucket.json" 2>"$work/error"; then
    oci os bucket create --namespace-name "$namespace" --compartment-id "$OCI_TENANCY_OCID" --name "$bucket" --public-access-type NoPublicAccess --versioning Enabled > "$work/bucket.json" 2>"$work/error" || { echo "::error::State bucket creation failed"; exit 1; }
  fi
fi
oci os bucket get --namespace-name "$namespace" --bucket-name "$bucket" > "$work/bucket.json" 2>"$work/error" || { echo "::error::State bucket unavailable; run bootstrap first"; exit 1; }
jq -e --arg tenancy "$OCI_TENANCY_OCID" '.data | ."public-access-type" == "NoPublicAccess" and .versioning == "Enabled" and ."compartment-id" == $tenancy' "$work/bucket.json" >/dev/null || { echo "::error::State bucket safety checks failed"; exit 1; }
echo "Private versioned state bucket verified."
if [[ "$OPERATION" == bootstrap ]]; then exit 0; fi
printf 'terraform {\n backend "oci" {}\n}\n' > backend.runtime.tf
terraform init -input=false -backend-config="bucket=$bucket" -backend-config="namespace=$namespace" -backend-config="key=pilot/terraform.tfstate" >"$work/init" 2>&1 || { echo "::error::Remote backend initialization failed"; exit 1; }
terraform validate
terraform plan -input=false -lock-timeout=60s -out="$work/plan" >"$work/plan.log" 2>&1 || { echo "::error::Remote plan failed"; exit 1; }
terraform show -json "$work/plan" > "$work/plan.json"
jq -r '.resource_changes[] | select(.mode == "managed") | [.address, (.change.actions | join(","))] | @tsv' "$work/plan.json"
if [[ "$OPERATION" == plan ]]; then exit 0; fi
[[ "$OPERATION" == apply && "$CONFIRMATION" == CREATE-PILOT ]] || { echo "::error::Explicit apply confirmation required"; exit 1; }
jq -e 'all(.resource_changes[] | select(.mode == "managed"); .change.actions == ["create"] or .change.actions == ["no-op"])' "$work/plan.json" >/dev/null || { echo "::error::Only creates and no-ops allowed"; exit 1; }
echo "::error::Apply intentionally blocked pending quota, budget and management access verification."
exit 1
