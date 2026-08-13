#!/usr/bin/env node
/**
 * Detects whether a delta contains Apex that should be subject to the coverage
 * gate. Test classes still make the deployment run Apex tests, but a change
 * containing only test classes has no production Apex whose coverage can be
 * measured and must not fail because Salesforce reports no aggregate coverage.
 *
 * Usage: coverage-apex.mjs <delta-dir> [--project sfdx-project.json]
 * Job output: has_coverage_apex (true/false)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { setOutputs } from "../lib/output.mjs";
import { parsePackageXml } from "./render-comment.mjs";

export function isTestClassSource(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
  const classAnnotation = /@isTest(?:\s*\([^)]*\))?\s*(?:(?:public|private|global|virtual|abstract|with\s+sharing|without\s+sharing|inherited\s+sharing)\s+)*class\b/i;
  return classAnnotation.test(withoutComments) || /\bstatic\s+testMethod\b/i.test(withoutComments);
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

export function hasCoverageApex(changed, project, projectRoot = ".") {
  if ((changed.ApexTrigger ?? []).length > 0) return true;
  const classes = changed.ApexClass ?? [];
  if (!classes.length) return false;

  const packageDirs = (project?.packageDirectories ?? [])
    .map((entry) => entry?.path)
    .filter(Boolean);
  const classFiles = packageDirs.flatMap((dir) =>
    walk(resolve(projectRoot, dir)).filter((path) => path.endsWith(".cls"))
  );

  return classes.some((member) => {
    if (member === "*") return true;
    const sourcePath = classFiles.find((path) => basename(path, ".cls") === member);
    // Missing source is unexpected for an additive delta. Fail safe by keeping
    // coverage enabled instead of accidentally weakening a production gate.
    if (!sourcePath) return true;
    return !isTestClassSource(readFileSync(sourcePath, "utf8"));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const deltaDir = process.argv[2];
  const projectIndex = process.argv.indexOf("--project");
  const projectPath = projectIndex > -1 ? process.argv[projectIndex + 1] : "sfdx-project.json";
  if (!deltaDir) {
    console.error("Usage: coverage-apex.mjs <delta-dir> [--project sfdx-project.json]");
    process.exit(2);
  }
  const manifestPath = join(deltaDir, "package", "package.xml");
  const changed = existsSync(manifestPath)
    ? parsePackageXml(readFileSync(manifestPath, "utf8"))
    : {};
  const project = existsSync(projectPath)
    ? JSON.parse(readFileSync(projectPath, "utf8"))
    : {};
  const hasCoverageRelevantApex = hasCoverageApex(changed, project, ".");
  setOutputs({ has_coverage_apex: hasCoverageRelevantApex });
  console.log(hasCoverageRelevantApex
    ? "Production Apex is present — coverage gate applies."
    : "No production Apex is present — coverage gate does not apply.");
}
