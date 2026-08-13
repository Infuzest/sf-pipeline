import test from "node:test";
import assert from "node:assert/strict";
import { buildMetadataCatalog } from "./metadata-catalog.mjs";

test("groups fields and validation rules by object and Apex by kind", () => {
  const catalog = buildMetadataCatalog(
    {
      CustomField: [
        { fullName: "Account.Discount__c", lastModifiedDate: "2026-08-06T09:30:00.000Z" },
        { fullName: "Claims__c.Status__c" },
        { fullName: "Managed__c.Hidden__c", namespacePrefix: "pkg" },
      ],
      ApexClass: [{ fullName: "PricingService" }],
      ApexTrigger: [{ fullName: "AccountTrigger" }],
      Flow: [{ fullName: "Case_Routing" }],
      ValidationRule: [{ fullName: "Account.Discount_required" }],
    },
    "DEV1",
    "2026-08-07T10:00:00.000Z"
  );
  const fields = catalog.categories.find((category) => category.key === "fields");
  assert.deepEqual(fields.groups.map((group) => group.name), ["Account", "Claims__c"]);
  assert.equal(fields.groups.flatMap((group) => group.items).length, 2, "managed-package metadata is excluded");
  assert.equal(fields.groups[0].items[0].lastModifiedDate, "2026-08-06T09:30:00.000Z");
  assert.equal(fields.groups[1].items[0].lastModifiedDate, undefined, "missing Salesforce dates remain explicit unknowns");
  const apex = catalog.categories.find((category) => category.key === "apex");
  assert.deepEqual(apex.groups.map((group) => group.name), ["classes", "triggers"]);
});
