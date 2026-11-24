data "oci_core_images" "ubuntu_arm" {
  compartment_id = var.tenancy_ocid
  operating_system = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape = "VM.Standard.A1.Flex"
  sort_by = "TIMECREATED"
  sort_order = "DESC"
}
resource "oci_core_instance" "pilot" {
  compartment_id = oci_identity_compartment.pilot.id
  availability_domain = data.oci_identity_availability_domains.available.availability_domains[var.availability_domain_index].name
  display_name = "90s6-pilot"
  shape = "VM.Standard.A1.Flex"
  shape_config {
    ocpus = 2
    memory_in_gbs = 12
  }
  create_vnic_details {
    subnet_id = oci_core_subnet.pilot.id
    assign_public_ip = false
  }
  source_details {
    source_type = "image"
    source_id = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = 50
  }
  metadata = {
    user_data = base64encode(file("${path.module}/cloud-init.yaml"))
  }
  agent_config {
    plugins_config {
      name = "Compute Instance Run Command"
      desired_state = "ENABLED"
    }
  }
}
data "oci_core_vnic_attachments" "pilot" {
  compartment_id = oci_identity_compartment.pilot.id
  instance_id = oci_core_instance.pilot.id
}
data "oci_core_private_ips" "pilot" {
  vnic_id = data.oci_core_vnic_attachments.pilot.vnic_attachments[0].vnic_id
}
resource "oci_core_public_ip" "pilot" {
  compartment_id = oci_identity_compartment.pilot.id
  lifetime = "RESERVED"
  display_name = "90s6-pilot"
  private_ip_id = data.oci_core_private_ips.pilot.private_ips[0].id
}
resource "oci_core_volume_attachment" "data" {
  count = var.availability_domain_index == 0 ? 1 : 0
  attachment_type = "paravirtualized"
  instance_id = oci_core_instance.pilot.id
  volume_id = oci_core_volume.data.id
  display_name = "90s6-pilot-data"
}
