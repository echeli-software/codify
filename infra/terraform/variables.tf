# ── Credentials (pass via TF_VAR_* env vars, never commit) ───────────────────

variable "do_token" {
  description = "DigitalOcean API token (read/write). TF_VAR_do_token."
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:DNS/Zone Settings/Firewall/Rulesets edit on the zone and Account:Cloudflare Pages edit. TF_VAR_cloudflare_api_token."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id (Pages projects live at account level)."
  type        = string
}

# ── Placement ───────────────────────────────────────────────────────────────

variable "region" {
  description = <<-EOT
    DigitalOcean region slug for every droplet, the VPC and both database
    clusters. docs/13 targets São Paulo for Brazilian latency; confirm the
    slug with `doctl compute region list` (and that Managed Postgres is
    offered there with `doctl databases options regions`) before applying.
  EOT
  type        = string
}

variable "project_name" {
  description = "DigitalOcean project that groups all resources."
  type        = string
  default     = "codify"
}

variable "vpc_ip_range" {
  description = "Private range for the shared VPC (app, staging, Judge0, databases)."
  type        = string
  default     = "10.20.0.0/20"
}

# ── Droplets (docs/13 §1) ────────────────────────────────────────────────────

variable "droplet_image" {
  description = "Base image for all droplets."
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "app_droplet_size" {
  description = "vps-app-01: API + workers + Redis + Coolify (4 vCPU / 8 GB)."
  type        = string
  default     = "s-4vcpu-8gb"
}

variable "judge0_droplet_size" {
  description = "vps-judge0-01: Judge0 server + isolate workers (4 vCPU / 8 GB)."
  type        = string
  default     = "s-4vcpu-8gb"
}

variable "staging_droplet_size" {
  description = "vps-staging-01: staging API + Redis + Coolify (2 vCPU / 4 GB)."
  type        = string
  default     = "s-2vcpu-4gb"
}

variable "droplet_backups" {
  description = "Enable DO weekly droplet backups on vps-app-01 (Judge0 + staging are rebuildable)."
  type        = bool
  default     = true
}

variable "ssh_key_fingerprints" {
  description = "Fingerprints of SSH keys already uploaded to DO (one per operator). Password auth is disabled."
  type        = list(string)
}

variable "admin_ssh_cidrs" {
  description = "CIDRs allowed to SSH (22) and reach the Coolify dashboard (8000). Use operator/VPN egress IPs, never 0.0.0.0/0."
  type        = list(string)
}

variable "judge0_allow_staging" {
  description = "Let vps-staging-01 reach Judge0 too (staging shares the prod Judge0 host). Set false to keep Judge0 prod-only; staging then uses the dev executor."
  type        = bool
  default     = true
}

# ── Managed Postgres (docs/13 §1) ────────────────────────────────────────────

variable "pg_version" {
  description = "PostgreSQL major version for both clusters."
  type        = string
  default     = "16"
}

variable "pg_prod_size" {
  description = "do-pg-prod size slug (1 vCPU / 1 GB to start)."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "pg_prod_node_count" {
  description = "do-pg-prod nodes (2+ adds a standby for HA — post-launch, docs/13 §14)."
  type        = number
  default     = 1
}

variable "pg_staging_size" {
  description = "do-pg-staging size slug (smallest tier)."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

# ── Cloudflare (docs/13 §5–7) ────────────────────────────────────────────────

variable "zone_name" {
  description = "Apex domain managed in Cloudflare."
  type        = string
  default     = "codify.app"
}

variable "cloudflare_plan_has_managed_waf" {
  description = "true on Pro+ plans: deploy the Cloudflare Managed + OWASP rulesets. Free plans get Cloudflare's free managed ruleset automatically and must leave this false."
  type        = bool
  default     = false
}

variable "enable_staging_edge_cert" {
  description = "Order an Advanced Certificate Manager pack covering *.staging.<zone> (admin.staging / api.staging are two levels deep; Universal SSL doesn't cover them)."
  type        = bool
  default     = true
}

variable "webhook_rate_limit" {
  description = "Per-IP requests per 10 s allowed on /api/webhooks/* before Cloudflare blocks for 10 s."
  type        = number
  default     = 30
}

variable "stripe_webhook_ips" {
  description = "Stripe webhook source IPs (https://stripe.com/files/ips/ips_webhooks.txt). Non-empty → requests to /api/webhooks/stripe from other IPs are blocked (defense in depth; signature verification stays primary)."
  type        = list(string)
  default     = []
}

variable "revenuecat_webhook_ips" {
  description = "RevenueCat webhook source IPs (from RevenueCat docs). Non-empty → /api/webhooks/revenuecat only accepts these."
  type        = list(string)
  default     = []
}

variable "pages_production_branch" {
  description = "Branch name the workflows deploy to for a Pages project's production deployment."
  type        = string
  default     = "main"
}

variable "email_dns_records" {
  description = "MX/SPF/DKIM/DMARC records from the email provider (Postmark/Resend). Key = unique label."
  type = map(object({
    name     = string
    type     = string
    content  = string
    priority = optional(number)
    ttl      = optional(number, 3600)
  }))
  default = {}
}

variable "cdn_r2_target" {
  description = "Optional CNAME target for cdn.<zone> when the R2 custom domain is set up outside Terraform (see README). Empty = no record."
  type        = string
  default     = ""
}
