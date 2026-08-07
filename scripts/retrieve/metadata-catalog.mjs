#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CATALOG_TYPES = [
  { type: "CustomField", category: "fields" },
  { type: "ApexClass", category: "apex" },
  { type: "ApexTrigger", category: "apex" },
  { type: "LightningComponentBundle", category: "lwc" },
  { type: "AuraDefinitionBundle", category: "aura" },
  { type: "Flow", category: "flows" },
  { type: "ValidationRule", category: "validationRules" },
];

const CATEGORY_ORDER = ["fields", "apex", "lwc", "aura", "flows", "validationRules"];

function groupFor(type, member) {
  if (type === "CustomField" || type === "ValidationRule") return member.split(".")[0] || "Other";
  if (type === "ApexClass") return "classes";
  if (type === "ApexTrigger") return "triggers";
  return "components";
}

function labelFor(type, member) {
  if (type === "CustomField" || type === "ValidationRule") return member.split(".").slice(1).join(".") || member;
  return member;
}

export function buildMetadataCatalog(resultsByType, sourceOrg, generatedAt = new Date().toISOString()) {
  const categoryGroups = new Map(CATEGORY_ORDER.map((category) => [category, new Map()]));
  for (const definition of CATALOG_TYPES) {
    const rows = resultsByType[definition.type] ?? [];
    for (const row of rows) {
      if (row.namespacePrefix || typeof row.fullName !== "string" || !row.fullName) continue;
      const group = groupFor(definition.type, row.fullName);
      const groups = categoryGroups.get(definition.category);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({
        type: definition.type,
        member: row.fullName,
        label: labelFor(definition.type, row.fullName),
      });
    }
  }

  return {
    version: 1,
    sourceOrg,
    generatedAt,
    categories: CATEGORY_ORDER.map((key) => ({
      key,
      groups: [...categoryGroups.get(key).entries()]
        .map(([name, items]) => ({
          name,
          items: items.sort((a, b) => a.label.localeCompare(b.label)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };
}

function listMetadata(org, type) {
  const raw = execFileSync(
    "sf",
    ["org", "list", "metadata", "--target-org", org, "--metadata-type", type, "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  const result = JSON.parse(raw).result;
  if (Array.isArray(result)) return result;
  return result ? [result] : [];
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const org = flag("org");
    const out = flag("out", "metadata-catalog.json");
    if (!org) throw new Error("--org is required");
    const results = Object.fromEntries(CATALOG_TYPES.map(({ type }) => [type, listMetadata(org, type)]));
    const catalog = buildMetadataCatalog(results, org);
    writeFileSync(out, JSON.stringify(catalog, null, 2));
    const total = catalog.categories.flatMap((category) => category.groups).flatMap((group) => group.items).length;
    console.log(`Metadata catalogue written for ${total} selectable component(s).`);
  } catch (error) {
    console.error(error.stdout?.toString() || error.message);
    process.exit(1);
  }
}
