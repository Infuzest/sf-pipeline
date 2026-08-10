import assert from "node:assert/strict";
import test from "node:test";
import { latestVersion, nextVersion, parseVersion } from "./next-version.mjs";

test("ignores deployment and non-stable tags", () => {
  assert.deepEqual(parseVersion("v2.7.3"), { major: 2, minor: 7, patch: 3 });
  assert.equal(parseVersion("deploy/production/42"), null);
  assert.equal(parseVersion("v2.7"), null);
  assert.deepEqual(latestVersion(["v2.6.9", "v2.7.1", "v1.99.99", "v2.7.1-rc.1"]), { major: 2, minor: 7, patch: 1 });
});

test("increments semantic version tags for each approved release type", () => {
  const tags = ["v2.7.3", "deploy/production/42"];
  assert.equal(nextVersion(tags, "bugfix"), "v2.7.4");
  assert.equal(nextVersion(tags, "feature"), "v2.8.0");
  assert.equal(nextVersion(tags, "breaking"), "v3.0.0");
});

test("uses a predictable initial version", () => {
  assert.equal(nextVersion([], "bugfix"), "v0.0.1");
  assert.equal(nextVersion([], "feature"), "v0.1.0");
  assert.equal(nextVersion([], "breaking"), "v1.0.0");
});
