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
