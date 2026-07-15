#!/usr/bin/env node
// Bundles src/handler.mts into dist/handler.mjs + zips it (with a minimal
// package.json) into dist/lambda.zip, ready for infra/deploy.mjs to upload.
//
// We fully bundle @aws-sdk/client-dynamodb + @aws-sdk/lib-dynamodb rather
// than externalizing them. The AWS-managed Lambda Node runtime image ships
// its own copy of the SDK for convenience, but its version drifts from what
// we develop/test against and it is not a documented, versioned contract —
// externalizing risks a `Cannot find module '@aws-sdk/lib-dynamodb'` (or a
// subtly incompatible version) cold-start failure. Bundling costs a few
// hundred KB of zip size, which is a fine trade for a service this small.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const infraDir = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(infraDir, '..')
const distDir = path.join(serverRoot, 'dist')
const bundlePath = path.join(distDir, 'handler.mjs')
const zipPath = path.join(distDir, 'lambda.zip')

// Matches the Lambda managed runtime pinned in infra/template.yaml — keep
// these two in sync.
const LAMBDA_NODE_TARGET = 'node24'

export async function bundle() {
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })

  await build({
    entryPoints: [path.join(serverRoot, 'src/handler.mts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: LAMBDA_NODE_TARGET,
    // Explicitly empty: everything (including @aws-sdk/*) gets bundled —
    // see module comment above.
    external: [],
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  })

  // Lambda needs to know the bundle is ESM; there's no package.json in
  // dist/ otherwise (it isn't part of the bundle output).
  await writeFile(
    path.join(distDir, 'package.json'),
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
  )

  await zip()

  return { bundlePath, zipPath }
}

// Shells out to the system `zip` binary rather than pulling in a zip
// library dependency for one build step. Requires `zip` on PATH (present by
// default on macOS/most Linux dev images; install via `apt-get install -y
// zip` on minimal CI images if missing).
async function zip() {
  await rm(zipPath, { force: true })
  try {
    execFileSync('zip', ['-j', '-X', zipPath, bundlePath, path.join(distDir, 'package.json')], {
      cwd: distDir,
      stdio: 'inherit',
    })
  } catch (error) {
    throw new Error(
      `Failed to zip the Lambda bundle with the system \`zip\` binary — is it installed and on PATH? (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    )
  }
}

// Note: infra/*.mjs is outside the vitest coverage.include glob
// (packages/*/src/**/*.mts) — this script is exercised by running it, not
// by unit tests. See README for the manual verification steps.
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const { zipPath: outZip } = await bundle()
  console.log(`Bundled ${outZip}`)
}
