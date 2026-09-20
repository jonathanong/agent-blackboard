terraform {
  required_version = ">= 1.10.0"

  backend "s3" {}

  required_providers {
    sentry = {
      source  = "jianyuan/sentry"
      version = "= 0.15.7"
    }
  }
}

provider "sentry" {}
