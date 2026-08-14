#!/usr/bin/env node
/**
 * Resolves the pipeline stage for a target branch and exposes it as job outputs.
 * Usage: node scripts/context/resolve-stage.mjs <base-branch> [--optional]
 *
 * With --optional, an unknown branch is not an error: outputs is_stage=false
 * and exits 0, so workflows can trigger broadly and skip non-stage branches.
 * This keeps the branch topology defined ONLY by .orbitops/pipeline.yml —
 * adding or removing a stage never requires editing workflow trigger lists.
 */
import { existsSync, readFileSync } from "node:fs";
import { loadConfig, resolveOrg, resolveStage } from "../lib/pipeline.mjs";
import { setOutputs } from "../lib/output.mjs";

const optional = process.argv.includes("--optional");
const branch = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!branch) {
  console.error("Usage: resolve-stage.mjs <base-branch> [--optional]");
  process.exit(2);
}

const registryIndex = process.argv.indexOf("--registry");
const registryPath = registryIndex > -1 ? process.argv[registryIndex + 1] : null;
const connectedOrgs =
  registryPath && existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : [];
const config = loadConfig();
const stages = config.pipeline;
let stage;
try {
  stage = resolveStage(stages, branch);
} catch (err) {
  if (optional) {
    setOutputs({ is_stage: "false", is_last_stage: "false" });
    console.log(`"${branch}" is not a pipeline stage — skipping.`);
    process.exit(0);
  }
  console.error(`✖ ${err.message}`);
  process.exit(1);
}

// The stage owns policy/topology; the connected-org registry owns the
// Salesforce identity. All connected orgs share one JWT app and key, with only
// the deployment username and login service varying by org.
const org = resolveOrg(config, stage.org, connectedOrgs);

setOutputs({
  is_stage: "true",
  is_last_stage: String(stages[stages.length - 1]?.branch === branch),
  org: stage.org,
  environment: stage.environment,
  auth_method: org.authMethod,
  username: org.username ?? "",
  instance_url: org.loginUrl ?? "",
  test_level: stage.testLevel,
  test_classes: JSON.stringify(stage.testClasses ?? []),
  policy_owner: stage.policy?.owner ?? (stages[0]?.branch === branch ? "developer" : "central"),
  quick_deploy: String(stage.quickDeploy !== false),
  min_coverage: stage.gates.minCoverage,
  scanner_max_severity: stage.gates.scannerMaxSeverity,
  work_items_required: String(config.workItems.required === true),
  publish_sarif: String(config.codeScanning.publishSarif === true),
});
console.log(`Stage for "${branch}": org=${stage.org} environment=${stage.environment} auth=${org.authMethod} tests=${stage.testLevel} policy=${stage.policy?.owner ?? (stages[0]?.branch === branch ? "developer" : "central")}${stage.testLevel === "RunSpecifiedTests" ? ` (${stage.testClasses.length} specified)` : ""}`);
