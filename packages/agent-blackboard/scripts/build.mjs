import { execFileSync } from 'node:child_process'
import { chmod, cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true })
const typescript = fileURLToPath(new URL('bin/tsc', import.meta.resolve('typescript/package.json')))
execFileSync(process.execPath, [typescript, '--project', 'tsconfig.build.json'], {
  stdio: 'inherit',
})
await cp(
  new URL('../../../plugins/agent-blackboard', import.meta.url),
  new URL('../dist/plugin', import.meta.url),
  {
    recursive: true,
  },
)
await chmod(new URL('../dist/cli/index.mjs', import.meta.url), 0o755)
