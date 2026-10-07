# Cloudflare: DNS (docs/13 §5), TLS (§6), WAF / rate limits / cache (§7,
# docs/14 §6) and the Pages projects for the two SPAs (docs/13 §3).

data "cloudflare_zone" "main" {
  name = var.zone_name
}

locals {
  zone_id = data.cloudflare_zone.main.id
  api_hosts = [
    "api.${var.zone_name}",
    "api.staging.${var.zone_name}",
  ]
  api_hosts_expr = join(" ", [for h in local.api_hosts : "\"${h}\""])
}

# ── Pages projects (direct upload from GitHub Actions) ───────────────────────
# Production and staging are separate projects so each has its own production
# deployment + custom domains; PR previews deploy to the staging projects as
# preview branches (pr-<n>.<project>.pages.dev).

locals {
  pages_projects = {
    student         = { name = "codify-student", domains = [var.zone_name, "app.${var.zone_name}"] }
    admin           = { name = "codify-admin", domains = ["admin.${var.zone_name}"] }
    student_staging = { name = "codify-student-staging", domains = ["staging.${var.zone_name}"] }
    admin_staging   = { name = "codify-admin-staging", domains = ["admin.staging.${var.zone_name}"] }
    # Component catalogs published by storybook.yml (*.pages.dev only).
    storybook_admin   = { name = "codify-storybook-admin", domains = [] }
    storybook_student = { name = "codify-storybook-student", domains = [] }
  }
  pages_domains = merge([
    for key, p in local.pages_projects : {
      for d in p.domains : "${key}:${d}" => { project = p.name, domain = d }
    }
  ]...)
}

resource "cloudflare_pages_project" "app" {
  for_each          = local.pages_projects
  account_id        = var.cloudflare_account_id
  name              = each.value.name
  production_branch = var.pages_production_branch
}

resource "cloudflare_pages_domain" "app" {
  for_each     = local.pages_domains
  account_id   = var.cloudflare_account_id
  project_name = each.value.project
  domain       = each.value.domain

  depends_on = [cloudflare_pages_project.app]
}

# ── DNS ──────────────────────────────────────────────────────────────────────

# Apex → student PWA on Pages (CNAME flattening at the apex).
resource "cloudflare_record" "apex" {
  zone_id = local.zone_id
  name    = "@"
  type    = "CNAME"
  content = cloudflare_pages_project.app["student"].subdomain
  proxied = true
  ttl     = 1
  comment = "Student PWA (Cloudflare Pages)"
}

resource "cloudflare_record" "app_alias" {
  zone_id = local.zone_id
  name    = "app"
  type    = "CNAME"
  content = var.zone_name
  proxied = true
  ttl     = 1
  comment = "Alias of the student PWA"
}

resource "cloudflare_record" "admin" {
  zone_id = local.zone_id
  name    = "admin"
  type    = "CNAME"
  content = cloudflare_pages_project.app["admin"].subdomain
  proxied = true
  ttl     = 1
  comment = "Admin SPA (Cloudflare Pages)"
}

resource "cloudflare_record" "api" {
  zone_id = local.zone_id
  name    = "api"
  type    = "A"
  content = digitalocean_droplet.app.ipv4_address
  proxied = true
  ttl     = 1
  comment = "API on vps-app-01 (Coolify proxy, origin cert)"
}

resource "cloudflare_record" "api_v6" {
  zone_id = local.zone_id
  name    = "api"
  type    = "AAAA"
  content = digitalocean_droplet.app.ipv6_address
  proxied = true
  ttl     = 1
}

resource "cloudflare_record" "staging" {
  zone_id = local.zone_id
  name    = "staging"
  type    = "CNAME"
  content = cloudflare_pages_project.app["student_staging"].subdomain
  proxied = true
  ttl     = 1
  comment = "Staging student PWA"
}

resource "cloudflare_record" "admin_staging" {
  zone_id = local.zone_id
  name    = "admin.staging"
  type    = "CNAME"
  content = cloudflare_pages_project.app["admin_staging"].subdomain
  proxied = true
  ttl     = 1
  comment = "Staging admin SPA"
}

resource "cloudflare_record" "api_staging" {
  zone_id = local.zone_id
  name    = "api.staging"
  type    = "A"
  content = digitalocean_droplet.staging.ipv4_address
  proxied = true
  ttl     = 1
  comment = "Staging API on vps-staging-01"
}

resource "cloudflare_record" "cdn" {
  count   = var.cdn_r2_target == "" ? 0 : 1
  zone_id = local.zone_id
  name    = "cdn"
  type    = "CNAME"
  content = var.cdn_r2_target
  proxied = true
  ttl     = 1
  comment = "R2 public bucket custom domain"
}

resource "cloudflare_record" "email" {
  for_each = var.email_dns_records
  zone_id  = local.zone_id
  name     = each.value.name
  type     = each.value.type
  content  = each.value.content
  priority = each.value.priority
  ttl      = each.value.ttl
  proxied  = false
}

# ── TLS + zone hardening (docs/13 §6, §7) ────────────────────────────────────

resource "cloudflare_zone_settings_override" "main" {
  zone_id = local.zone_id

  settings {
    ssl                      = "strict" # Full (strict): origin presents a Cloudflare Origin Certificate
    always_use_https         = "on"
    automatic_https_rewrites = "on"
    min_tls_version          = "1.2"
    tls_1_3                  = "on"
    opportunistic_encryption = "on"
    brotli                   = "on"
    browser_check            = "on"
    security_level           = "medium"
    http3                    = "on"

    security_header {
      enabled            = true
      max_age            = 15552000
      include_subdomains = true
      preload            = true
      nosniff            = true
    }
  }
}

# Universal SSL only covers one subdomain level (*.codify.app). The staging
# hosts from docs/13 §5 (admin.staging / api.staging) are two levels deep, so
# they need an Advanced Certificate Manager pack (paid add-on). Set
# enable_staging_edge_cert = false only if you rename them to one level.
resource "cloudflare_certificate_pack" "staging" {
  count                 = var.enable_staging_edge_cert ? 1 : 0
  zone_id               = local.zone_id
  type                  = "advanced"
  hosts                 = [var.zone_name, "*.${var.zone_name}", "*.staging.${var.zone_name}"]
  validation_method     = "txt"
  validity_days         = 90
  certificate_authority = "google"
  cloudflare_branding   = false
}

resource "cloudflare_bot_management" "main" {
  zone_id    = local.zone_id
  fight_mode = true # Bot Fight Mode (basic) — docs/13 §7
}

# ── WAF: managed rulesets (Pro+) ─────────────────────────────────────────────

resource "cloudflare_ruleset" "waf_managed" {
  count       = var.cloudflare_plan_has_managed_waf ? 1 : 0
  zone_id     = local.zone_id
  name        = "Codify managed WAF"
  description = "Cloudflare Managed Ruleset + OWASP Core Ruleset"
  kind        = "zone"
  phase       = "http_request_firewall_managed"

  rules {
    action      = "execute"
    expression  = "true"
    description = "Cloudflare Managed Ruleset"
    enabled     = true
    action_parameters {
      id = "efb7b8c949ac4650a09736fc376e9aee"
    }
  }

  rules {
    action      = "execute"
    expression  = "true"
    description = "Cloudflare OWASP Core Ruleset"
    enabled     = true
    action_parameters {
      id = "4814384a9e5d4991b9815dcfc25d2f1f"
    }
  }
}

# ── WAF: custom rules — webhook source allowlists (docs/14 §6) ───────────────
# Defense in depth only; the API still verifies every signature.

locals {
  webhook_allowlists = {
    stripe     = var.stripe_webhook_ips
    revenuecat = var.revenuecat_webhook_ips
  }
  enforced_webhook_allowlists = { for k, ips in local.webhook_allowlists : k => ips if length(ips) > 0 }
}

resource "cloudflare_ruleset" "waf_custom" {
  zone_id     = local.zone_id
  name        = "Codify custom firewall rules"
  description = "Webhook source allowlists and admin-only methods"
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  dynamic "rules" {
    for_each = local.enforced_webhook_allowlists
    content {
      action      = "block"
      description = "Only ${rules.key} may call /api/webhooks/${rules.key}"
      enabled     = true
      expression  = "(http.host in {${local.api_hosts_expr}} and http.request.uri.path eq \"/api/webhooks/${rules.key}\" and not ip.src in {${join(" ", rules.value)}})"
    }
  }

  rules {
    action      = "block"
    description = "Webhooks accept POST only"
    enabled     = true
    expression  = "(http.host in {${local.api_hosts_expr}} and starts_with(http.request.uri.path, \"/api/webhooks/\") and http.request.method ne \"POST\")"
  }
}

# ── Rate limiting (docs/14 §6–7) ─────────────────────────────────────────────
# Free plans allow one rate-limiting rule with a 10 s period; the webhook rule
# is the one we keep. Per-user limits for submissions/AI grading live in the
# API (Redis token buckets) — Cloudflare is the coarse per-IP backstop.

resource "cloudflare_ruleset" "rate_limits" {
  zone_id     = local.zone_id
  name        = "Codify rate limits"
  description = "Per-IP backstop limits"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules {
    action      = "block"
    description = "Webhook endpoints: ${var.webhook_rate_limit} req / 10s per IP"
    enabled     = true
    expression  = "(http.host in {${local.api_hosts_expr}} and starts_with(http.request.uri.path, \"/api/webhooks/\"))"
    ratelimit {
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 10
      requests_per_period = var.webhook_rate_limit
      mitigation_timeout  = 10
    }
  }
}

# ── Cache rules: never cache the API (docs/13 §7) ────────────────────────────

resource "cloudflare_ruleset" "cache" {
  zone_id     = local.zone_id
  name        = "Codify cache rules"
  description = "Bypass cache for API hosts"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules {
    action      = "set_cache_settings"
    description = "API responses are never cached at the edge"
    enabled     = true
    expression  = "(http.host in {${local.api_hosts_expr}})"
    action_parameters {
      cache = false
    }
  }
}
