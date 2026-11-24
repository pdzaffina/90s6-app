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
  oci budgets budget budget list --compartment-id "$OCI_TENANCY_OCID" --all > "$work/budgets.json" 2>"$work/error" || { echo "::error::Budget lookup failed"; exit 1; }
  jq -e --arg root "$OCI_TENANCY_OCID" 'any(.data[]; ."display-name" == "Cost_Tracker" and ."lifecycle-state" == "ACTIVE" and .amount == 1 and ."reset-period" == "MONTHLY" and ((.targets // []) | index($root) != null))' "$work/budgets.json" >/dev/null || { echo "::error::Existing budget could not be verified"; exit 1; }
  echo "Existing one dollar monthly Cost_Tracker verified. No budget changes made."
  exit 0
fi
if [[ "$OPERATION" == quota ]]; then
  ad=$(oci iam availability-domain list --compartment-id "$OCI_TENANCY_OCID" --query 'data[0].name' --raw-output 2>"$work/error")
  check_quota() {
    local service="$1" limit="$2" required="$3" scope="$4"
    local args=()
    if [[ "$scope" == ad ]]; then args+=(--availability-domain "$ad"); fi
    oci limits resource-availability get --compartment-id "$OCI_TENANCY_OCID" --service-name "$service" --limit-name "$limit" "${args[@]}" > "$work/quota.json" 2>"$work/error" || { echo "::error::Unable to verify $limit ($scope)"; python3 -c 'import json,re,sys
s=open(sys.argv[1]).read()
for m in re.finditer(r"\{",s):
 try:
  d,_=json.JSONDecoder().raw_decode(s[m.start():])
  for k in ("status","code"):
   v=str(d.get(k,"unknown"))
   print(k+": "+(v if re.fullmatch(r"[A-Za-z0-9_ -]{1,80}",v) else "redacted"))
  break
 except ValueError: continue' "$work/error"; return 1; }
    jq -e --argjson required "$required" '(.data.available | type) == "number" and .data.available >= $required' "$work/quota.json" >/dev/null || { echo "::error::Insufficient available quota for $limit ($scope)"; return 1; }
    echo "$limit ($scope): sufficient available quota."
  }
  check_quota compute standard-a1-core-count 2 ad
  check_quota compute standard-a1-memory-count 12 ad
  check_quota block-storage total-storage-gb 150 ad
  echo "Requested quota checks passed. Physical host capacity and free-tier billing eligibility are not guaranteed."
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
