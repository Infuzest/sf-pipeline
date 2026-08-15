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

test("skipping the final practice run never bypasses the deployment approval gate", () => {
  const source = read(".github/workflows/_release-candidate.yml");
  assert.match(source, /skip_validation:/, "release workflow accepts the controlled exception");
  assert.match(source, /environment: \$\{\{ needs\.prepare\.outputs\.environment \}\}/, "the GitHub Environment gate remains on the deployment job");
  assert.match(source, /needs\.prepare\.outputs\.skip_validation != 'true'/, "only the final practice run is skipped");
});

test("every Salesforce operation shares the connected-org JWT identity", () => {
  for (const workflow of [
    ".github/workflows/_pr-validate.yml",
    ".github/workflows/_deploy.yml",
    ".github/workflows/_release-candidate.yml",
    ".github/workflows/_retrieve.yml",
    ".github/workflows/_rollback.yml",
    ".github/workflows/_snapshot.yml",
  ]) {
    const source = read(workflow);
    assert.match(source, /connected-orgs\.json/, `${workflow} reads the central org registry`);
    assert.match(source, /--registry connected-orgs\.json/, `${workflow} resolves the stage through the registry`);
    assert.match(source, /ORBITOPS_JWT_CLIENT_ID/, `${workflow} uses the shared JWT consumer key`);
    assert.match(source, /ORBITOPS_JWT_KEY/, `${workflow} uses the shared JWT private key`);
    assert.match(source, /outputs\.username/, `${workflow} supplies the org-specific deployment username`);
  }
});

test("missing Salesforce credentials fail with reconnect guidance", () => {
  const source = read(".github/actions/sf-auth/action.yml");
  assert.match(source, /Salesforce connection is incomplete/);
  assert.match(source, /Reconnect this environment in OrbitOps Administration/);
});

test("rollback blocks only unrecorded Salesforce package files", () => {
  const workflow = read(".github/workflows/_rollback.yml");
  const preview = read("scripts/rollback/preview.sh");
  assert.match(workflow, /BRANCH: \$\{\{ needs\.context\.outputs\.branch \}\}/);
  assert.match(preview, /scripts\/rollback\/unrecorded\.mjs/);
  assert.match(preview, /Salesforce changes must be reconciled before rollback/);
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
    ".github/workflows/_full-scan.yml",
    ".github/workflows/_retrieve.yml",
    ".github/workflows/_rollback.yml",
    ".github/workflows/sf-toolbox-image.yml",
    ".github/workflows/_snapshot.yml",
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

test("customer repositories never need a copied pipeline implementation", () => {
  for (const workflow of [
    ".github/workflows/_deploy.yml",
    ".github/workflows/_pr-validate.yml",
    ".github/workflows/_release-candidate.yml",
    ".github/workflows/_retrieve.yml",
    ".github/workflows/_rollback.yml",
    ".github/workflows/_snapshot.yml",
    ".github/workflows/_full-scan.yml",
  ]) {
    const source = read(workflow);
    assert.doesNotMatch(source, /\.pipeline/, `${workflow} must not checkout implementation from the caller`);
    assert.doesNotMatch(source, /uses:\s+\.\//, `${workflow} must not invoke a caller-local OrbitOps action`);
    assert.match(source, /Infuzest\/sf-pipeline\/\.github\/actions\/runtime@main/, `${workflow} loads the private runtime`);
  }
});
