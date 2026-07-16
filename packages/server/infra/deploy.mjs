#!/usr/bin/env node
// Wraps `aws cloudformation deploy`. Deploy-artifact strategy: CloudFormation
// can't inline a bundled-@aws-sdk zip (Code.ZipFile caps out around 4KB and
// only supports a single-file CJS-ish handler), so the Lambda's Code must
// point at S3. Rather than adding a second IaC layer to manage that bucket,
// this script owns one deploy-time bucket itself — created idempotently,
// named deterministically from account+region (same pattern CDK/SAM use for
// their bootstrap buckets) — and uploads the zip to a content-hash key so
// re-deploying with unchanged code is a no-op diff for CloudFormation.
//
// Usage: pnpm --filter atel-server run deploy
// Env: AWS_REGION or AWS_DEFAULT_REGION (or `aws configure`'s default),
//      ATEL_ADMIN_CREDENTIALS (required), ATEL_TTL_DAYS (optional),
//      STACK_NAME (optional, default "agent-journal" — this deploys to the
//      already-existing stack; the CloudFormation stack/resource identity
//      and the deploy-artifact bucket naming are intentionally NOT
//      rebranded here, since renaming them would make CloudFormation
//      replace already-deployed, real infrastructure on the next deploy).
import { bundle } from './bundle.mjs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const infraDir = path.dirname(fileURLToPath(import.meta.url))
const templatePath = path.join(infraDir, 'template.yaml')

function aws(args, opts = {}) {
  return execFileSync('aws', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...opts,
  })
}

function resolveRegion() {
  const region =
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    aws(['configure', 'get', 'region']).trim()
  if (!region) {
    throw new Error(
      'No AWS region configured — set AWS_REGION, AWS_DEFAULT_REGION, or `aws configure set region ...`.',
    )
  }
  return region
}

async function ensureDeployBucket(bucket, region) {
  try {
    aws(['s3api', 'head-bucket', '--bucket', bucket, '--region', region])
    return
  } catch {
    // Falls through to create — head-bucket exits non-zero for "doesn't
    // exist" and for "exists but no access"; the create call below will
    // surface the latter with a clearer AWS error if that's the real cause.
  }
  const createArgs = ['s3api', 'create-bucket', '--bucket', bucket, '--region', region]
  if (region !== 'us-east-1')
    createArgs.push('--create-bucket-configuration', `LocationConstraint=${region}`)
  aws(createArgs)
  aws([
    's3api',
    'put-public-access-block',
    '--bucket',
    bucket,
    '--public-access-block-configuration',
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
  ])
}

async function uploadIfMissing(zipPath, bucket, key, region) {
  try {
    aws(['s3api', 'head-object', '--bucket', bucket, '--key', key, '--region', region])
    return // identical content already uploaded under this hash key
  } catch {
    // not found — upload below
  }
  aws(['s3', 'cp', zipPath, `s3://${bucket}/${key}`, '--region', region])
}

function stackOutputs(stackName, region) {
  const raw = aws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    stackName,
    '--region',
    region,
  ])
  const stack = JSON.parse(raw).Stacks[0]
  return Object.fromEntries((stack.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]))
}

export async function deploy() {
  const adminCredentials = process.env.ATEL_ADMIN_CREDENTIALS
  if (!adminCredentials) {
    throw new Error(
      'ATEL_ADMIN_CREDENTIALS env var is required — base64 JSON [{"name","token"}]. See README.',
    )
  }

  const region = resolveRegion()
  const accountId = JSON.parse(aws(['sts', 'get-caller-identity'])).Account
  const bucket = `agent-journal-deploy-${accountId}-${region}`
  const stackName = process.env.STACK_NAME || 'agent-journal'

  const { zipPath } = await bundle()
  const hash = createHash('sha256')
    .update(await readFile(zipPath))
    .digest('hex')
  const key = `lambda/${hash}.zip`

  await ensureDeployBucket(bucket, region)
  await uploadIfMissing(zipPath, bucket, key, region)

  const overrides = [
    `LambdaCodeS3Bucket=${bucket}`,
    `LambdaCodeS3Key=${key}`,
    `AdminCredentials=${adminCredentials}`,
  ]
  if (process.env.ATEL_TTL_DAYS) overrides.push(`JournalTtlDays=${process.env.ATEL_TTL_DAYS}`)

  aws(
    [
      'cloudformation',
      'deploy',
      '--template-file',
      templatePath,
      '--stack-name',
      stackName,
      '--capabilities',
      'CAPABILITY_IAM',
      '--region',
      region,
      // Re-deploying with unchanged code (same content-hash S3 key, same
      // parameters) produces an empty changeset, which `cloudformation
      // deploy` otherwise treats as a failure (non-zero exit) — that's the
      // common, expected re-deploy path here, not an error.
      '--no-fail-on-empty-changeset',
      '--parameter-overrides',
      ...overrides,
    ],
    { stdio: 'inherit' },
  )

  return stackOutputs(stackName, region)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const outputs = await deploy()
  console.log(JSON.stringify(outputs, null, 2))
}
