import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePackageXml } from "../delta/render-comment.mjs";
import {
  addPlanToSafety,
  flowVersionQuery,
  prepareFlowDeletions,
  queryFlowVersions,
  renderFlowDeletionReport,
} from "./prepare-flow-deletions.mjs";

function manifest(types, version = "64.0") {
  const blocks = Object.entries(types).map(([name, members]) => [
    "    <types>",
    ...members.map((member) => `        <members>${member}</members>`),
    `        <name>${name}</name>`,
    "    </types>",
  ].join("\n"));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
    ...blocks,
    `    <version>${version}</version>`,
    "</Package>",
    "",
  ].join("\n");
}

const flow = (parent, version, status = "Obsolete") => ({
  Definition: { DeveloperName: parent },
  VersionNumber: version,
  Status: status,
});

test("leaves destructive manifests without Flows byte-for-byte unchanged", () => {
  const xml = manifest({ CustomField: ["Account.Legacy__c"] }, "63.0");
  const result = prepareFlowDeletions(xml, []);
  assert.equal(result.changed, false);
  assert.equal(result.xml, xml);
});

test("replaces parent Flow names with every destination version and preserves other metadata", () => {
  const xml = manifest({
    Flow: ["Case_Routing"],
    CustomField: ["Account.Legacy__c"],
  }, "63.0");
  const result = prepareFlowDeletions(xml, [
    flow("Case_Routing", 3, "Active"),
    flow("Case_Routing", 1),
    flow("Other_Flow", 8),
    flow("Case_Routing", 2, "Draft"),
  ]);

  assert.deepEqual(parsePackageXml(result.xml), {
    CustomField: ["Account.Legacy__c"],
    Flow: ["Case_Routing-1", "Case_Routing-2", "Case_Routing-3"],
  });
  assert.match(result.xml, /<version>63\.0<\/version>/);
  assert.deepEqual(result.plan[0].activeVersions, ["Case_Routing-3"]);
  assert.match(renderFlowDeletionReport(result.plan), /Deactivate them before executing/);
});

test("removes a parent Flow from destructive changes when it is already absent", () => {
  const result = prepareFlowDeletions(manifest({ Flow: ["Gone_Flow"] }), []);
  assert.deepEqual(parsePackageXml(result.xml), {});
  assert.equal(result.plan[0].alreadyAbsent, true);
  assert.match(renderFlowDeletionReport(result.plan), /already absent/);
});

test("keeps already-versioned Flow members and expands only parent members", () => {
  const result = prepareFlowDeletions(
    manifest({ Flow: ["Legacy-4", "Current"] }),
    [flow("Current", 1, "Draft")],
  );
  assert.deepEqual(parsePackageXml(result.xml).Flow, ["Current-1", "Legacy-4"]);
  assert.deepEqual(result.alreadyVersioned, ["Legacy-4"]);
});

test("rejects wildcard and unsafe parent Flow deletions", () => {
  assert.throws(() => prepareFlowDeletions(manifest({ Flow: ["*"] }), []), /Wildcard Flow deletion is unsafe/);
  assert.throws(() => prepareFlowDeletions(manifest({ Flow: ["Bad'Name"] }), []), /Unsafe Flow API name/);
});

test("queries Tooling API without passing Flow names through a shell", () => {
  const calls = [];
  const records = queryFlowVersions(["Case_Routing"], {
    targetOrg: "destination",
    exec(command, args, options) {
      calls.push({ command, args, options });
      return JSON.stringify({ result: { records: [flow("Case_Routing", 2, "Active")] } });
    },
  });

  assert.equal(calls[0].command, "sf");
  assert.deepEqual(calls[0].args.slice(0, 3), ["data", "query", "--use-tooling-api"]);
  assert.equal(calls[0].args.at(-2), "destination");
  assert.equal(calls[0].args.at(-1), "--json");
  assert.match(calls[0].args[calls[0].args.indexOf("--query") + 1], /Definition\.DeveloperName IN \('Case_Routing'\)/);
  assert.equal(calls[0].options.encoding, "utf8");
  assert.equal(records.length, 1);
});

test("the Tooling API query selects current unversioned Flow model fields", () => {
  const query = flowVersionQuery(["Flow_One", "Flow_Two"]);
  assert.match(query, /Definition\.DeveloperName, VersionNumber, Status/);
  assert.match(query, /FROM Flow/);
});

test("adds the concrete Flow plan and active-version guidance to rollback safety", () => {
  const plan = [{
    parent: "Case_Routing",
    versions: [{ member: "Case_Routing-1", version: 1, status: "Active" }],
    activeVersions: ["Case_Routing-1"],
    alreadyAbsent: false,
  }];
  const safety = addPlanToSafety({
    warnings: [{ severity: "high", type: "Flow", member: "Case_Routing", text: "old" }],
  }, plan);
  assert.equal(safety.highRiskCount, 1);
  assert.deepEqual(safety.flowDeletionPlan, plan);
  assert.match(safety.warnings[0].text, /version-specific deletion/);
  assert.match(safety.warnings[0].text, /must be deactivated/);
});
