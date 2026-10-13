variable "project" {
  description = "Project name used for resource names and tags."
  type        = string
  default     = "selfship"
}

variable "aws_region" {
  description = "AWS region for the test servers. us-east-1 is usually the cheapest."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use (see ~/.aws/credentials). null uses the default credential chain."
  type        = string
  default     = null
}

variable "ssh_public_key_path" {
  description = "Path to the public key installed on the servers as the default user's authorized key."
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "allowed_ssh_cidrs" {
  description = "CIDRs allowed to SSH in. Empty list = auto-detect your current public IP (/32)."
  type        = list(string)
  default     = []
}

variable "running" {
  description = "true = servers running; false = stopped (you keep the disk and IP, and pay only for storage + IP)."
  type        = bool
  default     = true
}

variable "servers" {
  description = <<-EOT
    Test servers to create, keyed by a short name. Each one is a fresh, untouched
    VPS, the same as a customer's server would be. Our deploy spike bootstraps it.
      instance_type : EC2 size (t3.micro = 1 GB, t3.small = 2 GB)
      os            : "ubuntu-24.04" | "ubuntu-22.04" | "debian-12"
      disk_gb       : root volume size
  EOT
  type = map(object({
    instance_type = string
    os            = string
    disk_gb       = number
  }))
  default = {
    "test-1gb" = { instance_type = "t3.micro", os = "ubuntu-24.04", disk_gb = 20 }
    "test-2gb" = { instance_type = "t3.small", os = "ubuntu-24.04", disk_gb = 20 }
  }

  validation {
    condition     = alltrue([for s in values(var.servers) : contains(["ubuntu-24.04", "ubuntu-22.04", "debian-12"], s.os)])
    error_message = "os must be one of: ubuntu-24.04, ubuntu-22.04, debian-12."
  }
}

variable "budget_email" {
  description = "If set, creates a monthly AWS budget that emails this address at 80% and 100% of budget_usd."
  type        = string
  default     = ""
}

variable "budget_usd" {
  description = "Monthly budget limit in USD for the alert."
  type        = number
  default     = 20
}
