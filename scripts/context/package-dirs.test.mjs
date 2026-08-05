import { test } from "node:test";
import assert from "node:assert/strict";
import { packageDirArgs } from "./package-dirs.mjs";

test("scopes the delta to the declared package directory", () => {
  assert.equal(
    packageDirArgs({ packageDirectories: [{ path: "force-app", default: true }] }),
    "--source-dir force-app"
  );
});

test("supports multiple package directories", () => {
  assert.equal(
    packageDirArgs({ packageDirectories: [{ path: "force-app" }, { path: "shared-app" }] }),
    "--source-dir force-app shared-app"
  );
});

test("emits nothing when no package directories are declared", () => {
  // Better to let sgd use its default than to scope the delta to a guess.
  assert.equal(packageDirArgs({ packageDirectories: [] }), "");
  assert.equal(packageDirArgs({}), "");
  assert.equal(packageDirArgs(null), "");
});

test("ignores blank and non-string paths", () => {
  assert.equal(
    packageDirArgs({ packageDirectories: [{ path: "  " }, { path: null }, { path: "force-app" }] }),
    "--source-dir force-app"
  );
});
