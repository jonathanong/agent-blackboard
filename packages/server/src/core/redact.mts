export interface RedactionResult<T> {
  value: T
  redactedCount: number
}

interface RedactionRule {
  kind: string
  pattern: RegExp
  replace: (match: string, ...groups: string[]) => string
}

function marker(kind: string): string {
  return `[REDACTED:${kind}]`
}

function replaceWhole(kind: string): () => string {
  const replacement = marker(kind)
  return () => replacement
}

// Specific prefixes run before generic shapes (e.g. Anthropic before OpenAI,
// all explicit tokens before generic `Bearer <token>`) so every secret receives
// its most specific kind label and is counted once.
const RULES: readonly RedactionRule[] = [
  {
    kind: 'agent_blackboard_client_token',
    pattern: /(?<![A-Za-z0-9_-])abb_sk_[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g,
    replace: replaceWhole('agent_blackboard_client_token'),
  },
  {
    kind: 'agent_blackboard_admin_token',
    pattern: /(?<![A-Za-z0-9_-])abb_admin_[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g,
    replace: replaceWhole('agent_blackboard_admin_token'),
  },
  {
    kind: 'private_key',
    pattern:
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----(?:[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|[\s\S]*)/g,
    replace: replaceWhole('private_key'),
  },
  {
    kind: 'anthropic_api_key',
    pattern:
      /(?<![A-Za-z0-9_-])sk-ant-(?:api\d{2}-|admin\d{2}-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
    replace: replaceWhole('anthropic_api_key'),
  },
  {
    kind: 'openai_api_key',
    pattern: /(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
    replace: replaceWhole('openai_api_key'),
  },
  {
    kind: 'github_token',
    pattern: /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replace: replaceWhole('github_token'),
  },
  {
    kind: 'aws_access_key_id',
    pattern: /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
    replace: replaceWhole('aws_access_key_id'),
  },
  {
    kind: 'slack_token',
    pattern: /(?<![A-Za-z0-9_-])xox[baprs]-[0-9A-Za-z-]{10,}(?![A-Za-z0-9_-])/g,
    replace: replaceWhole('slack_token'),
  },
  {
    kind: 'stripe_key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
    replace: replaceWhole('stripe_key'),
  },
  {
    kind: 'google_api_key',
    pattern: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g,
    replace: replaceWhole('google_api_key'),
  },
  {
    kind: 'npm_token',
    pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g,
    replace: replaceWhole('npm_token'),
  },
  {
    kind: 'pypi_token',
    pattern: /(?<![A-Za-z0-9_-])pypi-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
    replace: replaceWhole('pypi_token'),
  },
  {
    kind: 'bearer_token',
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi,
    replace: (_match, prefix) => `${prefix}${marker('bearer_token')}`,
  },
]

export function redactString(input: string): RedactionResult<string> {
  let value = input
  let redactedCount = 0
  for (const rule of RULES) {
    value = value.replace(rule.pattern, (match, ...args: unknown[]) => {
      redactedCount += 1
      const groups = args.filter((arg): arg is string => typeof arg === 'string')
      return rule.replace(match, ...groups)
    })
  }
  return { value, redactedCount }
}

function redactValue(input: unknown): RedactionResult<unknown> {
  if (typeof input === 'string') return redactString(input)
  if (Array.isArray(input)) {
    let redactedCount = 0
    const next = input.map((item) => {
      const result = redactValue(item)
      redactedCount += result.redactedCount
      return result.value
    })
    return { value: next, redactedCount }
  }
  if (typeof input === 'object' && input !== null) {
    let redactedCount = 0
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(input)) {
      const keyResult = redactString(key)
      const valueResult = redactValue(item)
      redactedCount += keyResult.redactedCount + valueResult.redactedCount
      Object.defineProperty(next, keyResult.value, {
        value: valueResult.value,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return { value: next, redactedCount }
  }
  return { value: input, redactedCount: 0 }
}

/** Recursively redacts known credential shapes in a JSON data object without mutating it. */
export function redactCredentials(
  data: Record<string, unknown>,
): RedactionResult<Record<string, unknown>> {
  return redactValue(data) as RedactionResult<Record<string, unknown>>
}
