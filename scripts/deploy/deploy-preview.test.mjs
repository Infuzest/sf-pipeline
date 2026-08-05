import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDeployPreview, readDelta } from "./deploy-preview.mjs";

const PKG = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types><members>BUP_Clinic__c.Discount__c</members><name>CustomField</name></types>
  <types><members>Case_Routing</members><members>Orchestrator_Flow</members><name>Flow</name></types>
  <version>64.0</version>
</Package>`;

const DESTRUCTIVE = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types><members>BUP_Clinic__c.Notes__c</members><name>CustomField</name></types>
  <version>64.0</version>
</Package>`;

function fixtureDelta({ pkg = PKG, destructive } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "delta-"));
  mkdirSync(join(dir, "package"), { recursive: true });
  writeFileSync(join(dir, "package", "package.xml"), pkg);
  if (destructive) {
    mkdirSync(join(dir, "destructiveChanges"), { recursive: true });
    writeFileSync(join(dir, "destructiveChanges", "destructiveChanges.xml"), destructive);
  }
  return dir;
}

test("counts only real Salesforce components, grouped by metadata type", () => {
  const p = buildDeployPreview({ deltaDir: fixtureDelta(), env: "uat", runId: "1", sha: "abc", mode: "delta" });
  assert.deepEqual(p.components.CustomField, ["BUP_Clinic__c.Discount__c"]);
  assert.deepEqual(p.components.Flow, ["Case_Routing", "Orchestrator_Flow"]);
  assert.equal(p.componentCount, 3); // 1 field + 2 flows — NOT a file count
  assert.equal(p.destructiveCount, 0);
});

test("destructive changes are reported separately", () => {
  const p = buildDeployPreview({
    deltaDir: fixtureDelta({ destructive: DESTRUCTIVE }),
    env: "uat", runId: "1", sha: "abc", mode: "delta",
  });
  assert.equal(p.componentCount, 3);
  assert.deepEqual(p.destructive.CustomField, ["BUP_Clinic__c.Notes__c"]);
  assert.equal(p.destructiveCount, 1);
});

test("full mode (first release) enumerates nothing — the whole package ships", () => {
  const p = buildDeployPreview({ deltaDir: fixtureDelta(), env: "uat", runId: "1", sha: "abc", mode: "full" });
  assert.equal(p.mode, "full");
  assert.equal(p.componentCount, 0);
  assert.deepEqual(p.components, {});
});

test("missing delta directory yields an empty preview rather than throwing", () => {
  const { components, destructive } = readDelta(join(tmpdir(), "does-not-exist-here"));
  assert.deepEqual(components, {});
  assert.deepEqual(destructive, {});
});

test("preview carries the identifying metadata the UI needs", () => {
  const p = buildDeployPreview({ deltaDir: fixtureDelta(), env: "production", runId: "42", sha: "deadbeef", mode: "delta" });
  assert.equal(p.type, "deploy-preview");
  assert.equal(p.env, "production");
  assert.equal(p.runId, "42");
  assert.equal(p.sha, "deadbeef");
  assert.ok(p.timestamp);
});
