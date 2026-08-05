#!/usr/bin/env node
/**
 * Build the authoritative "what will deploy" preview for a gated release.
 *
 * The deploy workflow's precheck already runs sfdx-git-delta BEFORE the
 * environment approval gate; this turns that delta into JSON so the UI can
 * show reviewers exactly the components Salesforce will receive — not a raw
 * list of changed files (docs, workflows and scripts never deploy).
 *
 * Usage:
 *   deploy-preview.mjs --delta-dir <dir> --env <env> --run-id <id> --sha <sha>
 *                      [--mode delta|full] [--out deploy-preview.json]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePackageXml } from "../delta/render-comment.mjs";

const flag = (name, def = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const count = (map) => Object.values(map).reduce((n, arr) => n + arr.length, 0);

/** Parse a delta directory into {components, destructive} component maps. */
export function readDelta(deltaDir) {
  const read = (sub, file) => {
    const p = join(deltaDir, sub, file);
    return existsSync(p) ? parsePackageXml(readFileSync(p, "utf8")) : {};
  };
  return {
    components: deltaDir ? read("package", "package.xml") : {},
    destructive: deltaDir ? read("destructiveChanges", "destructiveChanges.xml") : {},
  };
}

export function buildDeployPreview({ deltaDir, env, runId, sha, mode }) {
  const { components, destructive } = mode === "full" ? { components: {}, destructive: {} } : readDelta(deltaDir);
  return {
    type: "deploy-preview",
    env,
    runId: String(runId ?? ""),
    sha: String(sha ?? ""),
    // "full" = first release to this stage: the whole package directory ships,
    // so there is no delta to enumerate.
    mode: mode || "delta",
    components,
    destructive,
    componentCount: count(components),
    destructiveCount: count(destructive),
    timestamp: new Date().toISOString(),
  };
}

// CLI entry (skipped when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const preview = buildDeployPreview({
    deltaDir: flag("delta-dir"),
    env: flag("env"),
    runId: flag("run-id"),
    sha: flag("sha"),
    mode: flag("mode", "delta"),
  });
  const out = flag("out", "deploy-preview.json");
  writeFileSync(out, JSON.stringify(preview, null, 2) + "\n");
  console.log(
    `Deploy preview: ${preview.componentCount} component(s), ${preview.destructiveCount} to remove (mode=${preview.mode}) → ${out}`
  );
}
