#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"

node - "$REPO_ROOT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const cliToolsPath = path.join(root, "OmniRoute/src/shared/constants/cliTools.ts");
const cliPagePath = path.join(
  root,
  "OmniRoute/src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.tsx"
);
const mitmRoutePath = path.join(
  root,
  "OmniRoute/src/app/api/cli-tools/antigravity-mitm/route.ts"
);

const cliTools = fs.readFileSync(cliToolsPath, "utf8");
const cliPage = fs.readFileSync(cliPagePath, "utf8");
const mitmRoute = fs.readFileSync(mitmRoutePath, "utf8");

const antigravityBlock = /antigravity:\s*\{[\s\S]*?\n  copilot:/.exec(cliTools)?.[0] || "";
if (!antigravityBlock.includes('configType: "guide"')) {
  throw new Error("Antigravity CLI tool config must use guide/direct routing, not MITM");
}
if (/configType:\s*"mitm"/.test(antigravityBlock)) {
  throw new Error("Antigravity CLI tool config still exposes MITM mode");
}
if (/configType:\s*"mitm"/.test(cliTools)) {
  throw new Error("CLI tool registry should not expose MITM mode");
}
if (/case "antigravity":/.test(cliPage)) {
  throw new Error("Antigravity should render through the direct DefaultToolCard, not the MITM card");
}
if (!/MITM_DISABLED/.test(mitmRoute)) {
  throw new Error("Antigravity MITM API route should be explicitly disabled");
}

console.log("antigravity_direct_contract_test: ok");
NODE
