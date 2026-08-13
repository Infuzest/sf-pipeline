import assert from "node:assert/strict";
import test from "node:test";
import { recentMetadataEntries } from "./recent-metadata.mjs";

const catalog = {
  generatedAt: "2026-08-13T12:00:00.000Z",
  categories: [
    {
      groups: [
        {
          items: [
            { type: "ApexClass", member: "ChangedToday", lastModifiedDate: "2026-08-13T08:00:00.000Z" },
            { type: "CustomField", member: "Account.ChangedYesterday__c", lastModifiedDate: "2026-08-12T08:00:00.000Z" },
            { type: "Flow", member: "TooOld", lastModifiedDate: "2026-08-10T08:00:00.000Z" },
            { type: "ApexClass", member: "NoTimestamp" },
          ],
        },
      ],
    },
  ],
};

test("defaults can retrieve metadata modified within two calendar-day periods", () => {
  assert.deepEqual(recentMetadataEntries(catalog, 2), [
    { type: "ApexClass", member: "ChangedToday" },
    { type: "CustomField", member: "Account.ChangedYesterday__c" },
  ]);
});

test("rejects unsupported day values", () => {
  assert.throws(() => recentMetadataEntries(catalog, 9), /Choose 1–7 or 10 days/);
});
