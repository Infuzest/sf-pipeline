#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setOutputs } from "../lib/output.mjs";
import { APEX_TEST_RE } from "./test-classes.mjs";

export const TEST_CLASS_MANIFEST_ROOT = ".orbitops/test-classes";

function validateManifest(path, value) {
  if (!value || value.schemaVersion !== 1) {
    throw new Error(`${path} must use OrbitOps test-class schemaVersion 1.`);
  }
  if (typeof value.changeId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._#-]{0,99}$/.test(value.changeId)) {
    throw new Error(`${path} has an invalid changeId.`);
  }
  if (!Array.isArray(value.classes) || value.classes.length === 0 || value.classes.length > 50) {
    throw new Error(`${path} must contain between 1 and 50 Apex tests.`);
  }
  const classes = value.classes.map((name) => typeof name === "string" ? name.trim() : "");
  if (new Set(classes).size !== classes.length || classes.some((name) => !APEX_TEST_RE.test(name))) {
    throw new Error(`${path} must contain unique Apex class or Class.testMethod names.`);
  }
  return { schemaVersion: 1, changeId: value.changeId, classes };
}

export function parseTestClassManifest(path, raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  return validateManifest(path, value);
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Resolve only manifests introduced or changed by this exact candidate. This
 * prevents old test declarations already present on the destination branch
 * from leaking into every future RunSpecifiedTests deployment.
 */
export function resolveTestClassManifests({ from, to, cwd = process.cwd(), root = TEST_CLASS_MANIFEST_ROOT }) {
  if (!from || !to) throw new Error("Both manifest comparison revisions are required.");
  const listed = git(cwd, "diff", "--name-only", "--diff-filter=ACMR", from, to, "--", root);
  const files = listed ? listed.split("\n").filter((path) => path.startsWith(`${root}/`) && path.endsWith(".json")) : [];
  const classes = [];
  const seen = new Set();
  const changes = [];

  for (const path of files) {
    const manifest = parseTestClassManifest(path, git(cwd, "show", `${to}:${path}`));
    changes.push(manifest.changeId);
    for (const name of manifest.classes) {
      if (!seen.has(name)) {
        seen.add(name);
        classes.push(name);
      }
    }
  }
  if (classes.length > 500) throw new Error("This promotion resolves to more than 500 unique Apex tests; split it into smaller releases.");
  return { classes, files, changes: [...new Set(changes)] };
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = resolveTestClassManifests({
      from: flag("from"),
      to: flag("to"),
      cwd: flag("cwd", process.cwd()),
      root: flag("root", TEST_CLASS_MANIFEST_ROOT),
    });
    setOutputs({
      test_classes: JSON.stringify(result.classes),
      test_class_files: JSON.stringify(result.files),
      test_class_changes: JSON.stringify(result.changes),
    });
    console.log(result.files.length
      ? `Apex test manifests: ${result.files.join(", ")} (${result.classes.length} unique test${result.classes.length === 1 ? "" : "s"})`
      : "Apex test manifests: none changed in this candidate");
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exit(1);
  }
}
