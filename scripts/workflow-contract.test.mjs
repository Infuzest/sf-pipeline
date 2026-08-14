import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("all Salesforce validation and deployment paths support specified tests", () => {
  for (const workflow of [
    ".github/workflows/_pr-validate.yml",
    ".github/workflows/_deploy.yml",
    ".github/workflows/_release-candidate.yml",
  ]) {
    const source = read(workflow);
    assert.match(source, /test_classes:/, `${workflow} exposes configured test classes`);
    assert.match(source, /ORBITOPS_TEST_CLASSES:/, `${workflow} passes test classes without shell interpolation`);
    assert.match(source, /TEST_ARGS\+?=|ARGS\+=\(--tests/, `${workflow} builds Salesforce CLI test arguments`);
    assert.match(source, /--tests/, `${workflow} invokes selected tests`);
  }
});

test("the release container trusts its mounted workspace before rebuilding a candidate", () => {
  const source = read(".github/workflows/_release-candidate.yml");
  const deployJob = source.slice(source.indexOf("  deploy-and-record:"));
  const trust = deployJob.indexOf('git config --global --add safe.directory "$GITHUB_WORKSPACE"');
  const rebuild = deployJob.indexOf("git fetch --no-tags origin \"$HEAD_SHA\"");

  assert.ok(trust >= 0, "release container registers the exact GitHub workspace as safe");
  assert.ok(rebuild >= 0, "release container rebuilds the approved candidate");
  assert.ok(trust < rebuild, "workspace trust is configured before the first candidate Git operation");
});

test("validation and deployment share the connected-org JWT identity", () => {
  for (const workflow of [
    ".github/workflows/_pr-validate.yml",
    ".github/workflows/_deploy.yml",
    ".github/workflows/_release-candidate.yml",
  ]) {
    const source = read(workflow);
    assert.match(source, /connected-orgs\.json/, `${workflow} reads the central org registry`);
    assert.match(source, /--registry connected-orgs\.json/, `${workflow} resolves the stage through the registry`);
    assert.match(source, /ORBITOPS_JWT_CLIENT_ID/, `${workflow} uses the shared JWT consumer key`);
    assert.match(source, /ORBITOPS_JWT_KEY/, `${workflow} uses the shared JWT private key`);
    assert.match(source, /outputs\.username/, `${workflow} supplies the org-specific deployment username`);
  }
});

test("trusted OrbitOps promotions can select tests at every governed stage", () => {
  const validation = read(".github/workflows/_pr-validate.yml");
  const release = read(".github/workflows/_release-candidate.yml");
  for (const [workflow, source] of [["validation", validation], ["release", release]]) {
    assert.match(source, /startsWith\([^\n]*orbitops\/bundle\//, `${workflow} recognises an OrbitOps stage bundle`);
    assert.match(source, /author_type|pull_request\.user\.type/, `${workflow} requires the GitHub App bot identity`);
    assert.match(source, /request-test-plan\.mjs/, `${workflow} resolves that promotion's test plan`);
  }
});

test("every toolbox container job supports an organisation runner", () => {
  for (const workflow of [
    ".github/workflows/_deploy.yml",
    ".github/workflows/_pr-validate.yml",
    ".github/workflows/_release-candidate.yml",
    ".github/workflows/full-scan.yml",
    ".github/workflows/retrieve.yml",
    ".github/workflows/rollback.yml",
    ".github/workflows/sf-toolbox-image.yml",
    ".github/workflows/snapshot.yml",
  ]) {
    const jobs = yaml.load(read(workflow)).jobs ?? {};
    for (const [name, job] of Object.entries(jobs)) {
      if (!job.container) continue;
      assert.equal(
        job["runs-on"],
        "${{ fromJSON(vars.ORBITOPS_TOOLBOX_RUNNER_LABELS || '[\"ubuntu-latest\"]') }}",
        `${workflow} job ${name} must use the configurable toolbox runner`,
      );
    }
  }
});
