#!/usr/bin/env node
/**
 * Salesforce cannot reliably delete a Flow definition by putting its
 * unversioned API name in destructiveChanges.xml (known issue W-10538057).
 * Resolve the destination org's concrete Flow versions through Tooling API and
 * replace each parent name with version-qualified members such as MyFlow-1.
 *
 * Preview stays read-only: active versions are reported and the subsequent
 * Metadata API dry-run decides whether Salesforce will accept the deletion.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parsePackageXml } from "../delta/render-comment.mjs";
import { renderPackageXml } from "../deploy/merge-manifest.mjs";

const FLOW_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const VERSIONED_FLOW = /-([1-9][0-9]*)$/;

const unique = (values) => [...new Set(values)];

function soqlString(value) {
  if (!FLOW_NAME.test(value)) throw new Error(`Unsafe Flow API name: "${value}"`);
  return `'${value}'`;
}

export function flowVersionQuery(names) {
  if (!names.length) throw new Error("At least one Flow API name is required");
  return [
    "SELECT Definition.DeveloperName, VersionNumber, Status",
    "FROM Flow",
    `WHERE Definition.DeveloperName IN (${names.map(soqlString).join(",")})`,
    "ORDER BY Definition.DeveloperName, VersionNumber",
  ].join(" ");
}

function recordsFrom(payload) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  return parsed?.result?.records ?? parsed?.records ?? [];
}

export function queryFlowVersions(names, { targetOrg = "target-org", exec = execFileSync } = {}) {
  const records = [];
  for (let index = 0; index < names.length; index += 75) {
    const batch = names.slice(index, index + 75);
    const output = exec(
      "sf",
      [
        "data", "query", "--use-tooling-api", "--query", flowVersionQuery(batch),
        "--target-org", targetOrg, "--json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    records.push(...recordsFrom(output));
  }
  return records;
}

function normalizeRecord(record) {
  const parent = record?.Definition?.DeveloperName;
  const version = Number(record?.VersionNumber);
  if (!parent || !Number.isInteger(version) || version < 1) return null;
  return { parent, version, status: String(record?.Status ?? "Unknown") };
}

/** Return a rewritten destructive package plus the audit plan behind it. */
export function prepareFlowDeletions(xml, records) {
  const types = parsePackageXml(xml);
  const apiVersion = xml.match(/<version>(.*?)<\/version>/)?.[1];
  const requested = unique(types.Flow ?? []);
  if (!requested.length) {
    return { xml, changed: false, plan: [], alreadyVersioned: [] };
  }
  if (requested.includes("*")) {
    throw new Error("Wildcard Flow deletion is unsafe. Name each Flow explicitly before backing out.");
  }

  const alreadyVersioned = requested.filter((name) => VERSIONED_FLOW.test(name));
  const parents = requested.filter((name) => !VERSIONED_FLOW.test(name));
  for (const parent of parents) soqlString(parent);

  const byParent = new Map(parents.map((parent) => [parent, []]));
  for (const raw of records) {
    const record = normalizeRecord(raw);
    if (record && byParent.has(record.parent)) byParent.get(record.parent).push(record);
  }

  const plan = parents.map((parent) => {
    const versions = byParent.get(parent)
      .sort((a, b) => a.version - b.version)
      .map(({ version, status }) => ({ member: `${parent}-${version}`, version, status }));
    return {
      parent,
      versions,
      activeVersions: versions.filter((item) => item.status.toLowerCase() === "active").map((item) => item.member),
      alreadyAbsent: versions.length === 0,
    };
  });

  const expanded = plan.flatMap((item) => item.versions.map((version) => version.member));
  const rewritten = { ...types };
  const flowMembers = unique([...alreadyVersioned, ...expanded]).sort();
  if (flowMembers.length) rewritten.Flow = flowMembers;
  else delete rewritten.Flow;

  return {
    xml: renderPackageXml(rewritten, apiVersion),
    changed: parents.length > 0,
    plan,
    alreadyVersioned,
  };
}

export function renderFlowDeletionReport(plan, alreadyVersioned = []) {
  const lines = ["", "### Flow deletion preparation", ""];
  if (alreadyVersioned.length) {
    lines.push(`- Already version-specific: ${alreadyVersioned.map((name) => `\`${name}\``).join(", ")}`);
  }
  for (const item of plan) {
    if (item.alreadyAbsent) {
      lines.push(`- **Flow \`${item.parent}\`** is already absent from the destination org; no deletion is needed.`);
      continue;
    }
    lines.push(
      `- **Flow \`${item.parent}\`** will delete ${item.versions.length} concrete version(s): ` +
      item.versions.map((version) => `\`${version.member}\` (${version.status})`).join(", "),
    );
    if (item.activeVersions.length) {
      lines.push(
        `  - ⚠️ Active version(s): ${item.activeVersions.map((name) => `\`${name}\``).join(", ")}. ` +
        "Deactivate them before executing the rollback; the preview does not change the org.",
      );
    }
  }
  lines.push(
    "",
    "> OrbitOps queried the destination org through the Salesforce Tooling API and replaced parent Flow names with exact version names.",
    "",
  );
  return lines.join("\n");
}

export function addPlanToSafety(safety, plan) {
  const planned = new Map(plan.map((item) => [item.parent, item]));
  const warnings = (safety.warnings ?? []).map((warning) => {
    if (warning.type !== "Flow" || !planned.has(warning.member)) return warning;
    const item = planned.get(warning.member);
    if (item.alreadyAbsent) {
      return { ...warning, severity: "info", text: "Flow is already absent from the destination org; no deletion is needed." };
    }
    const active = item.activeVersions.length
      ? ` Active version(s) ${item.activeVersions.join(", ")} must be deactivated before execution.`
      : "";
    return {
      ...warning,
      text: `OrbitOps resolved this Flow to ${item.versions.length} version-specific deletion(s).${active}`,
    };
  });
  return {
    ...safety,
    warnings,
    highRiskCount: warnings.filter((warning) => warning.severity === "high").length,
    flowDeletionPlan: plan,
  };
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = process.argv[2];
  if (!manifestPath || !existsSync(manifestPath)) throw new Error("A destructiveChanges.xml path is required");
  const original = readFileSync(manifestPath, "utf8");
  const types = parsePackageXml(original);
  const parentNames = unique((types.Flow ?? []).filter((name) => !VERSIONED_FLOW.test(name)));
  const records = parentNames.length ? queryFlowVersions(parentNames, { targetOrg: flag("target-org", "target-org") }) : [];
  const result = prepareFlowDeletions(original, records);
  if (result.changed) writeFileSync(manifestPath, result.xml);

  const report = renderFlowDeletionReport(result.plan, result.alreadyVersioned);
  if (flag("report")) writeFileSync(flag("report"), report);
  if (flag("preview")) writeFileSync(flag("preview"), readFileSync(flag("preview"), "utf8") + report);
  if (flag("safety")) {
    const safetyPath = flag("safety");
    const safety = JSON.parse(readFileSync(safetyPath, "utf8"));
    writeFileSync(safetyPath, JSON.stringify(addPlanToSafety(safety, result.plan), null, 2));
  }
  console.log(report);
}
