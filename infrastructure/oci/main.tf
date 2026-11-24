terraform {
  required_version = "~> 1.12.0"
  required_providers {
    oci = {
      source = "oracle/oci"
      version = "~> 6.0"
    }
  }
}
provider "oci" {
  region = var.region
}
variable "region" {
  type = string
  default = "us-phoenix-1"
}
variable "tenancy_ocid" {
  type = string
}
variable "availability_domain_index" {
  type = number
  default = 1
  validation {
    condition = contains([0, 1, 2], var.availability_domain_index)
    error_message = "Choose AD index 0, 1, or 2."
  }
}
data "oci_identity_availability_domains" "available" {
  compartment_id = var.tenancy_ocid
}
resource "oci_identity_compartment" "pilot" {
  compartment_id = var.tenancy_ocid
  name = "90s6"
  description = "90s6 isolated application pilot"
  enable_delete = false
  lifecycle {
    prevent_destroy = true
  }
}
resource "oci_core_vcn" "pilot" {
  compartment_id = oci_identity_compartment.pilot.id
  display_name = "90s6-pilot"
  cidr_blocks = ["10.90.0.0/16"]
  dns_label = "pilot90s6"
}
resource "oci_core_internet_gateway" "pilot" {
  compartment_id = oci_identity_compartment.pilot.id
  vcn_id = oci_core_vcn.pilot.id
  enabled = true
  display_name = "90s6-pilot"
}
resource "oci_core_route_table" "pilot" {
  compartment_id = oci_identity_compartment.pilot.id
  vcn_id = oci_core_vcn.pilot.id
  route_rules {
    destination = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.pilot.id
  }
}
resource "oci_core_security_list" "pilot" {
  compartment_id = oci_identity_compartment.pilot.id
  vcn_id = oci_core_vcn.pilot.id
  display_name = "90s6-web-only"
  dynamic "ingress_security_rules" {
    for_each = toset([80, 443])
    content {
      protocol = "6"
      source = "0.0.0.0/0"
      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }
    }
  }
  egress_security_rules {
    protocol = "all"
    destination = "0.0.0.0/0"
  }
}
resource "oci_core_subnet" "pilot" {
  compartment_id = oci_identity_compartment.pilot.id
  vcn_id = oci_core_vcn.pilot.id
  cidr_block = "10.90.1.0/24"
  display_name = "90s6-pilot-public"
  dns_label = "web"
  route_table_id = oci_core_route_table.pilot.id
  security_list_ids = [oci_core_security_list.pilot.id]
  prohibit_public_ip_on_vnic = false
}
resource "oci_core_volume" "data" {
  compartment_id = oci_identity_compartment.pilot.id
  availability_domain = data.oci_identity_availability_domains.available.availability_domains[0].name
  display_name = "90s6-pilot-data"
  size_in_gbs = 100
  vpus_per_gb = 0
  lifecycle {
    prevent_destroy = true
  }
}
