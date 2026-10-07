terraform {
  required_version = ">= 1.6.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.43"
    }
    # Pinned to the 4.x line: 5.x renamed most resources/attributes used here
    # (cloudflare_record → cloudflare_dns_record, zone settings, rulesets).
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.52"
    }
  }

  # Remote state. DigitalOcean Spaces is S3-compatible; configure with
  #   terraform init -backend-config=backend.hcl
  # where backend.hcl (git-ignored) holds bucket/endpoint/keys. See README.
  backend "s3" {
    key                         = "codify/infra.tfstate"
    region                      = "us-east-1" # ignored by Spaces, required by the backend
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_s3_checksum            = true
    use_path_style              = false
  }
}

provider "digitalocean" {
  token = var.do_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
