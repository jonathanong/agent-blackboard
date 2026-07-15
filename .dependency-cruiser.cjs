/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'published-package-no-server',
      severity: 'error',
      comment:
        'The published agent-journal package (client/CLI/MCP) must not depend on the server package — it ships to end users and must stay free of server-only code.',
      from: { path: '^packages/agent-journal' },
      to: { path: '^packages/server' },
    },
    {
      name: 'published-package-no-aws-sdk',
      severity: 'error',
      comment:
        'The published agent-journal package must not depend on the AWS SDK — that weight belongs only to the server, which is deployed, not published.',
      from: { path: '^packages/agent-journal' },
      to: { path: 'node_modules/@aws-sdk' },
    },
    {
      name: 'server-no-agent-journal',
      severity: 'error',
      comment: 'The server must not depend on the published client/CLI/MCP package.',
      from: { path: '^packages/server' },
      to: { path: '^packages/agent-journal' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules hard to reason about and test in isolation.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    // Record the edge into node_modules (needed for the no-aws-sdk rule
    // above) but don't recurse into third-party packages' own internals —
    // otherwise `no-circular` reports cycles inside dependencies' own code,
    // which isn't ours to fix and isn't what this rule is for.
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
