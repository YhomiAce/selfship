.PHONY: init plan up stop start down status ssh-1gb ssh-2gb

init:      ## Download providers (run once)
	terraform init

plan:      ## Preview changes
	terraform plan

up:        ## Create (or update) servers and start them
	terraform apply -var running=true

stop:      ## Stop servers, keep disks + IPs (cheap pause)
	terraform apply -var running=false

start:     ## Start stopped servers
	terraform apply -var running=true

down:      ## Destroy everything (zero cost)
	terraform destroy

status:    ## Show IPs and SSH commands
	terraform output servers

ssh-1gb:
	$$(terraform output -json servers | jq -r '."test-1gb".ssh')

ssh-2gb:
	$$(terraform output -json servers | jq -r '."test-2gb".ssh')
