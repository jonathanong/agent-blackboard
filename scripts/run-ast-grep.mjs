#!/usr/bin/env node
// `@ast-grep/cli`'s postinstall hardlinks/copies a native binary over the
// same path npm/pnpm already generated a `node <path>`-wrapping bin shim
// for, so `node_modules/.bin/ast-grep` tries to `require()` a Mach-O/PE
// executable and fails. Work around it by resolving the real binary the
// same way the package's own postinstall does, and exec'ing it directly.
import { execFileSync } from 'node:child_process'
import { resolveBinaryPath } from '@ast-grep/cli/postinstall.js'

const binaryPath = resolveBinaryPath()
if (!binaryPath) {
  console.error('Failed to locate the @ast-grep/cli native binary.')
  process.exit(1)
}

try {
  execFileSync(binaryPath, process.argv.slice(2), { stdio: 'inherit' })
} catch (error) {
  process.exit(typeof error.status === 'number' ? error.status : 1)
}
