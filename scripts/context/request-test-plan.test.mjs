import assert from "node:assert/strict";
import test from "node:test";
import { resolveRequestTestPlan } from "./request-test-plan.mjs";

test("uses the test plan stored on this individual promotion", () => {
  const body = '<!-- orbitops:test-plan {"level":"RunSpecifiedTests","classes":["AccountTest"]} -->';
  assert.deepEqual(resolveRequestTestPlan(body, "RunLocalTests", []), {
    level: "RunSpecifiedTests", classes: ["AccountTest"], skipValidation: false, source: "request",
  });
});

test("supports visible PR fields for GitHub-native developers", () => {
  const body = "OrbitOps-Test-Level: RunSpecifiedTests\nOrbitOps-Test-Classes: AccountTest, ContactTest.testInsert";
  assert.deepEqual(resolveRequestTestPlan(body), {
    level: "RunSpecifiedTests", classes: ["AccountTest", "ContactTest.testInsert"], skipValidation: false, source: "request",
  });
});

test("falls back to the governed stage default for older requests", () => {
  assert.deepEqual(resolveRequestTestPlan("No marker", "RunLocalTests", []), {
    level: "RunLocalTests", classes: [], skipValidation: false, source: "stage-default",
  });
});

test("a centrally governed stage cannot be overridden by a request marker", () => {
  const body = '<!-- orbitops:test-plan {"level":"NoTestRun","classes":[]} -->';
  assert.deepEqual(resolveRequestTestPlan(body, "RunLocalTests", [], false), {
    level: "RunLocalTests", classes: [], skipValidation: false, source: "stage-policy",
  });
});

test("a trusted OrbitOps stage promotion can choose its own test plan", () => {
  const body = '<!-- orbitops:test-plan {"level":"RunSpecifiedTests","classes":["ProductionSmokeTest"]} -->';
  assert.deepEqual(resolveRequestTestPlan(body, "RunLocalTests", [], true), {
    level: "RunSpecifiedTests", classes: ["ProductionSmokeTest"], skipValidation: false, source: "request",
  });
});

test("records a release-manager request to skip Salesforce validation", () => {
  const body = '<!-- orbitops:test-plan {"level":"RunSpecifiedTests","classes":["ProductionSmokeTest"],"skipValidation":true} -->';
  assert.deepEqual(resolveRequestTestPlan(body), {
    level: "RunSpecifiedTests", classes: ["ProductionSmokeTest"], skipValidation: true, source: "request",
  });
});

test("rejects an unsafe specified test plan", () => {
  assert.throws(
    () => resolveRequestTestPlan("OrbitOps-Test-Level: RunSpecifiedTests\nOrbitOps-Test-Classes: Test; rm -rf /"),
    /unique Apex class/
  );
});
