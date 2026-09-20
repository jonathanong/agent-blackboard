output "project_slug" {
  description = "Stable Sentry project slug used by Agent Blackboard releases."
  value       = sentry_project.lambda.slug
}

output "public_dsns" {
  description = "Public event-ingestion DSNs by deployment environment."
  value = {
    for environment, key in sentry_key.environment :
    environment => nonsensitive(key.dsn["public"])
  }
}
