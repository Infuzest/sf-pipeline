import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
