# Phase 0 test servers: plain Ubuntu/Debian VMs that act as "customer VPSes"
# for the deploy spike. Nothing is installed on them here on purpose: the
# spike's bootstrap step installs Docker, Traefik etc., as it would on a real
# customer server.

locals {
  # AMI lookup per supported OS: owner account ID + name pattern + default SSH user.
  os_images = {
    "ubuntu-24.04" = { owner = "099720109477", name = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*", user = "ubuntu" }
    "ubuntu-22.04" = { owner = "099720109477", name = "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*", user = "ubuntu" }
    "debian-12"    = { owner = "136693071363", name = "debian-12-amd64-*", user = "admin" }
  }

  # Only look up AMIs for operating systems actually used.
  used_os = toset([for s in values(var.servers) : s.os])

  ssh_cidrs = length(var.allowed_ssh_cidrs) > 0 ? var.allowed_ssh_cidrs : ["${chomp(data.http.my_ip.response_body)}/32"]
}

# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

# Your current public IP, used to restrict SSH when allowed_ssh_cidrs is empty.
data "http" "my_ip" {
  url = "https://checkip.amazonaws.com"
}

# Latest official image for each OS in use.
data "aws_ami" "os" {
  for_each = local.used_os

  most_recent = true
  owners      = [local.os_images[each.key].owner]

  filter {
    name   = "name"
    values = [local.os_images[each.key].name]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Default VPC keeps this simple and free (no NAT gateway costs).
data "aws_vpc" "default" {
  default = true
}

# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------

resource "aws_key_pair" "admin" {
  key_name   = "${var.project}-admin"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

# Same firewall a customer VPS would have: SSH (restricted) + HTTP/HTTPS (public).
resource "aws_security_group" "test_server" {
  name        = "${var.project}-test-server"
  description = "Phase 0 test servers: SSH from admin IPs, HTTP/HTTPS from anywhere"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each = toset(local.ssh_cidrs)

  security_group_id = aws_security_group.test_server.id
  description       = "SSH from admin"
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each = { http = 80, https = 443 }

  security_group_id = aws_security_group.test_server.id
  description       = upper(each.key)
  ip_protocol       = "tcp"
  from_port         = each.value
  to_port           = each.value
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.test_server.id
  description       = "All outbound: apt, Docker Hub, GitHub, Lets Encrypt"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------------------
# Servers
# ---------------------------------------------------------------------------

resource "aws_instance" "server" {
  for_each = var.servers

  ami                    = data.aws_ami.os[each.value.os].id
  instance_type          = each.value.instance_type
  key_name               = aws_key_pair.admin.key_name
  vpc_security_group_ids = [aws_security_group.test_server.id]

  # Burstable instances: "standard" credits never bill extra (the default "unlimited" can).
  credit_specification {
    cpu_credits = "standard"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = each.value.disk_gb
    encrypted             = true
    delete_on_termination = true
  }

  # Require IMDSv2 (blocks a common SSRF credential-theft path).
  metadata_options {
    http_tokens = "required"
  }

  tags = {
    Name = "${var.project}-${each.key}"
    OS   = each.value.os
  }

  # A newer AMI being published must not replace a running test server.
  lifecycle {
    ignore_changes = [ami]
  }
}

# Static public IP so DNS records (e.g. spike.yourdomain.com) survive stop/start.
resource "aws_eip" "server" {
  for_each = var.servers

  domain   = "vpc"
  instance = aws_instance.server[each.key].id

  tags = {
    Name = "${var.project}-${each.key}"
  }
}

# Lets `terraform apply -var running=false` stop servers without destroying them.
resource "aws_ec2_instance_state" "server" {
  for_each = var.servers

  instance_id = aws_instance.server[each.key].id
  state       = var.running ? "running" : "stopped"
}

# ---------------------------------------------------------------------------
# Cost guard (optional)
# ---------------------------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  count = var.budget_email == "" ? 0 : 1

  name         = "${var.project}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
