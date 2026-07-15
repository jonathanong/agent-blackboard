#!/usr/bin/env node
// Claude Code `SessionStart` hook (matchers: startup, clear, resume — see hooks.json).
//
// Reads the hook input JSON Claude Code sends on stdin and writes the live session id to
// `.agent-journal/session.json` in the working directory. The published `agent-journal` package's
// session resolution reads this file, so a new Claude Code session (including after `/clear`)
// automatically starts a fresh journal stream with no manual reset.
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
