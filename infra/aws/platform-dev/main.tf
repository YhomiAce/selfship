# One Selfship environment (dev): a small Ubuntu server running the whole
# platform with Docker Compose, its DNS record, and the keys CI uses to deploy.
# Images are built in GitHub Actions and pulled from ghcr.io; secrets live in
# a local dev.env pushed with `make env-push` (this account's organization
# policy blocks SSM Run Command, Parameter Store and GitHub OIDC).

locals {
  name = "selfship-${var.environment}"
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

data "aws_vpc" "default" {
  default = true
}

# ---------------------------------------------------------------------------
# Keys
# ---------------------------------------------------------------------------

# Server host key: pinned in CI's known_hosts.
resource "tls_private_key" "host" {
  algorithm = "ED25519"
}

# CI deploy key: can only run selfship-deploy on the server.
resource "tls_private_key" "deploy" {
  algorithm = "ED25519"
}

resource "aws_key_pair" "admin" {
  key_name   = "${local.name}-admin"
  public_key = file(pathexpand(var.admin_ssh_public_key_path))
}

# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

resource "aws_security_group" "server" {
  name        = local.name
  description = "Selfship ${var.environment}: SSH (key-only; admin limited by sshd), HTTP, HTTPS"
  vpc_id      = data.aws_vpc.default.id
}

# Open to all: GitHub runners have no fixed IPs. sshd only lets the ubuntu
# admin in from admin_cidrs, and the deploy key is restricted to one command.
resource "aws_vpc_security_group_ingress_rule" "public" {
  for_each = { ssh = 22, http = 80, https = 443 }

  security_group_id = aws_security_group.server.id
  description       = upper(each.key)
  ip_protocol       = "tcp"
  from_port         = each.value
  to_port           = each.value
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.server.id
  description       = "All outbound: ghcr.io, GitHub, Lets Encrypt, user servers"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

resource "aws_instance" "server" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.admin.key_name
  vpc_security_group_ids = [aws_security_group.server.id]

  # "standard" never bills extra CPU credits; the stack idles at a few % CPU.
  credit_specification {
    cpu_credits = "standard"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.disk_gb
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_tokens = "required"
  }

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    host_private_key  = tls_private_key.host.private_key_openssh
    host_public_key   = trimspace(tls_private_key.host.public_key_openssh)
    deploy_public_key = trimspace(tls_private_key.deploy.public_key_openssh)
    deploy_script_b64 = filebase64("${path.module}/../../../deploy/server/selfship-deploy")
    admin_allow       = join(" ", [for cidr in var.admin_cidrs : "ubuntu@${cidr}"])
    github_repository = var.github_repository
  })

  tags = { Name = local.name }

  lifecycle {
    # Later changes to cloud-init or the deploy script go out with
    # `make server-update`, not by replacing the server (and its database).
    ignore_changes = [ami, user_data]
  }
}

resource "aws_ec2_instance_state" "server" {
  instance_id = aws_instance.server.id
  state       = var.running ? "running" : "stopped"
}

# No Elastic IP: an idle one bills while the server is stopped. The public IP
# changes on stop/start; `make start` applies twice to update this record.
resource "cloudflare_dns_record" "dashboard" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "A"
  content = aws_instance.server.public_ip
  ttl     = 60
  # DNS only: Caddy gets the certificate itself (HTTP challenge).
  proxied = false
  comment = "Selfship ${var.environment} (Terraform: infra/aws/platform-dev)"
}
