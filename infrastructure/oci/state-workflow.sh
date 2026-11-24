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
if [[ "$OPERATION" == inspect-vcn || "$OPERATION" == delete-vcn ]]; then
  target=ocid1.vcn.oc1.phx.amaaaaaamerpqeiavvjmditpssvjjaa2wdtai2tb3bcajswnxol2pc7bhruq
  oci network vcn get --vcn-id "$target" > "$work/vcn.json"
  compartment=$(jq -er '.data."compartment-id"' "$work/vcn.json")
  jq '{name:.data."display-name",state:.data."lifecycle-state",cidrs:.data."cidr-blocks"}' "$work/vcn.json"
  oci iam compartment list --compartment-id "$OCI_TENANCY_OCID" --compartment-id-in-subtree true --all > "$work/compartments.json"
  if jq -e --arg c "$compartment" 'any(.data[]; .id == $c and .name == "90s6")' "$work/compartments.json" >/dev/null; then
    echo "::error::Refusing to touch pilot compartment"; exit 1
  fi
  # Fail closed: do not remove any child resources automatically.
  for kind in subnet internet-gateway nat-gateway service-gateway local-peering-gateway network-security-group route-table security-list dhcp-options; do
    if [[ "$kind" == network-security-group ]]; then
      oci network nsg list --compartment-id "$compartment" --vcn-id "$target" --all > "$work/$kind.json"
    else
      oci network "$kind" list --compartment-id "$compartment" --vcn-id "$target" --all > "$work/$kind.json"
    fi
    echo "$kind:"
    jq -r '.data[] | [."display-name", ."lifecycle-state"] | @tsv' "$work/$kind.json"
  done
  if [[ "$OPERATION" == inspect-vcn ]]; then exit 0; fi
  [[ "$CONFIRMATION" == DELETE-VCN ]] || { echo "::error::Explicit deletion confirmation required"; exit 1; }
  for kind in subnet internet-gateway nat-gateway service-gateway local-peering-gateway network-security-group; do
    jq -e '.data | length == 0' "$work/$kind.json" >/dev/null || { echo "::error::VCN has $kind dependencies; no deletion attempted"; exit 1; }
  done
  # OCI itself rejects deletion when any remaining dependencies exist.
  oci network vcn delete --vcn-id "$target" --force --wait-for-state TERMINATED
  echo "Target VCN deleted."
  exit 0
fi
if [[ "$OPERATION" == budget ]]; then
  oci budgets budget budget list --compartment-id "$OCI_TENANCY_OCID" --all > "$work/budgets.json" 2>"$work/error" || { echo "::error::Budget lookup failed"; exit 1; }
  jq -e --arg root "$OCI_TENANCY_OCID" 'any(.data[]; ."display-name" == "Cost_Tracker" and ."lifecycle-state" == "ACTIVE" and .amount == 1 and ."reset-period" == "MONTHLY" and ((.targets // []) | index($root) != null))' "$work/budgets.json" >/dev/null || { echo "::error::Existing budget could not be verified"; exit 1; }
  echo "Existing one dollar monthly Cost_Tracker verified. No budget changes made."
  exit 0
fi
check_pilot_quota() {
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
  local cores="${1:-2}" memory="${2:-12}" storage="${3:-150}"
  echo "Additional quota required: $cores OCPUs, $memory GB RAM, $storage GB storage."
  if (( cores > 0 )); then check_quota compute standard-a1-core-count "$cores" ad; fi
  if (( memory > 0 )); then check_quota compute standard-a1-memory-count "$memory" ad; fi
  if (( storage > 0 )); then check_quota block-storage total-storage-gb "$storage" ad; fi
  echo "Requested quota checks passed. Physical host capacity and free-tier billing eligibility are not guaranteed."
}
if [[ "$OPERATION" == quota ]]; then
  check_pilot_quota
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
echo "Existing managed resources:"
terraform state list 2>"$work/state-error" || echo "State listing unavailable (possibly empty)."
terraform plan -input=false -lock-timeout=60s -out="$work/plan" >"$work/plan.log" 2>&1 || { echo "::error::Remote plan failed"; exit 1; }
terraform show -json "$work/plan" > "$work/plan.json"
jq -r '.resource_changes[] | select(.mode == "managed") | [.address, (.change.actions | join(","))] | @tsv' "$work/plan.json"
if [[ "$OPERATION" == plan ]]; then exit 0; fi
[[ "$OPERATION" == apply && "$CONFIRMATION" == CREATE-PILOT ]] || { echo "::error::Explicit apply confirmation required"; exit 1; }
jq -e 'all(.resource_changes[] | select(.mode == "managed"); .change.actions == ["create"] or .change.actions == ["no-op"])' "$work/plan.json" >/dev/null || { echo "::error::Only creates and no-ops allowed"; exit 1; }
# Derive incremental demand from the exact saved plan, not the original target.
read -r cores memory storage < <(jq -er '
  [.resource_changes[] | select(.mode == "managed" and .change.actions == ["create"])] as $new |
  ([$new[] | select(.address == "oci_core_instance.pilot") | .change.after.shape_config[0].ocpus] | add // 0) as $cores |
  ([$new[] | select(.address == "oci_core_instance.pilot") | .change.after.shape_config[0].memory_in_gbs] | add // 0) as $memory |
  ([$new[] | if .address == "oci_core_instance.pilot" then (.change.after.source_details[0].boot_volume_size_in_gbs | tonumber) elif .address == "oci_core_volume.data" then (.change.after.size_in_gbs | tonumber) else 0 end] | add // 0) as $storage |
  [$cores,$memory,$storage] | @tsv' "$work/plan.json")
[[ "$cores" =~ ^[0-9]+$ && "$memory" =~ ^[0-9]+$ && "$storage" =~ ^[0-9]+$ ]] || { echo "::error::Unable to determine incremental quota"; exit 1; }
check_pilot_quota "$cores" "$memory" "$storage"
terraform apply -input=false -lock-timeout=60s "$work/plan" > "$work/apply.log" 2>&1 || { echo "::error::Apply failed; remote state may contain partially created resources. Run plan before retrying."
python3 - "$work/apply.log" <<'PY'
import re,sys
s=open(sys.argv[1]).read()
for line in s.splitlines():
    clean=re.sub(r'\x1b\[[0-9;]*m','',line)
    for pattern in [r'\b[45][0-9]{2}-[A-Za-z][A-Za-z0-9_]+\b',r'\boci_[a-z_]+\.[a-z_]+\b']:
        for match in re.findall(pattern,clean):
            print("Diagnostic: "+match)
    for phrase in ["Out of host capacity","Out of capacity","LimitExceeded","NotAuthorizedOrNotFound","InvalidParameter","IncorrectState","Conflict"]:
        if phrase.lower() in clean.lower():
            print("Diagnostic: "+phrase)
PY
terraform state list 2>"$work/state-error" || true
exit 1; }
echo "Pilot infrastructure apply completed."
terraform state list
