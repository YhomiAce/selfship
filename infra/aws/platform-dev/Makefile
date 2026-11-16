# Selfship dev environment (dev.selfship.dev). See README.md.
# Needs: terraform, the AWS "selfship" profile, CLOUDFLARE_API_TOKEN in the
# environment (Edit zone DNS on selfship.dev), gh (logged in) for github-env.

ENV      ?= dev
REPO     ?= YhomiAce/selfship
DOMAIN   := $(shell terraform output -raw url 2>/dev/null | sed 's|https://||')
KNOWN    := .known_hosts
SSH      := ssh -o UserKnownHostsFile=$(KNOWN) -o CheckHostIP=no
DEPLOYCMD = sudo -u deploy env $$(cat /etc/selfship/deploy.env) /usr/local/bin/selfship-deploy

.PHONY: help init plan up start stop down ready ssh status deploy logs env-init env-push github-env server-update backup backups

help:          ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 16

init:          ## Download providers (once)
	terraform init

plan:          ## Preview changes
	terraform plan

up:            ## Create or update the server and DNS (≈3 min; then `make ready`)
	terraform apply
	@terraform output -raw known_hosts > $(KNOWN) && echo >> $(KNOWN)

start:         ## Start a stopped server and point DNS at its new IP (two applies: start, then DNS)
	terraform apply -auto-approve -var running=true
	terraform apply -auto-approve -var running=true

stop:          ## Stop the server: only the disk is billed (≈ $2/month); the site is down
	terraform apply -var running=false

down:          ## Destroy everything, including the database (download a backup first: make backups)
	terraform destroy

$(KNOWN):
	@terraform output -raw known_hosts > $(KNOWN) && echo >> $(KNOWN)

ready: $(KNOWN) ## Has first-boot setup finished? (Docker, deploy user, swap)
	@$(SSH) ubuntu@$(DOMAIN) 'test -f /var/lib/selfship-ready && echo "ready" || echo "still installing (cloud-init)"'

ssh: $(KNOWN)  ## Admin shell on the server
	$(SSH) ubuntu@$(DOMAIN)

status: $(KNOWN) ## Deployed commit and container states
	@$(SSH) ubuntu@$(DOMAIN) '$(DEPLOYCMD) status'

deploy: $(KNOWN) ## Deploy (or roll back to) a commit by hand: make deploy SHA=<40-char sha>
	@test -n "$(SHA)" || { echo "Usage: make deploy SHA=<commit sha>"; exit 1; }
	$(SSH) ubuntu@$(DOMAIN) '$(DEPLOYCMD) deploy $(SHA)'

logs: $(KNOWN)  ## Follow logs: make logs [S=api|worker|web|migrate|caddy|postgres|redis]
	$(SSH) -t ubuntu@$(DOMAIN) 'cd /opt/selfship && sudo -u deploy env SELFSHIP_TAG=$$(cat .current-tag) docker compose -f compose.yml --env-file .env logs -f --tail 100 $(S)'

env-init:      ## Create dev.env with generated secrets (never overwrites)
	@test ! -f dev.env || { echo "dev.env already exists"; exit 1; }
	@umask 077; sed \
	  -e 's#^SELFSHIP_DOMAIN=.*#SELFSHIP_DOMAIN=$(or $(DOMAIN),dev.selfship.dev)#' \
	  -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$$(openssl rand -hex 24)#" \
	  -e "s#^ENCRYPTION_KEY=.*#ENCRYPTION_KEY=$$(openssl rand -base64 32)#" \
	  -e 's#^RESERVED_DOMAINS=.*#RESERVED_DOMAINS=selfship.dev,selfship.app#' \
	  ../../../.env.selfhost.example > dev.env
	@printf '\n# Tags error reports with the environment\nSENTRY_ENVIRONMENT=$(ENV)\n' >> dev.env
	@echo "Created dev.env (mode 600). Fill in SMTP and the GitHub App, then: make env-push"
	@echo "Back up ENCRYPTION_KEY somewhere safe: without it, stored SSH keys and env vars can't be decrypted."

env-push: $(KNOWN) ## Upload dev.env to the server and restart the running version with it
	@test -f dev.env || { echo "No dev.env: run make env-init"; exit 1; }
	@$(SSH) ubuntu@$(DOMAIN) 'sudo install -o deploy -g deploy -m 600 /dev/stdin /opt/selfship/.env' < dev.env
	@echo "Uploaded."
	@$(SSH) ubuntu@$(DOMAIN) 'if test -f /opt/selfship/.current-tag; then $(DEPLOYCMD) deploy $$(cat /opt/selfship/.current-tag); else echo "Nothing deployed yet: push to main (or make deploy SHA=...)"; fi'

github-env:    ## Create/refresh the GitHub environment: deploy key, host, known_hosts; deploys from main only
	echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' | gh api -X PUT repos/$(REPO)/environments/$(ENV) --input - >/dev/null
	-gh api -X POST repos/$(REPO)/environments/$(ENV)/deployment-branch-policies -f name=main -f type=branch >/dev/null 2>&1
	terraform output -raw deploy_private_key | gh secret set DEPLOY_SSH_KEY --env $(ENV) --repo $(REPO)
	gh variable set DEPLOY_HOST --env $(ENV) --repo $(REPO) --body "$(DOMAIN)"
	gh variable set DEPLOY_KNOWN_HOSTS --env $(ENV) --repo $(REPO) --body "$$(terraform output -raw known_hosts)"
	gh variable set APP_URL --env $(ENV) --repo $(REPO) --body "https://$(DOMAIN)"
	@echo "GitHub environment '$(ENV)' is set up for $(REPO)."

server-update: $(KNOWN) ## Install the current deploy/server/selfship-deploy on the server
	@$(SSH) ubuntu@$(DOMAIN) 'sudo install -m 755 /dev/stdin /usr/local/bin/selfship-deploy' < ../../../deploy/server/selfship-deploy
	@echo "selfship-deploy updated."

backup: $(KNOWN) ## Take a database backup now
	@$(SSH) ubuntu@$(DOMAIN) 'sudo -u deploy /usr/local/bin/selfship-backup && sudo ls -lh /opt/selfship/backups | tail -3'

backups: $(KNOWN) ## Download the newest backup into ./backups/
	@mkdir -p backups
	@f=$$($(SSH) ubuntu@$(DOMAIN) 'sudo ls -t /opt/selfship/backups/ | grep sql.gz | head -1'); \
	  $(SSH) ubuntu@$(DOMAIN) "sudo cat /opt/selfship/backups/$$f" > backups/$$f && echo "backups/$$f"
