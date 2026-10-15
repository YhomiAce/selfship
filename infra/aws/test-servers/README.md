# Phase 0 test servers (AWS)

Creates fresh Ubuntu/Debian servers that act as **customer VPSes** for the deploy spike. They're left untouched on purpose: the spike's bootstrap installs Docker and Traefik, as it will on real customer servers.

## What gets created

| Resource                                                                    | Purpose                                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2 × EC2 (`test-1gb` t3.micro, `test-2gb` t3.small, Ubuntu 24.04, 20 GB gp3) | Measure builds on 1 GB vs 2 GB, as in the [Phase 0 experiments](../../../docs/implementation/phase-0-foundations.md) |
| Elastic IP per server                                                       | Stable IP, so your Cloudflare DNS record survives stop/start                                                         |
| Security group                                                              | SSH from **your IP only** (auto-detected), 80/443 from anywhere                                                      |
| Key pair                                                                    | Your `~/.ssh/id_rsa.pub`                                                                                             |
| Budget alert (optional)                                                     | Email when spend nears `budget_usd`                                                                                  |

Uses the **default VPC**, so there's no NAT gateway or other hidden cost.

## Rough cost (us-east-1, on-demand)

| State                   | ~Cost                                                          |
| ----------------------- | -------------------------------------------------------------- |
| Both running 24/7       | ~$30/month (instances ~$23 + public IPv4 ~$7.30 + disk ~$3.20) |
| Stopped (`make stop`)   | ~$10.50/month (disk + IPv4 addresses)                          |
| Destroyed (`make down`) | $0                                                             |

Running only during test sessions (e.g. 20 h/week) costs a few dollars a month. **Stop or destroy when you're done.**

## Prerequisites

1. AWS account + an IAM user/role with EC2 + Budgets permissions
2. `aws configure` (or a named profile). Check with `aws sts get-caller-identity`
3. Terraform ≥ 1.6, `jq` (for the `ssh-*` make targets)

## Usage

```bash
cd infra/aws/test-servers
cp terraform.tfvars.example terraform.tfvars   # optional: profile, region, budget email
make init
make up        # create + start  → prints IPs and SSH commands
make status    # show IPs again
make ssh-2gb   # SSH into the 2 GB box

make stop      # pause (keeps IPs + disks)
make start     # resume
make down      # destroy everything
```

## Point a domain at the test server (Cloudflare)

After `make up`, in Cloudflare DNS for your domain:

| Type | Name      | Content                | Proxy                     |
| ---- | --------- | ---------------------- | ------------------------- |
| A    | `spike`   | `<test-2gb public_ip>` | **DNS only** (grey cloud) |
| A    | `*.spike` | `<test-2gb public_ip>` | **DNS only**              |

Keep the record **DNS only**. Traefik has to get Let's Encrypt certificates directly, so traffic must not go through Cloudflare's proxy.

## Notes

- **IP changed?** If your home IP changes, SSH will time out. Re-run `make up` to update the allowed IP. If your ISP keeps rotating it (`curl https://checkip.amazonaws.com` shows a different address each time), set `allowed_ssh_cidrs` to your ISP's block in `terraform.tfvars` (see the example file). SSH stays key-only.
- **Fresh server for every test run:** `terraform apply -replace='aws_instance.server["test-2gb"]'` rebuilds one server from scratch and keeps the IP.
- State is stored locally in `terraform.tfstate` (gitignored). It only holds public data here, but don't commit it.
