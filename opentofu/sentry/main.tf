data "sentry_organization" "current" {
  slug = var.sentry_organization_slug
}

data "sentry_team" "platform" {
  organization = data.sentry_organization.current.slug
  slug         = var.sentry_team_slug
}

# The GitHub installation and jonathanong/agent-blackboard repository are
# connected in Sentry outside OpenTofu. This lookup deliberately validates the
# integration without adopting or deleting that shared organization resource.
data "sentry_organization_integration" "github" {
  organization = data.sentry_organization.current.slug
  provider_key = "github"
  name         = var.github_installation_account
}

resource "sentry_project" "lambda" {
  organization = data.sentry_organization.current.slug
  teams        = [data.sentry_team.platform.slug]
  name         = "Agent Blackboard Lambda"
  slug         = "agent-blackboard-lambda"
  platform     = "node-awslambda"

  default_key   = false
  default_rules = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "sentry_key" "environment" {
  for_each = toset(["staging", "production"])

  organization = sentry_project.lambda.organization
  project      = sentry_project.lambda.slug
  name         = each.key

  lifecycle {
    prevent_destroy = true
  }
}
