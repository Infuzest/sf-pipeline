import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCoverageApex, isTestClassSource } from "./coverage-apex.mjs";

function projectWithClass(name, source) {
  const root = mkdtempSync(join(tmpdir(), "orbitops-apex-"));
  const classes = join(root, "force-app", "main", "default", "classes");
  mkdirSync(classes, { recursive: true });
  writeFileSync(join(classes, `${name}.cls`), source);
  return { root, project: { packageDirectories: [{ path: "force-app" }] } };
}

test("recognises modern and legacy Apex test classes", () => {
  assert.equal(isTestClassSource("@isTest private class ExampleTest {}"), true);
  assert.equal(isTestClassSource("@IsTest(SeeAllData=false)\nprivate class ExampleTest {}"), true);
  assert.equal(isTestClassSource("public class LegacyTest { static testMethod void works() {} }"), true);
  assert.equal(isTestClassSource("public with sharing class Service {}"), false);
});

test("test-only Apex delta does not require coverage", () => {
  const { root, project } = projectWithClass("ExampleTest", "@isTest private class ExampleTest {}");
  assert.equal(hasCoverageApex({ ApexClass: ["ExampleTest"] }, project, root), false);
});

test("production classes and triggers require coverage", () => {
  const { root, project } = projectWithClass("Service", "public class Service {}");
  assert.equal(hasCoverageApex({ ApexClass: ["Service"] }, project, root), true);
  assert.equal(hasCoverageApex({ ApexTrigger: ["AccountTrigger"] }, project, root), true);
});

test("missing class source keeps the coverage gate enabled", () => {
  const root = mkdtempSync(join(tmpdir(), "orbitops-apex-"));
  const project = { packageDirectories: [{ path: "force-app" }] };
  assert.equal(hasCoverageApex({ ApexClass: ["UnknownClass"] }, project, root), true);
});
