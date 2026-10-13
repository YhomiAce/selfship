output "servers" {
  description = "Connection details per test server."
  value = {
    for name, s in var.servers : name => {
      public_ip = aws_eip.server[name].public_ip
      ssh_user  = local.os_images[s.os].user
      ssh       = "ssh ${local.os_images[s.os].user}@${aws_eip.server[name].public_ip}"
      os        = s.os
      type      = s.instance_type
      state     = aws_ec2_instance_state.server[name].state
    }
  }
}

output "ssh_allowed_from" {
  description = "CIDRs currently allowed to SSH in. Re-run apply if your IP changes."
  value       = local.ssh_cidrs
}
