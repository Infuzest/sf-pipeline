import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRollbackRefs } from "./refs.mjs";
import { analyzeRollback, renderReport } from "./analyze.mjs";

const TAGS = ["deploy/uat/1", "deploy/uat/2", "deploy/uat/3", "deploy/integration/9"];

test("resolves current/target/new tags for a valid rollback", () => {
  const r = resolveRollbackRefs(TAGS, "uat", 1);
  assert.equal(r.current, 3);
  assert.equal(r.currentTag, "deploy/uat/3");
  assert.equal(r.targetTag, "deploy/uat/1");
  assert.equal(r.newSeq, 4);
  assert.equal(r.newTag, "deploy/uat/4");
});

test("resolves sequence zero to the state before the first OrbitOps release", () => {
  const r = resolveRollbackRefs(TAGS, "uat", 0);
  assert.equal(r.current, 3);
  assert.equal(r.target, 0);
  assert.equal(r.targetTag, "deploy/uat/1^1");
  assert.equal(r.newSeq, 4);
});

test("rejects target >= current", () => {
  assert.throws(() => resolveRollbackRefs(TAGS, "uat", 3), /older than the current/);
  assert.throws(() => resolveRollbackRefs(TAGS, "uat", 5), /does not exist/);
});

test("rejects env with no deploys", () => {
  assert.throws(() => resolveRollbackRefs(TAGS, "production", 1), /No deploys found/);
});

test("field deletion flagged as high-risk data loss", () => {
  const a = analyzeRollback({
    changed: {},
    destructive: { CustomField: ["BUP_Clinic__c.Notes__c"] },
    meta: { env: "uat", from: 3, to: 1, includeDestructive: true },
  });
  assert.equal(a.highRiskCount, 1);
  assert.match(a.warnings[0].text, /permanently destroys all data/);
});

test("flow redeploy warns about version stacking; report honors destructive flag", () => {
  const a = analyzeRollback({
    changed: { Flow: ["Case_Routing"], CustomField: ["Acct__c.X__c"] },
    destructive: { CustomField: ["New__c.Y__c"] },
    meta: { env: "uat", from: 5, to: 2, includeDestructive: false },
  });
  const flowWarn = a.warnings.find((w) => w.type === "Flow");
  assert.match(flowWarn.text, /ADDS a new version/);
  const report = renderReport(a);
  assert.match(report, /They stay in the org \(destructive disabled\)/);
  assert.match(report, /New__c\.Y__c/); // listed but not struck (destructive disabled)
  assert.doesNotMatch(report, /~~New__c\.Y__c~~/);
  assert.match(report, /metadata only/);
});

test("destructive-enabled report strikes through deleted components", () => {
  const a = analyzeRollback({
    changed: {},
    destructive: { CustomField: ["New__c.Y__c"] },
    meta: { env: "uat", from: 5, to: 2, includeDestructive: true },
  });
  assert.match(renderReport(a), /~~New__c\.Y__c~~/);
});

test("clean apex-only rollback has no high-risk warnings", () => {
  const a = analyzeRollback({
    changed: { ApexClass: ["DiscountService"] },
    destructive: {},
    meta: { env: "uat", from: 4, to: 3, includeDestructive: false },
  });
  assert.equal(a.highRiskCount, 0);
  assert.equal(a.destructiveCount, 0);
});
