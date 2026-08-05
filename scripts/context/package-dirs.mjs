#!/usr/bin/env node
/**
 * Prints the project's package directories as sfdx-git-delta `--source-dir`
 * arguments. Usage: node scripts/context/package-dirs.mjs [path-to-sfdx-project.json]
 *
 * Why this exists: sfdx-git-delta defaults to scanning the WHOLE repo, so any
 * file that merely looks like Salesforce metadata gets swept into the delta —
 * even when it lives outside a package directory. One-off admin bundles
 * (scripts/setup/external-client-app/**) were being picked up, producing a
 * package.xml whose components have no source behind them; the validation then
 * failed with "No source-backed components present in the package" and zero
 * component errors, which is impossible to diagnose from the UI.
 *
 * Read from sfdx-project.json rather than hardcoding "force-app" — the package
 * layout is the project's to declare, the same way stage topology belongs to
 * .orbitops/pipeline.yml.
 */
import { readFileSync } from "node:fs";

export function packageDirArgs(projectJson) {
  const dirs = (projectJson?.packageDirectories ?? [])
    .map((d) => d?.path)
    .filter((p) => typeof p === "string" && p.trim().length > 0);
  // No declared package dirs: emit nothing and let sgd fall back to its default
  // rather than silently scoping the delta to a directory that may not exist.
  if (!dirs.length) return "";
  return `--source-dir ${dirs.join(" ")}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? "sfdx-project.json";
  let project = {};
  try {
    project = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* missing or unreadable — fall back to sgd's default scan */
  }
  console.log(packageDirArgs(project));
}
