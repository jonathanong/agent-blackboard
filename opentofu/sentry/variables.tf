variable "sentry_organization_slug" {
  description = "Existing Sentry organization that owns Agent Blackboard observability."
  type        = string
  default     = "vouchington"
}

variable "sentry_team_slug" {
  description = "Existing Sentry team attached to the Agent Blackboard project."
  type        = string
  default     = "platform"
}

variable "github_installation_account" {
  description = "Existing GitHub integration account; the repository connection remains externally managed."
  type        = string
  default     = "jonathanong"
}
