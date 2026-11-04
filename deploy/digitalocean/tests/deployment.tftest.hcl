# All providers mocked. No cloud API calls and no paid resources.
mock_provider "digitalocean" {}
variables {
  domain      = "proxy.example.com"
  email       = "owner@example.com"
  client_cidr = "8.8.8.8/32"
}
run "refuse_unapproved_cost" {
  command         = plan
  expect_failures = [digitalocean_droplet.proxy]
}
run "prepare_dedicated_vm" {
  command = plan
  variables { allow_paid_deployment = true }
  assert {
    condition     = digitalocean_droplet.proxy.size == "s-1vcpu-512mb-10gb" && !digitalocean_droplet.proxy.backups && !digitalocean_droplet.proxy.ipv6
    error_message = "Unexpected size or enabled add-ons."
  }
  assert {
    condition     = length(jsondecode(replace(digitalocean_droplet.proxy.user_data, "#cloud-config\n", "")).write_files) == 12
    error_message = "Incomplete bootstrap files."
  }
  assert {
    condition     = strcontains(digitalocean_droplet.proxy.user_data, "ACTIVATION_ATTEMPTED") && strcontains(digitalocean_droplet.proxy.user_data, "ExecCondition=")
    error_message = "Activation must wait for DNS and never replay a partial attempt."
  }
  assert {
    condition     = length(digitalocean_firewall.proxy.inbound_rule) == 3
    error_message = "Unexpected inbound exposure."
  }
}
run "reject_open_network" {
  command = plan
  variables {
    allow_paid_deployment = true
    client_cidr           = "0.0.0.0/0"
  }
  expect_failures = [var.client_cidr]
}
