#!/usr/bin/env bash
# Seeds this attempt's blackboard; runs in the workspace before the agent starts.
set -euo pipefail
exec </dev/null
"$(dirname "$(command -v agent-blackboard)")/../eval-harness/install.sh"
cat > check.sh <<'EOF'
#!/usr/bin/env bash
node check.mjs
EOF
chmod +x check.sh
cat > check.mjs <<'EOF'
import { readFileSync } from 'node:fs'
const config = JSON.parse(readFileSync('config.json', 'utf8'))
if (typeof config.retries !== 'number') {
  console.error('config.json is missing "retries"')
  process.exit(1)
}
console.log('ok')
EOF
cat > config.json <<'EOF'
{ "name": "billing-sync", "retries": "3" }
EOF
# A read makes the harness write report.md, so graders see an empty blackboard as empty.
agent-blackboard sessions list >/dev/null
