import { execFileSync } from 'node:child_process'
import { chmod, rm } from 'node:fs/promises'

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true })
execFileSync('tsc', ['--project', 'tsconfig.build.json'], { stdio: 'inherit' })
await chmod(new URL('../dist/cli/index.mjs', import.meta.url), 0o755)
