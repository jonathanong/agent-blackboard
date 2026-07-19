#!/usr/bin/env node
// Deletes the deployed CloudFormation stack. The deploy-artifact bucket is
// intentionally retained by default because it is owned by deploy.mjs rather
// than the stack and may contain artifacts from multiple deployments.
//
// Usage:
//   pnpm run teardown -- --confirm agent-blackboard
//   pnpm run teardown -- --confirm agent-blackboard --delete-artifacts
// Env: AWS_REGION or AWS_DEFAULT_REGION (or AWS CLI default),
//      STACK_NAME (optional, default "agent-blackboard").
import { execFileSync } from 'node:child_process'

const USAGE =
  'Usage:\n' +
  '  pnpm run teardown -- --confirm <stack-name> [--delete-artifacts]\n\n' +
  'Options:\n' +
  '  --confirm <stack-name>  Required; must exactly match STACK_NAME.\n' +
  '  --delete-artifacts      Also empty and delete the deploy-artifact S3 bucket.\n' +
  '  --help                  Show this help.\n'

function aws(args, opts = {}) {
  return execFileSync('aws', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...opts,
  })
}

function parseArgs(argv) {
  let confirm
  let deleteArtifacts = false
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      continue
    } else if (arg === '--confirm') {
      confirm = argv[++i]
      if (!confirm) throw new Error('--confirm requires a stack name.')
    } else if (arg === '--delete-artifacts') {
      deleteArtifacts = true
    } else if (arg === '--help') {
      help = true
    } else {
      throw new Error('Unknown argument: ' + arg)
    }
  }
  return { confirm, deleteArtifacts, help }
}

function resolveRegion() {
  const region =
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    aws(['configure', 'get', 'region']).trim()
  if (!region) {
    throw new Error(
      'No AWS region configured — set AWS_REGION, AWS_DEFAULT_REGION, or configure an AWS CLI default.',
    )
  }
  return region
}

function teardown({ confirm, deleteArtifacts }) {
  const stackName = process.env.STACK_NAME || 'agent-blackboard'
  if (confirm !== stackName) {
    throw new Error(
      'Refusing to delete stack "' + stackName + '": pass --confirm ' + stackName + ' exactly.',
    )
  }

  const region = resolveRegion()
  console.log('Deleting CloudFormation stack "' + stackName + '" in ' + region + '...')
  aws(['cloudformation', 'delete-stack', '--stack-name', stackName, '--region', region], {
    stdio: 'inherit',
  })
  aws(
    [
      'cloudformation',
      'wait',
      'stack-delete-complete',
      '--stack-name',
      stackName,
      '--region',
      region,
    ],
    { stdio: 'inherit' },
  )
  console.log('Deleted CloudFormation stack "' + stackName + '".')

  if (!deleteArtifacts) {
    console.log('Deploy-artifact bucket retained; pass --delete-artifacts to remove it too.')
    return
  }

  const accountId = JSON.parse(aws(['sts', 'get-caller-identity'])).Account
  const bucket = 'agent-blackboard-deploy-' + accountId + '-' + region
  console.log('Emptying and deleting s3://' + bucket + '...')
  aws(['s3', 'rb', 's3://' + bucket, '--force', '--region', region], { stdio: 'inherit' })
  console.log('Deleted s3://' + bucket + '.')
}

const options = parseArgs(process.argv.slice(2))
if (options.help) console.log(USAGE)
else teardown(options)
