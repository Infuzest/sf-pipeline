import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInclude, renderPackageXml, mergeManifest } from "./merge-manifest.mjs";

const DELTA = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>Bank_Transactions__c.Amount__c</members>
        <members>Bank_Transactions__c.Description__c</members>
        <name>CustomField</name>
    </types>
    <version>64.0</version>
</Package>`;

test("parses Type:Member entries separated by commas or newlines", () => {
  assert.deepEqual(parseInclude("CustomObject:Foo__c, CustomField:Foo__c.Bar__c"), {
    CustomObject: ["Foo__c"],
    CustomField: ["Foo__c.Bar__c"],
  });
  assert.deepEqual(parseInclude("CustomObject:A__c\nCustomObject:B__c\n"), {
    CustomObject: ["A__c", "B__c"],
  });
  assert.deepEqual(parseInclude(""), {});
  assert.deepEqual(parseInclude(null), {});
});

test("rejects entries that aren't Type:Member", () => {
  assert.throws(() => parseInclude("Bank_Transactions__c"), /Not a Type:Member/);
  assert.throws(() => parseInclude("CustomObject:"), /Not a Type:Member/);
  assert.throws(() => parseInclude(":Foo__c"), /Not a Type:Member/);
  assert.throws(() => parseInclude("Custom Object:Foo__c"), /Not a metadata type/);
});

test("adds the missing parent object to a delta that only has its fields", () => {
  // The real case: PROD lacked Bank_Transactions__c, so deploying its fields
  // failed with "Entity 'Bank_Transactions__c' not found" and no delta could
  // ever include the object, because the object hadn't changed in git.
  const { types, xml } = mergeManifest(DELTA, "CustomObject:Bank_Transactions__c");
  assert.deepEqual(types.CustomObject, ["Bank_Transactions__c"]);
  assert.deepEqual(types.CustomField, [
    "Bank_Transactions__c.Amount__c",
    "Bank_Transactions__c.Description__c",
  ]);
  assert.match(xml, /<name>CustomObject<\/name>/);
  assert.match(xml, /<version>64\.0<\/version>/);
});

test("keeps the delta's api version and never duplicates members", () => {
  const { types } = mergeManifest(DELTA, "CustomField:Bank_Transactions__c.Amount__c");
  assert.deepEqual(types.CustomField, [
    "Bank_Transactions__c.Amount__c",
    "Bank_Transactions__c.Description__c",
  ]);
});

test("a whole-type wildcard supersedes named members", () => {
  const { types } = mergeManifest(DELTA, "CustomField:*");
  assert.deepEqual(types.CustomField, ["*"]);
});

test("works with no delta at all (nothing changed in git, org still needs it)", () => {
  const { types, xml } = mergeManifest(null, "CustomObject:Foo__c");
  assert.deepEqual(types, { CustomObject: ["Foo__c"] });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
});

test("output is deterministic — types and members sorted", () => {
  const a = renderPackageXml({ Zeta: ["b", "a"], Alpha: ["c"] });
  const b = renderPackageXml({ Alpha: ["c"], Zeta: ["a", "b"] });
  assert.equal(a, b);
  assert.ok(a.indexOf("<name>Alpha</name>") < a.indexOf("<name>Zeta</name>"));
});
