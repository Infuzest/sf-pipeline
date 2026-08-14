import test from "node:test";
import assert from "node:assert/strict";
import { packageDirectories, unrecordedSalesforceFiles } from "./unrecorded.mjs";

test("pipeline-only updates never block a Salesforce rollback", () => {
  assert.deepEqual(unrecordedSalesforceFiles([
    ".github/workflows/rollback.yml",
    "docs/RUNBOOK.md",
    "scripts/rollback/preview.sh",
  ], { packageDirectories: [{ path: "force-app" }] }), []);
});

test("unrecorded Salesforce files remain a hard rollback stop", () => {
  assert.deepEqual(unrecordedSalesforceFiles([
    "force-app/main/default/classes/Example.cls",
    "docs/RUNBOOK.md",
    "packages/shared/main/default/objects/Example__c/Example__c.object-meta.xml",
  ], { packageDirectories: [{ path: "force-app" }, { path: "packages/shared" }] }), [
    "force-app/main/default/classes/Example.cls",
    "packages/shared/main/default/objects/Example__c/Example__c.object-meta.xml",
  ]);
});

test("older projects fall back to force-app", () => {
  assert.deepEqual(packageDirectories({}), ["force-app"]);
});
