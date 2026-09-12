#!/usr/bin/env bash
set -euo pipefail

echo "Create D1:"
npx wrangler d1 create agis-astra-db

echo
echo "Create queues:"
npx wrangler queues create agis-astra-tasks
npx wrangler queues create agis-astra-tasks-dlq

echo
echo "Copy the D1 database_id into wrangler.toml, then set secrets:"
echo "  npx wrangler secret put ADMIN_PASSWORD"
echo "  npx wrangler secret put SESSION_SECRET"
echo "  npx wrangler secret put BRIDGE_URL"
echo "  npx wrangler secret put BRIDGE_TOKEN"
echo "  npx wrangler secret put CALLBACK_TOKEN"
echo
echo "Then run: npm run db:migrate && npm run deploy"
