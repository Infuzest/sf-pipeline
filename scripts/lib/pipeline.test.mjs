import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPipeline, resolveStage } from "./pipeline.mjs";

test("real pipeline.yml: every declared stage resolves (topology-agnostic)", () => {
  // The platform's whole point is configurable topology — different
  // products/projects run different stages. So this asserts the CONTRACT that
  // must hold for ANY valid pipeline.yml, never a specific set of stage names:
  //   1. at least one stage is defined,
  //   2. every declared stage round-trips through resolveStage with its fields,
  //   3. a branch that isn't a stage is rejected.
  const stages = loadPipeline(new URL("../../.orbitops/pipeline.yml", import.meta.url).pathname);
  assert.ok(stages.length >= 1, "pipeline.yml must declare at least one stage");

  for (const s of stages) {
    const r = resolveStage(stages, s.branch);
    assert.equal(r.branch, s.branch);
    assert.equal(r.org, s.org);
    assert.equal(r.environment, s.environment);
    assert.ok(["jwt", "sfdx-url"].includes(r.authMethod), `${s.branch}: valid authMethod`);
    assert.equal(typeof r.gates.minCoverage, "number", `${s.branch}: numeric minCoverage`);
    assert.ok(r.testLevel, `${s.branch}: testLevel resolved (defaulted if omitted)`);
    assert.equal(typeof r.quickDeploy, "boolean", `${s.branch}: quickDeploy resolved (defaulted if omitted)`);
  }

  assert.throws(() => resolveStage(stages, "definitely-not-a-stage"), /No pipeline stage maps/);
});

test("unknown branch throws with known branches listed", () => {
  const stages = [{ branch: "main", org: "PROD", environment: "production", authMethod: "jwt", gates: {} }];
  assert.throws(() => resolveStage(stages, "feature/x"), /known: main/);
});

test("testLevel defaults to RunLocalTests", () => {
  const stages = [{ branch: "main", org: "PROD", environment: "production", authMethod: "jwt", gates: {} }];
  assert.equal(resolveStage(stages, "main").testLevel, "RunLocalTests");
});

test("quickDeploy defaults to true and can be disabled per stage", () => {
  const defaults = [{ branch: "main", org: "PROD", environment: "production", authMethod: "jwt", gates: {} }];
  assert.equal(resolveStage(defaults, "main").quickDeploy, true);

  const disabled = [{ ...defaults[0], quickDeploy: false }];
  assert.equal(resolveStage(disabled, "main").quickDeploy, false);
});

test("work-item tagging is opt-in", async () => {
  const { loadConfig } = await import("./pipeline.mjs");
  const cfg = loadConfig(new URL("../../.orbitops/pipeline.yml", import.meta.url).pathname);
  assert.equal(cfg.workItems.required, false);
});

test("GitHub SARIF publishing is opt-in", async () => {
  const { loadConfig } = await import("./pipeline.mjs");
  const cfg = loadConfig(new URL("../../.orbitops/pipeline.yml", import.meta.url).pathname);
  assert.equal(cfg.codeScanning.publishSarif, false);
});

test("resolveOrg finds dev orgs, stage orgs, and rejects unknown keys", async () => {
  const { loadConfig, resolveOrg } = await import("./pipeline.mjs");
  const cfg = loadConfig(new URL("../../.orbitops/pipeline.yml", import.meta.url).pathname);
  const dev = resolveOrg(cfg, "INT"); // registered dev org wins (has a friendly name)
  assert.equal(dev.authMethod, "sfdx-url");
  assert.match(dev.name, /Shared dev/);
  const finalStage = cfg.pipeline.at(-1);
  const stageOrg = resolveOrg(cfg, finalStage.org);
  assert.equal(stageOrg.authMethod, finalStage.authMethod);
  assert.throws(() => resolveOrg(cfg, "NOPE"), /Unknown org key "NOPE"/);
});

test("resolveOrg consults the connected-orgs registry", async () => {
  const { loadConfig, resolveOrg } = await import("./pipeline.mjs");
  const cfg = loadConfig(new URL("../../.orbitops/pipeline.yml", import.meta.url).pathname);
  const reg = [{ name: "Jane's sandbox", org: "DEV_JANE", authMethod: "sfdx-url" }];
  const o = resolveOrg(cfg, "DEV_JANE", reg);
  assert.equal(o.name, "Jane's sandbox");
  assert.throws(() => resolveOrg(cfg, "DEV_JANE"), /Unknown org key/);
});

test("resolveOrg returns JWT identity for connected jwt entries", async () => {
  const { loadConfig, resolveOrg, salesforceLoginUrl } = await import("./pipeline.mjs");
  const cfg = loadConfig(new URL("../../.orbitops/pipeline.yml", import.meta.url).pathname);
  const reg = [{
    name: "Dev1", org: "DEV_DEV1", authMethod: "jwt",
    orgType: "sandbox", username: "test-user@example.com",
  }];
  const o = resolveOrg(cfg, "DEV_DEV1", reg);
  assert.equal(o.authMethod, "jwt");
  assert.equal(o.username, "test-user@example.com");
  assert.equal(o.loginUrl, "https://test.salesforce.com");
  assert.equal(salesforceLoginUrl("production"), "https://login.salesforce.com");
  assert.equal(
    salesforceLoginUrl(undefined, "acme--legacy.sandbox.my.salesforce.com"),
    "https://test.salesforce.com"
  );
});
