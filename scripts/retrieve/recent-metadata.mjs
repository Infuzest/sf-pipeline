#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { selectionManifest, SUPPORTED_METADATA_TYPES } from "./metadata-selection.mjs";

export const RECENT_DAY_OPTIONS = new Set([1, 2, 3, 4, 5, 6, 7, 10]);

export function recentMetadataEntries(catalog, days) {
  if (!RECENT_DAY_OPTIONS.has(days)) throw new Error("Choose 1–7 or 10 days.");
  const generatedAt = Date.parse(catalog?.generatedAt);
  if (!Number.isFinite(generatedAt) || !Array.isArray(catalog?.categories)) {
    throw new Error("The sandbox metadata catalogue is invalid.");
  }
  const threshold = generatedAt - days * 24 * 60 * 60 * 1_000;
  const entries = [];
  const seen = new Set();
  for (const category of catalog.categories) {
    for (const group of category?.groups ?? []) {
      for (const item of group?.items ?? []) {
        const modifiedAt = Date.parse(item?.lastModifiedDate);
        const key = `${item?.type}:${item?.member}`;
        if (
          !SUPPORTED_METADATA_TYPES.has(item?.type) ||
          typeof item?.member !== "string" ||
          !Number.isFinite(modifiedAt) ||
          modifiedAt < threshold ||
          modifiedAt > generatedAt ||
          seen.has(key)
        ) continue;
        seen.add(key);
        entries.push({ type: item.type, member: item.member });
      }
    }
  }
  return entries.sort((a, b) => a.type.localeCompare(b.type) || a.member.localeCompare(b.member));
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const catalogPath = flag("catalog");
    const days = Number(flag("days"));
    const out = flag("out", "retrieve-package.xml");
    const json = flag("json");
    if (!catalogPath) throw new Error("--catalog is required");
    const entries = recentMetadataEntries(JSON.parse(readFileSync(catalogPath, "utf8")), days);
    writeFileSync(out, selectionManifest(entries));
    if (json) {
      writeFileSync(json, JSON.stringify({ total: entries.length, mode: "recent", days, components: entries }, null, 2));
    }
    console.log(`Recent metadata manifest written for ${entries.length} component(s) changed in the last ${days} day(s).`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
