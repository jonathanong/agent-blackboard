import { describe, expect, it } from 'vitest'
import { redactCredentials, redactString } from './redact.mjs'

// Build synthetic token fixtures dynamically so repository secret scanners do not flag test literals.
const CLIENT_TOKEN = ['abb', 'sk', 'a'.repeat(22), 'b'.repeat(24)].join('_')
const ADMIN_TOKEN = ['abb', 'admin', 'ops', 'c'.repeat(24)].join('_')
const GITHUB_CLASSIC = ['ghp', '1234567890abcdef1234567890'].join('_')
const GITHUB_PAT = ['github', 'pat', '11AAAA_1234567890abcdef12345'].join('_')
const OPENAI_KEY = ['sk', 'proj', 'abcdefghijklmnopqrstuvwx'].join('-')
const ANTHROPIC_KEY = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwx'].join('-')
const AWS_KEY = `AKIA${'1234567890ABCDEF'}`
const SLACK_TOKEN = ['xoxb', '1234567890', 'abcdef123456'].join('-')
const STRIPE_KEY = ['sk', 'live', '1234567890abcdef1234'].join('_')
const GOOGLE_KEY = `AIza${'SyA1234567890abcdefghijklmnopqrstuv'}`
const GOOGLE_KEY_TRAILING_HYPHEN = `AIza${'SyA1234567890abcdefghijklmnopqrstu-'}`
const NPM_TOKEN = ['npm', '1234567890abcdef12345678'].join('_')
const PYPI_TOKEN = ['pypi', 'AgEIcHlwaS5vcmc1234567890abcdef'].join('-')
const PEM_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAnFakeKeyMaterial',
  '-----END RSA PRIVATE KEY-----',
].join('\n')
const TRUNCATED_PEM_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQtruncated',
].join('\n')
const GENERIC_BEARER = `Bearer ${'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig'}`

describe('credential redaction', () => {
  it('replaces known credential shapes with typed markers and counts them once', () => {
    const cases: Array<[string, string]> = [
      [CLIENT_TOKEN, '[REDACTED:agent_blackboard_client_token]'],
      [ADMIN_TOKEN, '[REDACTED:agent_blackboard_admin_token]'],
      [GITHUB_CLASSIC, '[REDACTED:github_token]'],
      [GITHUB_PAT, '[REDACTED:github_token]'],
      [OPENAI_KEY, '[REDACTED:openai_api_key]'],
      [ANTHROPIC_KEY, '[REDACTED:anthropic_api_key]'],
      [AWS_KEY, '[REDACTED:aws_access_key_id]'],
      [SLACK_TOKEN, '[REDACTED:slack_token]'],
      [STRIPE_KEY, '[REDACTED:stripe_key]'],
      [GOOGLE_KEY, '[REDACTED:google_api_key]'],
      [GOOGLE_KEY_TRAILING_HYPHEN, '[REDACTED:google_api_key]'],
      [NPM_TOKEN, '[REDACTED:npm_token]'],
      [PYPI_TOKEN, '[REDACTED:pypi_token]'],
      [PEM_KEY, '[REDACTED:private_key]'],
    ]

    for (const [secret, expectedMarker] of cases) {
      const result = redactString(`leaked=${secret} done`)
      expect(result).toEqual({ value: `leaked=${expectedMarker} done`, redactedCount: 1 })
      expect(result.value).not.toContain(secret)
      // Redaction is idempotent
      expect(redactString(result.value)).toEqual({ value: result.value, redactedCount: 0 })
    }

    // Truncated / unterminated PEM pastes are redacted through end-of-string
    expect(redactString(`prefix\n${TRUNCATED_PEM_KEY}`)).toEqual({
      value: 'prefix\n[REDACTED:private_key]',
      redactedCount: 1,
    })

    // Multiple complete PEM blocks in one string are each redacted separately
    expect(redactString(`first=${PEM_KEY} middle second=${PEM_KEY}`)).toEqual({
      value: 'first=[REDACTED:private_key] middle second=[REDACTED:private_key]',
      redactedCount: 2,
    })

    expect(redactString(`Authorization: ${GENERIC_BEARER}`)).toEqual({
      value: 'Authorization: Bearer [REDACTED:bearer_token]',
      redactedCount: 1,
    })

    // Bearer prefix wrapping a known token uses the specific token kind and counts once
    expect(redactString(`Authorization: Bearer ${CLIENT_TOKEN}`)).toEqual({
      value: 'Authorization: Bearer [REDACTED:agent_blackboard_client_token]',
      redactedCount: 1,
    })
  })

  it('recursively redacts nested objects and arrays without mutating input', () => {
    const input = {
      note: `token ${CLIENT_TOKEN}`,
      nested: {
        logs: [`gh ${GITHUB_CLASSIC}`, 42, true, null, { key: ANTHROPIC_KEY }],
      },
      clean: 'plain text',
    }
    const snapshot = structuredClone(input)
    const result = redactCredentials(input)

    expect(input).toEqual(snapshot)
    expect(result.redactedCount).toBe(3)
    expect(result.value).toEqual({
      note: 'token [REDACTED:agent_blackboard_client_token]',
      nested: {
        logs: [
          'gh [REDACTED:github_token]',
          42,
          true,
          null,
          { key: '[REDACTED:anthropic_api_key]' },
        ],
      },
      clean: 'plain text',
    })
  })

  it('redacts object keys and preserves own __proto__ keys safely', () => {
    const parsed = JSON.parse(
      `{"__proto__":{"secret":"${CLIENT_TOKEN}"},"${GITHUB_CLASSIC}":"value"}`,
    ) as Record<string, unknown>
    const result = redactCredentials(parsed)
    expect(result.redactedCount).toBe(2)
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(result.value, '__proto__')).toBe(true)
    expect(result.value['__proto__']).toEqual({
      secret: '[REDACTED:agent_blackboard_client_token]',
    })
    expect(result.value['[REDACTED:github_token]']).toBe('value')
  })
})
