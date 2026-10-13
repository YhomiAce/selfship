terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  # Every resource gets these tags so costs are easy to find in the billing console.
  default_tags {
    tags = {
      Project     = var.project
      Environment = "phase0-test"
      ManagedBy   = "terraform"
    }
  }
}
