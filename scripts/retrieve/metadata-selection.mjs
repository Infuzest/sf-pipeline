#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SUPPORTED_METADATA_TYPES = new Set([
  "CustomField",
  "ApexClass",
  "ApexTrigger",
  "LightningComponentBundle",
  "AuraDefinitionBundle",
  "Flow",
  "ValidationRule",
]);

const MEMBER_PATTERN = /^[A-Za-z0-9_$.-]+$/;

export function parseMetadataSelection(raw, limit = 500) {
  const tokens = String(raw ?? "")
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = [...new Set(tokens)];
  if (!unique.length) throw new Error("Select at least one metadata component.");
  if (unique.length > limit) throw new Error(`Select no more than ${limit} metadata components at a time.`);

  return unique.map((token) => {
    const separator = token.indexOf(":");
    if (separator < 1) throw new Error(`Invalid metadata selection: ${token}`);
    const type = token.slice(0, separator);
    const member = token.slice(separator + 1);
    if (!SUPPORTED_METADATA_TYPES.has(type) || !MEMBER_PATTERN.test(member)) {
      throw new Error(`Unsupported metadata selection: ${token}`);
    }
    return { type, member };
  });
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function selectionManifest(entries, apiVersion = "64.0") {
  const byType = new Map();
  for (const entry of entries) {
    if (!byType.has(entry.type)) byType.set(entry.type, new Set());
    byType.get(entry.type).add(entry.member);
  }
  const types = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, members]) =>
      [
        "    <types>",
        ...[...members].sort().map((member) => `        <members>${escapeXml(member)}</members>`),
        `        <name>${type}</name>`,
        "    </types>",
      ].join("\n")
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${types}\n    <version>${apiVersion}</version>\n</Package>\n`;
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const out = flag("out", "retrieve-package.xml");
    const json = flag("json");
    const entries = parseMetadataSelection(process.env.ORBITOPS_SELECTION);
    writeFileSync(out, selectionManifest(entries));
    if (json) writeFileSync(json, JSON.stringify({ total: entries.length, mode: "selected", components: entries }, null, 2));
    console.log(`Selected metadata manifest written for ${entries.length} component(s).`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
