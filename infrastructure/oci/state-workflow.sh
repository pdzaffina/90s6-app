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
  ad=$(oci iam availability-domain list --compartment-id "$OCI_TENANCY_OCID" --query "data[${TF_VAR_availability_domain_index:-0}].name" --raw-output 2>"$work/error")
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
if [[ "$OPERATION" == reset-plan || "$OPERATION" == reset ]]; then
  # Never reset a pilot that has acquired a compute instance or attached storage.
  terraform state list > "$work/reset-state"
  if grep -Eq '^oci_core_(instance|volume_attachment|public_ip)\.' "$work/reset-state"; then
    echo "::error::Compute, attachment or IP exists; manual review required"; exit 1
  fi
  # Keep only the compartment configuration; normal plan deletes removed resources.
  python3 - <<'PY'
from pathlib import Path
p=Path("main.tf")
s=p.read_text()
p.write_text(s[:s.index('resource "oci_core_vcn"')])
for name in ("compute.tf","management.tf"):
    Path(name).unlink()
PY
  terraform plan -input=false -lock-timeout=60s -out="$work/reset" > "$work/reset.log" 2>&1 || { echo "::error::Reset plan failed"; exit 1; }
  terraform show -json "$work/reset" > "$work/reset.json"
  jq -r '.resource_changes[] | select(.mode=="managed") | [.address, (.change.actions|join(","))] | @tsv' "$work/reset.json"
  jq -e 'all(.resource_changes[] | select(.mode=="managed"); .change.actions==["no-op"] or (.change.actions==["delete"] and (.address as $a | ["oci_core_vcn.pilot","oci_core_internet_gateway.pilot","oci_core_route_table.pilot","oci_core_security_list.pilot","oci_core_subnet.pilot","oci_core_volume.data","oci_identity_policy.pilot_run_command","oci_identity_dynamic_group.pilot"] | index($a)!=null)))' "$work/reset.json" >/dev/null || { echo "::error::Unexpected reset changes; stopping"; exit 1; }
  if [[ "$OPERATION" == reset-plan ]]; then exit 0; fi
  [[ "$CONFIRMATION" == RESET-PILOT ]] || { echo "::error::Reset confirmation required"; exit 1; }
  terraform apply -input=false -lock-timeout=60s "$work/reset" > "$work/reset-apply.log" 2>&1 || { echo "::error::Reset failed; inspect state before retrying"; exit 1; }
  terraform state list
  echo "Pilot reset completed; compartment and state bucket retained."
  exit 0
fi
# Compute-first orchestration. State is authoritative after successful launch.
[[ "$OPERATION" == plan || ( "$OPERATION" == apply && "$CONFIRMATION" == CREATE-PILOT ) ]] || { echo "::error::Explicit apply confirmation required"; exit 1; }
make_plan() {
  terraform plan -input=false -lock-timeout=60s "$@" -out="$work/plan" > "$work/plan.log" 2>&1 || { echo "::error::Plan failed"; return 1; }
  terraform show -json "$work/plan" > "$work/plan.json"
  jq -r '.resource_changes[] | select(.mode=="managed") | [.address, (.change.actions|join(","))] | @tsv' "$work/plan.json"
  jq -e 'all(.resource_changes[] | select(.mode=="managed"); .change.actions==["create"] or .change.actions==["no-op"])' "$work/plan.json" >/dev/null || { echo "::error::Unsafe plan"; return 1; }
}
read_winner() {
  terraform show -json > "$work/current.json"
  winner=$(jq -r '[.values.root_module.resources[]? | select(.address=="oci_core_instance.pilot") | .values.availability_domain][0] // empty' "$work/current.json")
  if [[ -n "$winner" ]]; then
    oci iam availability-domain list --compartment-id "$OCI_TENANCY_OCID" > "$work/ads.json"
    export TF_VAR_availability_domain_index=$(jq -er --arg ad "$winner" '[.data[].name] | index($ad) // error("Unknown AD")' "$work/ads.json")
    echo "Compute location locked: AD-$((TF_VAR_availability_domain_index+1))"
  fi
}
read_winner
if [[ -z "$winner" ]]; then
  # No data volume may precede compute.
  if jq -e 'any(.values.root_module.resources[]?; .address=="oci_core_volume.data")' "$work/current.json" >/dev/null; then echo "::error::Existing volume requires review"; exit 1; fi
  for ((attempt=0; attempt<60; attempt++)); do
    export TF_VAR_availability_domain_index=$((attempt%3))
    echo "Compute attempt $((attempt+1))/60, AD-$((TF_VAR_availability_domain_index+1))"
    make_plan -target=oci_core_instance.pilot
    if [[ "$OPERATION" == plan ]]; then exit 0; fi
    check_pilot_quota 2 12 50
    if terraform apply -input=false -lock-timeout=60s "$work/plan" > "$work/apply.log" 2>&1; then
      read_winner
      [[ -n "$winner" ]] || { echo "::error::Compute missing after apply"; exit 1; }
      break
    fi
    read_winner
    if [[ -n "$winner" ]]; then echo "::error::Compute exists after failed apply; rerun to resume"; exit 1; fi
    if ! grep -qi 'Out of host capacity' "$work/apply.log" || ! grep -q 'oci_core_instance.pilot' "$work/apply.log" || [[ $(grep -c 'Error:' "$work/apply.log") != 1 ]]; then
      echo "::error::Non-capacity failure; stopping"
      grep -oE '[45][0-9]{2}-[A-Za-z][A-Za-z0-9_]+' "$work/apply.log" | sort -u || true
      exit 1
    fi
    echo "Host capacity unavailable."
    if (( attempt < 59 )); then sleep 120; fi
  done
fi
[[ -n "$winner" ]] || { echo "::error::Capacity attempts exhausted; rerun apply to continue"; exit 1; }
make_plan
if [[ "$OPERATION" == plan ]]; then exit 0; fi
storage=$(jq -er '[.resource_changes[] | select(.address=="oci_core_volume.data" and .change.actions==["create"]) | .change.after.size_in_gbs | tonumber] | add // 0' "$work/plan.json")
check_pilot_quota 0 0 "$storage"
terraform apply -input=false -lock-timeout=60s "$work/plan" > "$work/apply.log" 2>&1 || { echo "::error::Completion failed; compute retained, rerun apply to resume"; grep -oE '[45][0-9]{2}-[A-Za-z][A-Za-z0-9_]+' "$work/apply.log" | sort -u || true; exit 1; }
echo "Pilot infrastructure apply completed."
terraform state list
