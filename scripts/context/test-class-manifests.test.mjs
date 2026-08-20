import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseTestClassManifest, resolveTestClassManifests } from "./test-class-manifests.mjs";

const run = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), "orbitops-tests-"));
  run(cwd, "init", "-q");
  run(cwd, "config", "user.name", "OrbitOps Test");
  run(cwd, "config", "user.email", "orbitops@example.invalid");
  writeFileSync(join(cwd, "README.md"), "base\n");
  run(cwd, "add", ".");
  run(cwd, "commit", "-qm", "base");
  return cwd;
}

test("unions and deduplicates changed manifests across merged changes", () => {
  const cwd = repository();
  const from = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  mkdirSync(join(cwd, ".orbitops/test-classes"), { recursive: true });
  writeFileSync(join(cwd, ".orbitops/test-classes/PROJ-1.json"), JSON.stringify({ schemaVersion: 1, changeId: "PROJ-1", classes: ["AccountTest", "SharedTest"] }));
  writeFileSync(join(cwd, ".orbitops/test-classes/PROJ-2.json"), JSON.stringify({ schemaVersion: 1, changeId: "PROJ-2", classes: ["ContactTest.testInsert", "SharedTest"] }));
  run(cwd, "add", ".");
  run(cwd, "commit", "-qm", "add test contracts");

  assert.deepEqual(resolveTestClassManifests({ from, to: "HEAD", cwd }), {
    classes: ["AccountTest", "SharedTest", "ContactTest.testInsert"],
    files: [".orbitops/test-classes/PROJ-1.json", ".orbitops/test-classes/PROJ-2.json"],
    changes: ["PROJ-1", "PROJ-2"],
  });
});

test("rejects malformed repository contracts", () => {
  assert.throws(
    () => parseTestClassManifest("bad.json", JSON.stringify({ schemaVersion: 1, changeId: "PROJ-1", classes: ["Test; rm -rf /" ] })),
    /unique Apex class/,
  );
});
