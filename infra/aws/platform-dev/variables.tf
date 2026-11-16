variable "environment" {
  description = "Environment name: resource names, tags and the GitHub environment."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "eu-north-1"
}

variable "aws_profile" {
  description = "AWS CLI profile."
  type        = string
  default     = "selfship"
}

variable "instance_type" {
  description = "Server size. The whole stack uses ≈400 MB (measured), so t3.micro (1 GB + 2 GB swap, ≈ $8/month) fits; t3.small (2 GB, ≈ $16/month) for more headroom. Images are built in CI, not here. Changing it stops and restarts the server; the disk and database stay."
  type        = string
  default     = "t3.micro"
}

variable "disk_gb" {
  description = "Root disk: images, Postgres data, 7 days of backups."
  type        = number
  default     = 25
}

variable "domain" {
  description = "Hostname of this environment's dashboard."
  type        = string
  default     = "dev.selfship.dev"
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID of selfship.dev (dashboard → the zone → Overview → API, right column)."
  type        = string
}

variable "admin_ssh_public_key_path" {
  description = "Your public key, for the ubuntu admin user."
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "admin_cidrs" {
  description = "Where the ubuntu admin user may SSH from. The CI deploy user may connect from anywhere (GitHub runners have no fixed IPs) but can only run selfship-deploy."
  type        = list(string)
}

variable "github_repository" {
  description = "owner/name of the repo whose images and config are deployed."
  type        = string
  default     = "YhomiAce/selfship"
}

variable "running" {
  description = "false stops the server (only the disk is billed, ≈ $2/month). make start brings it back and updates DNS."
  type        = bool
  default     = true
}
