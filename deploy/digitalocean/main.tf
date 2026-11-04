terraform {
  required_version = ">= 1.9, < 2.0"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}
# Uses DIGITALOCEAN_TOKEN from the caller; no token in files or Terraform variables.
provider "digitalocean" {}

locals {
  base = jsondecode(replace(file("${path.module}/../cloud-init.yaml"), "#cloud-config\n", ""))
  extra_files = [
    { path = "/opt/private-cloud-proxy/deploy/digitalocean/wait_dns.py", permissions = "0755", content = file("${path.module}/wait_dns.py") },
    { path = "/opt/private-cloud-proxy/deploy/digitalocean/activate_once.py", permissions = "0755", content = file("${path.module}/activate_once.py") },
    { path = "/etc/private-cloud-proxy/deployment.json", permissions = "0600", content = jsonencode({ domain = var.domain, email = var.email, client_cidr = var.client_cidr }) },
    { path = "/etc/systemd/system/private-cloud-activate.service", permissions = "0644", content = <<-UNIT
      [Unit]
      Description=Activate private proxy after DNS is ready
      After=network-online.target
      Wants=network-online.target
      ConditionPathExists=!/etc/private-cloud-proxy/ACTIVATION_ATTEMPTED
      [Service]
      Type=oneshot
      ExecCondition=/usr/bin/python3 /opt/private-cloud-proxy/deploy/digitalocean/wait_dns.py /etc/private-cloud-proxy/deployment.json
      ExecStart=/usr/bin/python3 /opt/private-cloud-proxy/deploy/digitalocean/activate_once.py /etc/private-cloud-proxy/deployment.json
      UNIT
    },
    { path = "/etc/systemd/system/private-cloud-activate.timer", permissions = "0644", content = <<-UNIT
      [Unit]
      Description=Wait for public DNS before proxy activation
      [Timer]
      OnBootSec=2min
      OnUnitInactiveSec=2min
      [Install]
      WantedBy=timers.target
      UNIT
    }
  ]
  cloud_init = merge(local.base, {
    write_files = concat(local.base.write_files, local.extra_files)
    runcmd = concat(local.base.runcmd, [
      ["systemctl", "daemon-reload"],
      ["systemctl", "enable", "--now", "private-cloud-activate.timer"]
    ])
  })
}

resource "digitalocean_droplet" "proxy" {
  name          = "private-cloud-proxy"
  image         = "ubuntu-24-04-x64"
  region        = var.region
  size          = "s-1vcpu-512mb-10gb"
  backups       = false
  ipv6          = false
  monitoring    = false
  droplet_agent = true
  user_data     = "#cloud-config\n${jsonencode(local.cloud_init)}"
  lifecycle {
    precondition {
      condition     = var.allow_paid_deployment
      error_message = "BLOCKED: no paid deployment is authorized. Obtain explicit budget approval before enabling this."
    }
  }
}

resource "digitalocean_firewall" "proxy" {
  name        = "private-cloud-proxy"
  droplet_ids = [digitalocean_droplet.proxy.id]
  # TLS proxy listener remains stopped until certs, authentication and OS ACL exist.
  inbound_rule {
    protocol         = "tcp"
    port_range       = "8443"
    source_addresses = [var.client_cidr]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0"]
  }
  # Browser-based Droplet Console uses SSH on the VM; no SSH client on Windows.
  # Source may differ for the web console; Recovery Console is the fallback.
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = [var.client_cidr]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "53"
    destination_addresses = ["0.0.0.0/0"]
  }
}

output "public_ipv4" {
  value = digitalocean_droplet.proxy.ipv4_address
}
output "proxy_url" {
  description = "Candidate URL only; must pass remote acceptance tests before use."
  value       = "https://${var.domain}:8443"
}
output "dns_record_to_create" {
  value = "A ${var.domain} -> ${digitalocean_droplet.proxy.ipv4_address} (no conflicting AAAA)"
}
