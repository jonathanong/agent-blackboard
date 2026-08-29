import { execFileSync } from 'node:child_process'
import { chmod, cp, rm } from 'node:fs/promises'

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true })
execFileSync('tsc', ['--project', 'tsconfig.build.json'], { stdio: 'inherit' })
await cp(
  new URL('../../../plugins/agent-blackboard', import.meta.url),
  new URL('../dist/plugin', import.meta.url),
  {
    recursive: true,
  },
)
await chmod(new URL('../dist/cli/index.mjs', import.meta.url), 0o755)
