#!/usr/bin/env node
import { readFileSync } from "node:fs";

export function packageDirectories(project) {
  const paths = (project?.packageDirectories ?? [])
    .map((entry) => entry?.path)
    .filter((path) => typeof path === "string" && path.trim().length > 0)
    .map((path) => path.replace(/^\.\//, "").replace(/\/$/, ""));
  return paths.length ? [...new Set(paths)] : ["force-app"];
}

export function unrecordedSalesforceFiles(files, project) {
  const directories = packageDirectories(project);
  return [...new Set(files
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => directories.some((directory) => file === directory || file.startsWith(`${directory}/`))))]
    .sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const filesPath = process.argv[2];
  const projectPath = process.argv[3] ?? "sfdx-project.json";
  if (!filesPath) {
    console.error("Usage: unrecorded.mjs <changed-files.txt> [sfdx-project.json]");
    process.exit(2);
  }
  const files = readFileSync(filesPath, "utf8").split("\n");
  let project = {};
  try {
    project = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch {
    // Conventional force-app fallback keeps older repositories safe.
  }
  process.stdout.write(unrecordedSalesforceFiles(files, project).join("\n"));
}
