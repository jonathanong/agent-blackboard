import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('packages/atel/package.json', 'utf8')).version
const pluginPaths = ['.claude-plugin/plugin.json', 'plugins/atel/.codex-plugin/plugin.json']

for (const pluginPath of pluginPaths) {
  const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'))
  plugin.version = version
  writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`)
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
execFileSync(pnpm, ['exec', 'oxfmt', ...pluginPaths], { stdio: 'inherit' })
