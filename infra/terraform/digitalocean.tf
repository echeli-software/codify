# DigitalOcean: VPC, droplets, cloud firewalls, managed Postgres (docs/13 §1).

resource "digitalocean_vpc" "main" {
  name        = "codify-vpc"
  region      = var.region
  ip_range    = var.vpc_ip_range
  description = "Private network for app, staging, Judge0 and managed Postgres"
}

locals {
  common_tags = ["codify", "terraform"]
}

# ── Droplets ─────────────────────────────────────────────────────────────────

resource "digitalocean_droplet" "app" {
  name       = "vps-app-01"
  region     = var.region
  size       = var.app_droplet_size
  image      = var.droplet_image
  vpc_uuid   = digitalocean_vpc.main.id
  ssh_keys   = var.ssh_key_fingerprints
  backups    = var.droplet_backups
  monitoring = true
  ipv6       = true
  tags       = concat(local.common_tags, ["role-app", "env-prod"])
  user_data  = templatefile("${path.module}/cloud-init/base.yaml.tftpl", { role = "app" })

  lifecycle {
    ignore_changes = [user_data, image]
  }
}

resource "digitalocean_droplet" "judge0" {
  name       = "vps-judge0-01"
  region     = var.region
  size       = var.judge0_droplet_size
  image      = var.droplet_image
  vpc_uuid   = digitalocean_vpc.main.id
  ssh_keys   = var.ssh_key_fingerprints
  monitoring = true
  tags       = concat(local.common_tags, ["role-judge0", "env-prod"])
  user_data  = templatefile("${path.module}/cloud-init/base.yaml.tftpl", { role = "judge0" })

  lifecycle {
    ignore_changes = [user_data, image]
  }
}

resource "digitalocean_droplet" "staging" {
  name       = "vps-staging-01"
  region     = var.region
  size       = var.staging_droplet_size
  image      = var.droplet_image
  vpc_uuid   = digitalocean_vpc.main.id
  ssh_keys   = var.ssh_key_fingerprints
  monitoring = true
  ipv6       = true
  tags       = concat(local.common_tags, ["role-app", "env-staging"])
  user_data  = templatefile("${path.module}/cloud-init/base.yaml.tftpl", { role = "staging" })

  lifecycle {
    ignore_changes = [user_data, image]
  }
}

resource "digitalocean_project" "codify" {
  name        = var.project_name
  description = "Codify platform"
  purpose     = "Web Application"
  environment = "Production"
  resources = [
    digitalocean_droplet.app.urn,
    digitalocean_droplet.judge0.urn,
    digitalocean_droplet.staging.urn,
    digitalocean_database_cluster.prod.urn,
    digitalocean_database_cluster.staging.urn,
  ]
}

# ── Cloud firewalls ──────────────────────────────────────────────────────────
# Web origins only accept HTTP(S) from Cloudflare's edge (DNS is proxied), so
# the droplet IPs can't be used to bypass the WAF.

data "cloudflare_ip_ranges" "edge" {}

locals {
  cloudflare_edge_cidrs = concat(
    data.cloudflare_ip_ranges.edge.ipv4_cidr_blocks,
    data.cloudflare_ip_ranges.edge.ipv6_cidr_blocks,
  )
  judge0_clients = concat(
    [digitalocean_droplet.app.id],
    var.judge0_allow_staging ? [digitalocean_droplet.staging.id] : [],
  )
}

resource "digitalocean_firewall" "app" {
  name        = "codify-app"
  droplet_ids = [digitalocean_droplet.app.id, digitalocean_droplet.staging.id]

  # SSH: key-only (cloud-init disables passwords), operator CIDRs only.
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.admin_ssh_cidrs
  }

  # Coolify dashboard (8000) + its realtime/terminal ports (6001-6002).
  inbound_rule {
    protocol         = "tcp"
    port_range       = "8000"
    source_addresses = var.admin_ssh_cidrs
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "6001-6002"
    source_addresses = var.admin_ssh_cidrs
  }

  # Public traffic arrives only through Cloudflare (Full (strict) TLS).
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = local.cloudflare_edge_cidrs
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = local.cloudflare_edge_cidrs
  }

  inbound_rule {
    protocol         = "icmp"
    source_addresses = [var.vpc_ip_range]
  }

  # App hosts call third parties (Stripe, Clerk, Anthropic, FCM, R2, Sentry,
  # Grafana Cloud, GHCR) → unrestricted egress.
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

resource "digitalocean_firewall" "judge0" {
  name        = "codify-judge0"
  droplet_ids = [digitalocean_droplet.judge0.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.admin_ssh_cidrs
  }

  # Judge0 REST API: only the app droplet(s). Judge0 binds to the VPC address
  # (infra/judge0/docker-compose.yml), so this is defense in depth.
  inbound_rule {
    protocol           = "tcp"
    port_range         = "2358"
    source_droplet_ids = local.judge0_clients
  }

  inbound_rule {
    protocol           = "icmp"
    source_droplet_ids = local.judge0_clients
  }

  # Egress: DNS, NTP and HTTP(S) only — enough for apt, Docker image pulls and
  # Grafana Alloy shipping. Sandboxed submissions get *no* network at all; that
  # is enforced on the host (isolate + Judge0 config + DOCKER-USER rules, see
  # infra/judge0/README.md) because DO firewalls apply per droplet, not per
  # container.
  outbound_rule {
    protocol              = "udp"
    port_range            = "53"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "53"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "123"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "80"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "443"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  # No VPC egress rule: DO firewalls are stateful (responses to the app
  # droplet's requests are allowed), and Judge0 must not open connections to
  # the app host or the databases.
}

# ── Managed Postgres ─────────────────────────────────────────────────────────

resource "digitalocean_database_cluster" "prod" {
  name                 = "do-pg-prod"
  engine               = "pg"
  version              = var.pg_version
  size                 = var.pg_prod_size
  region               = var.region
  node_count           = var.pg_prod_node_count
  private_network_uuid = digitalocean_vpc.main.id
  tags                 = concat(local.common_tags, ["env-prod"])

  maintenance_window {
    day  = "sunday"
    hour = "06:00:00" # 03:00 BRT, low traffic
  }
}

resource "digitalocean_database_cluster" "staging" {
  name                 = "do-pg-staging"
  engine               = "pg"
  version              = var.pg_version
  size                 = var.pg_staging_size
  region               = var.region
  node_count           = 1
  private_network_uuid = digitalocean_vpc.main.id
  tags                 = concat(local.common_tags, ["env-staging"])
}

resource "digitalocean_database_db" "prod" {
  cluster_id = digitalocean_database_cluster.prod.id
  name       = "codify"
}

resource "digitalocean_database_db" "staging" {
  cluster_id = digitalocean_database_cluster.staging.id
  name       = "codify"
}

resource "digitalocean_database_user" "prod_app" {
  cluster_id = digitalocean_database_cluster.prod.id
  name       = "codify_app"
}

resource "digitalocean_database_user" "staging_app" {
  cluster_id = digitalocean_database_cluster.staging.id
  name       = "codify_app"
}

# Trusted sources: only the matching app droplet may connect (docs/13 §1).
# Migrations run *on* that droplet (staging.yml / release.yml SSH in and run
# the API image's `prisma migrate deploy`), so CI never needs DB access.
resource "digitalocean_database_firewall" "prod" {
  cluster_id = digitalocean_database_cluster.prod.id

  rule {
    type  = "droplet"
    value = digitalocean_droplet.app.id
  }
}

resource "digitalocean_database_firewall" "staging" {
  cluster_id = digitalocean_database_cluster.staging.id

  rule {
    type  = "droplet"
    value = digitalocean_droplet.staging.id
  }
}
