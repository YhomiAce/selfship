output "ip" {
  description = "Current public IP (changes after stop/start)."
  value       = aws_instance.server.public_ip
}

output "url" {
  description = "Dashboard URL."
  value       = "https://${var.domain}"
}

output "ssh" {
  description = "Admin SSH."
  value       = "ssh ubuntu@${var.domain}"
}

output "known_hosts" {
  description = "Line for CI's known_hosts (the pinned host key)."
  value       = "${var.domain} ${trimspace(tls_private_key.host.public_key_openssh)}"
}

output "deploy_private_key" {
  description = "CI deploy key (GitHub environment secret DEPLOY_SSH_KEY)."
  value       = tls_private_key.deploy.private_key_openssh
  sensitive   = true
}
