#!/usr/bin/env node
// SessionStart hook, shared by both the Claude Code plugin (registered via
// ../hooks/hooks.json, ${CLAUDE_PLUGIN_ROOT}) and the Codex plugin (registered via
// ../.codex-plugin/hooks.json, ${PLUGIN_ROOT}) — both hosts send session_id/cwd on
// stdin with the same field names, so one script covers both. Matchers: startup,
// clear, resume, compact.
//
// Writes the live session id to `.agent-journal/session.json` in the working
// directory. The published `agent-journal` package's session resolution reads this
// file, so a new session (including after /clear, or a fresh Codex thread) starts a
// fresh journal stream with no manual reset — this is the reliable mechanism for
// Codex specifically, since CODEX_THREAD_ID is not reliably passed to stdio MCP
// servers (see docs/architecture.md#session-lifecycle).
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const raw = await readStdin()
  const input = raw.trim() === '' ? {} : JSON.parse(raw)
  const cwd = input.cwd ?? process.cwd()
  const stateDir = join(cwd, '.agent-journal')

  await mkdir(stateDir, { recursive: true })
  await writeFile(
    join(stateDir, 'session.json'),
    `${JSON.stringify({ sessionId: input.session_id })}\n`,
  )
}

await main()
