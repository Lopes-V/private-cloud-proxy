variable "allow_paid_deployment" {
  description = "Explicit budget authorization. False prevents creation; no paid resources have been authorized in this session."
  type        = bool
  default     = false
}
variable "domain" {
  type        = string
  description = "An existing controlled subdomain; create its A record after the VM gets an IPv4. No domain is purchased."
  validation {
    condition     = length(var.domain) <= 253 && can(regex("^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$", var.domain))
    error_message = "Supply a valid DNS hostname."
  }
}
variable "email" {
  type        = string
  description = "ACME account email."
  validation {
    condition     = can(regex("^[^@ ]+@[^@ ]+\\.[^@ ]+$", var.email))
    error_message = "Supply an email address."
  }
}
variable "client_cidr" {
  type        = string
  description = "Authorized client's public IPv4 /32. Change it via authenticated administration when needed."
  validation {
    condition     = can(cidrnetmask(var.client_cidr)) && endswith(var.client_cidr, "/32")
    error_message = "Only a single IPv4 /32 is permitted."
  }
}
variable "region" {
  type        = string
  default     = "nyc3"
  description = "Candidate only: account API must confirm that the selected $4 size is available here."
}
