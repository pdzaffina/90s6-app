resource "oci_identity_dynamic_group" "pilot" {
  compartment_id = var.tenancy_ocid
  name = "pilot-90s6-instances"
  description = "Instance principals in isolated 90s6 pilot"
  matching_rule = "ALL {instance.compartment.id = '${oci_identity_compartment.pilot.id}'}"
}
resource "oci_identity_policy" "pilot_run_command" {
  compartment_id = oci_identity_compartment.pilot.id
  name = "pilot-90s6-run-command"
  description = "Permit pilot instances to execute OCI Run Command"
  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.pilot.name} to use instance-agent-command-execution-family in compartment id ${oci_identity_compartment.pilot.id}"
  ]
}
