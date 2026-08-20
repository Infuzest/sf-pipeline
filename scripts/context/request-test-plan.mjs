#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setOutputs } from "../lib/output.mjs";
import { APEX_TEST_RE } from "./test-classes.mjs";

export const TEST_LEVELS = new Set([
  "Conditional",
  "RunLocalTests",
  "RunSpecifiedTests",
  "RunRelevantTests",
  "NoTestRun",
]);

const MARKER = /<!--\s*orbitops:test-plan\s+(\{[^\n]*\})\s*-->/;
const LEVEL_LINE = /^OrbitOps-Test-Level:\s*(\S+)\s*$/mi;
const CLASSES_LINE = /^OrbitOps-Test-Classes:\s*(.*?)\s*$/mi;

function validatePlan(level, classes, skipValidation = false) {
  if (!TEST_LEVELS.has(level)) throw new Error(`Unsupported test level: ${level}`);
  const unique = [...new Set(classes.map((name) => String(name).trim()).filter(Boolean))];
  if (unique.length > 500 || unique.some((name) => !APEX_TEST_RE.test(name))) {
    throw new Error("The resolved plan must contain up to 500 unique Apex class or Class.testMethod names.");
  }
  if (level === "RunSpecifiedTests" && unique.length === 0) {
    throw new Error("RunSpecifiedTests needs at least one test class on this promotion request.");
  }
  if (level !== "RunSpecifiedTests" && unique.length > 0) {
    throw new Error("Test classes can only be supplied with RunSpecifiedTests.");
  }
  return { level, classes: unique, skipValidation: skipValidation === true };
}

export function resolveRequestTestPlan(
  body,
  fallbackLevel = "Conditional",
  fallbackClasses = [],
  allowRequest = true,
  { requestedLevel = "", repositoryClasses = [], repositoryFiles = [] } = {},
) {
  const runtimeLevel = String(requestedLevel ?? "").trim();
  if (runtimeLevel) {
    return {
      ...validatePlan(runtimeLevel, runtimeLevel === "RunSpecifiedTests" ? repositoryClasses : []),
      source: repositoryClasses.length ? "runtime-input+repository-manifests" : "runtime-input",
      ...(repositoryFiles.length ? { manifestFiles: repositoryFiles } : {}),
    };
  }
  if (!allowRequest) return { ...validatePlan(fallbackLevel, fallbackClasses), source: "stage-policy" };
  const marker = String(body ?? "").match(MARKER);
  if (marker) {
    let parsed;
    try { parsed = JSON.parse(marker[1]); } catch { throw new Error("The OrbitOps test plan marker is not valid JSON."); }
    const markerClasses = Array.isArray(parsed?.classes) ? parsed.classes : [];
    const classes = parsed?.level === "RunSpecifiedTests" && repositoryClasses.length ? repositoryClasses : markerClasses;
    return {
      ...validatePlan(parsed?.level, classes, parsed?.skipValidation === true),
      source: repositoryClasses.length ? "request+repository-manifests" : "request",
      ...(repositoryFiles.length ? { manifestFiles: repositoryFiles } : {}),
    };
  }

  const levelLine = String(body ?? "").match(LEVEL_LINE);
  if (levelLine) {
    const classesLine = String(body ?? "").match(CLASSES_LINE);
    const classes = (classesLine?.[1] ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    const resolved = levelLine[1] === "RunSpecifiedTests" && repositoryClasses.length ? repositoryClasses : classes;
    return {
      ...validatePlan(levelLine[1], resolved),
      source: repositoryClasses.length ? "request+repository-manifests" : "request",
      ...(repositoryFiles.length ? { manifestFiles: repositoryFiles } : {}),
    };
  }

  return { ...validatePlan(fallbackLevel, fallbackClasses), source: "stage-default" };
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bodyFile = flag("body");
    const fallbackLevel = flag("fallback-level", "Conditional");
    const fallbackClasses = JSON.parse(flag("fallback-classes", "[]"));
    const allowRequest = flag("allow-request", "true") === "true";
    const repositoryClasses = JSON.parse(flag("repository-classes", "[]"));
    const repositoryFiles = JSON.parse(flag("repository-files", "[]"));
    const plan = resolveRequestTestPlan(
      bodyFile ? readFileSync(bodyFile, "utf8") : "",
      fallbackLevel,
      fallbackClasses,
      allowRequest,
      { requestedLevel: flag("requested-level", ""), repositoryClasses, repositoryFiles },
    );
    setOutputs({
      test_level: plan.level,
      test_classes: JSON.stringify(plan.classes),
      test_plan_source: plan.source,
      test_class_files: JSON.stringify(plan.manifestFiles ?? []),
      skip_validation: String(plan.skipValidation),
    });
    console.log(`Apex test plan: ${plan.level}${plan.classes.length ? ` (${plan.classes.join(", ")})` : ""} [${plan.source}]${plan.skipValidation ? " (Salesforce validation skipped)" : ""}`);
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exit(1);
  }
}
