import test from "node:test";
import assert from "node:assert/strict";
import { parseMetadataSelection, selectionManifest } from "./metadata-selection.mjs";

test("accepts the supported first-release metadata types and removes duplicates", () => {
  const entries = parseMetadataSelection(
    "CustomField:Account.Discount__c\nApexClass:PricingService\nCustomField:Account.Discount__c"
  );
  assert.deepEqual(entries, [
    { type: "CustomField", member: "Account.Discount__c" },
    { type: "ApexClass", member: "PricingService" },
  ]);
});

test("rejects unsupported types, unsafe member names and oversized selections", () => {
  assert.throws(() => parseMetadataSelection("Profile:Admin"), /Unsupported/);
  assert.throws(() => parseMetadataSelection("Flow:Name<bad>"), /Unsupported/);
  assert.throws(() => parseMetadataSelection("Flow:One\nFlow:Two", 1), /no more than 1/);
});

test("renders a deterministic package manifest", () => {
  const xml = selectionManifest([
    { type: "Flow", member: "Case_Routing" },
    { type: "CustomField", member: "Account.Discount__c" },
  ]);
  assert.match(xml, /<name>CustomField<\/name>[\s\S]*<name>Flow<\/name>/);
  assert.match(xml, /<members>Account\.Discount__c<\/members>/);
});
