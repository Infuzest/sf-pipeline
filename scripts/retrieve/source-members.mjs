#!/usr/bin/env node
/**
 * Builds a retrieve manifest from the source org's source-tracking ledger
 * (SourceMember, tooling API) — this is how the platform knows what a citizen
 * developer changed in their sandbox without any local tooling.
 *
 * Usage: source-members.mjs --org <alias> --out <package.xml> [--json <list.json>]
 * Exits 0 with an empty manifest when nothing is tracked.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Citizen-safe metadata types. Profiles stay guardrailed (REQUIREMENTS.md E3.6);
// settings/org-shaped types are excluded to avoid dragging org config into a change.
const ALLOWED_TYPES = new Set([
  "CustomObject", "CustomField", "ValidationRule", "RecordType", "ListView",
  "CompactLayout", "Layout", "FlexiPage", "Flow", "ApexClass", "ApexTrigger",
  "LightningComponentBundle", "AuraDefinitionBundle",
  "PermissionSet", "CustomTab", "QuickAction", "EmailTemplate", "ReportType",
  "PathAssistant", "GlobalValueSet", "StandardValueSet", "CustomLabel", "CustomLabels",
]);

// Wildcard-unfriendly types (folder-based or named-only) excluded in fallback mode.
const NO_WILDCARD = new Set(["EmailTemplate", "StandardValueSet", "CustomLabels"]);

const flag = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const org = flag("org");
const out = flag("out", "retrieve-package.xml");

let records = null; // null = no source tracking OR --wildcard → full-type manifest
if (!process.argv.includes("--wildcard")) try {
  const raw = execFileSync(
    "sf",
    ["data", "query", "--use-tooling-api", "-o", org, "--json", "-q",
     "SELECT MemberType, MemberName FROM SourceMember WHERE IsNameObsolete = false ORDER BY MemberType, MemberName"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  records = JSON.parse(raw).result?.records ?? [];
} catch (err) {
  const msg = String(err.stdout ?? err.message ?? "");
  if (!/sObject type 'SourceMember' is not supported|INVALID_TYPE/i.test(msg)) throw err;
  // No source tracking (Developer Edition / regular sandbox): retrieve every
  // citizen-safe type wholesale — the git diff downstream keeps only real changes.
  console.log(`${org} has no source tracking — falling back to retrieve-by-type (git filters the rest).`);
}

if (records === null) {
  const types = [...ALLOWED_TYPES].filter((t) => !NO_WILDCARD.has(t)).sort();
  const typesXml = types
    .map((t) => `    <types>\n        <members>*</members>\n        <name>${t}</name>\n    </types>`)
    .join("\n");
  writeFileSync(
    out,
    `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${typesXml}\n    <version>64.0</version>\n</Package>\n`
  );
  if (flag("json")) {
    writeFileSync(flag("json"), JSON.stringify({ total: types.length, mode: "wildcard", components: {}, skipped: [] }, null, 2));
  }
  console.log(`Wildcard manifest written for ${types.length} metadata types.`);
  process.exit(0);
}

const byType = new Map();
const skipped = [];
for (const r of records) {
  if (!ALLOWED_TYPES.has(r.MemberType)) {
    skipped.push(`${r.MemberType}:${r.MemberName}`);
    continue;
  }
  if (!byType.has(r.MemberType)) byType.set(r.MemberType, new Set());
  byType.get(r.MemberType).add(r.MemberName);
}

const typesXml = [...byType.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([type, members]) =>
    [
      "    <types>",
      ...[...members].sort().map((m) => `        <members>${m}</members>`),
      `        <name>${type}</name>`,
      "    </types>",
    ].join("\n")
  )
  .join("\n");

writeFileSync(
  out,
  `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${typesXml}\n    <version>64.0</version>\n</Package>\n`
);

const total = [...byType.values()].reduce((n, s) => n + s.size, 0);
if (flag("json")) {
  writeFileSync(
    flag("json"),
    JSON.stringify(
      { total, components: Object.fromEntries([...byType].map(([t, s]) => [t, [...s].sort()])), skipped },
      null,
      2
    )
  );
}
console.log(`Tracked changes in ${org}: ${total} component(s)` + (skipped.length ? ` (${skipped.length} skipped by type policy)` : ""));
if (total === 0) console.log("Nothing to retrieve.");
