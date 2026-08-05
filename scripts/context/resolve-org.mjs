#!/usr/bin/env node
/**
 * Resolves an org key (dev org, UI-connected org, or pipeline stage org) to
 * job outputs.
 * Usage: node scripts/context/resolve-org.mjs <ORG_KEY> [--registry connected-orgs.json]
 */
import { existsSync, readFileSync } from "node:fs";
import { loadConfig, resolveOrg } from "../lib/pipeline.mjs";
import { setOutputs } from "../lib/output.mjs";

const key = process.argv[2];
if (!key) {
  console.error("Usage: resolve-org.mjs <ORG_KEY> [--registry file]");
  process.exit(2);
}
const regIdx = process.argv.indexOf("--registry");
const registryPath = regIdx > -1 ? process.argv[regIdx + 1] : null;
const connectedOrgs =
  registryPath && existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : [];

let org;
try {
  org = resolveOrg(loadConfig(), key, connectedOrgs);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}

setOutputs({
  org: org.org,
  auth_method: org.authMethod,
  display_name: org.name,
  username: org.username ?? "",
  instance_url: org.instanceHost ? `https://${org.instanceHost}` : "",
});
console.log(`Org "${key}": ${org.name} (auth=${org.authMethod})`);
