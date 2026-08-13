import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const validator = new URL("./validate-pipeline-config.mjs", import.meta.url).pathname;
const base = (tests) => `pipeline:
  - branch: integration
    org: INT
    environment: integration
    authMethod: jwt
${tests}
    gates:
      scannerMaxSeverity: 3
      minCoverage: 0
`;

function validate(yaml) {
  const dir = mkdtempSync(join(tmpdir(), "orbitops-config-"));
  const path = join(dir, "pipeline.yml");
  writeFileSync(path, yaml);
  const result = spawnSync(process.execPath, [validator, path], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test("pipeline config accepts RunSpecifiedTests with safe test classes", () => {
  const result = validate(base("    testLevel: RunSpecifiedTests\n    testClasses:\n      - AccountServiceTest\n      - OpportunityTest.createsOpportunity"));
  assert.equal(result.status, 0, result.stderr);
});

test("pipeline config requires classes only for RunSpecifiedTests", () => {
  const missing = validate(base("    testLevel: RunSpecifiedTests"));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /add at least one Apex test class/);

  const misplaced = validate(base("    testLevel: Conditional\n    testClasses:\n      - AccountServiceTest"));
  assert.equal(misplaced.status, 1);
  assert.match(misplaced.stderr, /only be used with RunSpecifiedTests/);
});
