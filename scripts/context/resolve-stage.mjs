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
import { loadPipeline, resolveStage } from "../lib/pipeline.mjs";
import { setOutputs } from "../lib/output.mjs";

const optional = process.argv.includes("--optional");
const branch = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!branch) {
  console.error("Usage: resolve-stage.mjs <base-branch> [--optional]");
  process.exit(2);
}

const stages = loadPipeline();
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

setOutputs({
  is_stage: "true",
  is_last_stage: String(stages[stages.length - 1]?.branch === branch),
  org: stage.org,
  environment: stage.environment,
  auth_method: stage.authMethod,
  test_level: stage.testLevel,
  min_coverage: stage.gates.minCoverage,
  scanner_max_severity: stage.gates.scannerMaxSeverity,
});
console.log(`Stage for "${branch}": org=${stage.org} environment=${stage.environment} auth=${stage.authMethod} tests=${stage.testLevel}`);
