import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfiguredTestClasses } from "./test-classes.mjs";

test("accepts configured Apex classes and individual test methods", () => {
  assert.deepEqual(
    parseConfiguredTestClasses('["AccountServiceTest", "OpportunityTest.createsOpportunity"]'),
    ["AccountServiceTest", "OpportunityTest.createsOpportunity"]
  );
});

test("rejects unsafe, duplicate, or empty specified-test lists", () => {
  assert.throws(() => parseConfiguredTestClasses("[]"), /between 1 and 500/);
  assert.throws(() => parseConfiguredTestClasses('["OneTest", "OneTest"]'), /unique/);
  assert.throws(() => parseConfiguredTestClasses('["Test; rm -rf /"]'), /class names/);
});
