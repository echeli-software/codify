output "app_droplet" {
  description = "vps-app-01 addresses (public for SSH/Coolify, private for Judge0/DB)."
  value = {
    public_ipv4  = digitalocean_droplet.app.ipv4_address
    private_ipv4 = digitalocean_droplet.app.ipv4_address_private
  }
}

output "staging_droplet" {
  value = {
    public_ipv4  = digitalocean_droplet.staging.ipv4_address
    private_ipv4 = digitalocean_droplet.staging.ipv4_address_private
  }
}

output "judge0_private_url" {
  description = "JUDGE0_URL for the API (VPC-only)."
  value       = "http://${digitalocean_droplet.judge0.ipv4_address_private}:2358"
}

output "judge0_public_ipv4" {
  description = "For SSH only — the Judge0 API is not reachable on this address."
  value       = digitalocean_droplet.judge0.ipv4_address
}

output "database_url_prod" {
  description = "DATABASE_URL for prod (private network, app user). Put it in Coolify + the GitHub `production` environment."
  value       = "postgresql://${digitalocean_database_user.prod_app.name}:${digitalocean_database_user.prod_app.password}@${digitalocean_database_cluster.prod.private_host}:${digitalocean_database_cluster.prod.port}/${digitalocean_database_db.prod.name}?sslmode=require"
  sensitive   = true
}

output "database_url_staging" {
  description = "DATABASE_URL for staging (private network, app user)."
  value       = "postgresql://${digitalocean_database_user.staging_app.name}:${digitalocean_database_user.staging_app.password}@${digitalocean_database_cluster.staging.private_host}:${digitalocean_database_cluster.staging.port}/${digitalocean_database_db.staging.name}?sslmode=require"
  sensitive   = true
}

output "pages_projects" {
  description = "Cloudflare Pages project names → *.pages.dev subdomains (CLOUDFLARE_PAGES_* repo variables)."
  value       = { for k, p in cloudflare_pages_project.app : k => { name = p.name, subdomain = p.subdomain } }
}
