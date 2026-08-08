import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('packages/agent-blackboard/package.json', 'utf8')).version
const pluginPaths = [
  '.claude-plugin/plugin.json',
  'plugins/agent-blackboard/.codex-plugin/plugin.json',
]
const packageReferencePaths = [
  'README.md',
  'docs/agent-hosts.md',
  'plugins/agent-blackboard/.claude-mcp.json',
  'plugins/agent-blackboard/.mcp.json',
  'plugins/agent-blackboard/skills/agent-blackboard/SKILL.md',
]

for (const pluginPath of pluginPaths) {
  const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'))
  plugin.version = version
  writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`)
}

for (const packageReferencePath of packageReferencePaths) {
  const source = readFileSync(packageReferencePath, 'utf8')
  const packageReference = /agent-blackboard@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g
  const updated = source.replaceAll(packageReference, `agent-blackboard@${version}`)
  if (updated === source && !source.includes(`agent-blackboard@${version}`)) {
    throw new Error(`No pinned agent-blackboard package reference in ${packageReferencePath}`)
  }
  writeFileSync(packageReferencePath, updated)
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
execFileSync(pnpm, ['exec', 'oxfmt', ...pluginPaths, ...packageReferencePaths], {
  stdio: 'inherit',
})
