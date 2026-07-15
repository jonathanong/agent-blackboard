import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bundle } from '../infra/bundle.mjs'

/**
 * Regression test for a real incident: this project's first actual AWS
 * deploy 403'd on every request (a separate, already-fixed Lambda
 * permissions gap), and once that was fixed, every request instead crashed
 * with `Dynamic require of "node:https" is not supported`. The AWS SDK's
 * bundled CJS dependencies (`@smithy/node-http-handler`) call
 * `require('node:https')`, and esbuild's ESM output only inlines
 * `require()` calls it can resolve statically, so that call throws.
 * Reproduces in plain Node, not just on Lambda — every other test in this
 * repo runs against `src/` directly via `tsx` and never imports the bundled
 * artifact, which is why nothing else catches a dropped fix here.
 * `infra/bundle.mjs`'s `createRequire` banner is the fix; this test runs
 * the real bundle output in a genuine child Node process (not an in-process
 * dynamic import, which vitest's own module loader can mask this failure
 * mode under) to guard against the banner silently regressing.
 */
describe('lambda bundle (real esbuild output)', () => {
  it('resolves node:https at runtime instead of throwing "Dynamic require"', async () => {
    const { bundlePath } = await bundle()
    const bundleUrl = pathToFileURL(bundlePath).href

    // Force a real DynamoDBDocumentClient.send() — the require('node:https')
    // call happens before the socket connects, so a bogus, non-routable
    // endpoint still triggers it, fast and without real AWS access.
    const script = `
      globalThis.awslambda = {
        streamifyResponse: (fn) => fn,
        HttpResponseStream: { from: (stream) => stream },
      };
      process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://localhost:1';
      process.env.AWS_REGION ??= 'us-west-2';
      process.env.AWS_ACCESS_KEY_ID ??= 'test';
      process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
      const mod = await import(${JSON.stringify(bundleUrl)});
      try {
        const iterator = mod.realStore
          .getEntries('bundle-regression-test', { sessionId: 'x' })
          [Symbol.asyncIterator]();
        await iterator.next();
        console.log('completed without throwing');
      } catch (error) {
        console.log('THREW: ' + error.message);
      }
    `

    let output: string
    try {
      output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        timeout: 10_000,
      })
    } catch (error) {
      // A non-zero exit (e.g. an uncaught failure during module init) still
      // carries the diagnostic stdout/stderr we care about.
      const spawnError = error as { stdout?: string; stderr?: string }
      output = `${spawnError.stdout ?? ''}${spawnError.stderr ?? ''}`
    }

    // A real network-layer failure against the bogus endpoint
    // (ECONNREFUSED, a credentials error, etc.) is expected and fine —
    // only a "Dynamic require" failure means the banner regressed.
    expect(output).not.toMatch(/Dynamic require/)
  })
})
