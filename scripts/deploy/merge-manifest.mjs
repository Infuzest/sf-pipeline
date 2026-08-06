#!/usr/bin/env node
/**
 * Adds explicitly-requested components to a delta package.xml.
 *
 * The delta is computed from the diff between the last deploy tag and HEAD, so
 * it only ever describes what CHANGED IN GIT. It cannot describe what's missing
 * from the ORG. Any divergence — a merge that landed while the pipeline was
 * down, a deploy cancelled in the queue, a hand-edited or refreshed org, a
 * partially-applied deploy — leaves the org behind the branch with nothing in
 * the diff to say so, and every later delta deploy fails on the gap
 * ("Entity 'Bank_Transactions__c' not found").
 *
 * This is the escape hatch: name the components to include and they're merged
 * into the manifest alongside the delta. Full re-deploy is the other lever
 * (--source-dir), for when the drift is too broad to enumerate.
 *
 * Usage: merge-manifest.mjs <package.xml> --include "CustomObject:Foo__c, CustomField:Foo__c.Bar__c" [--api 64.0] [--out <file>]
 *   Entries are `Type:Member`, separated by commas or newlines. `Type:*` is
 *   accepted for a whole-type wildcard.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parsePackageXml } from "../delta/render-comment.mjs";

const DEFAULT_API = "64.0";

/** "CustomObject:Foo__c, CustomField:Foo__c.Bar__c" → { CustomObject: ["Foo__c"], … } */
export function parseInclude(spec) {
  const out = {};
  for (const raw of String(spec ?? "").split(/[,\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const idx = entry.indexOf(":");
    if (idx < 1 || idx === entry.length - 1) {
      throw new Error(`Not a Type:Member entry: "${entry}"`);
    }
    const type = entry.slice(0, idx).trim();
    const member = entry.slice(idx + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(type)) throw new Error(`Not a metadata type: "${type}"`);
    (out[type] ??= []).push(member);
  }
  return out;
}

/** Deterministic package.xml: types sorted by name, members sorted within. */
export function renderPackageXml(types, apiVersion = DEFAULT_API) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<Package xmlns="http://soap.sforce.com/2006/04/metadata">'];
  for (const name of Object.keys(types).sort()) {
    const members = [...new Set(types[name])].sort();
    if (!members.length) continue;
    lines.push("    <types>");
    for (const m of members) lines.push(`        <members>${m}</members>`);
    lines.push(`        <name>${name}</name>`, "    </types>");
  }
  lines.push(`    <version>${apiVersion}</version>`, "</Package>", "");
  return lines.join("\n");
}

export function mergeManifest(existingXml, include, apiVersion) {
  const base = existingXml ? parsePackageXml(existingXml) : {};
  const extra = typeof include === "string" ? parseInclude(include) : (include ?? {});
  const merged = { ...base };
  for (const [type, members] of Object.entries(extra)) {
    // A whole-type wildcard supersedes individually named members.
    merged[type] = members.includes("*") ? ["*"] : [...new Set([...(merged[type] ?? []), ...members])];
  }
  const version =
    apiVersion ?? existingXml?.match(/<version>(.*?)<\/version>/)?.[1] ?? DEFAULT_API;
  return { types: merged, xml: renderPackageXml(merged, version) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv;
  const flag = (name, dflt = null) => {
    const i = argv.indexOf(`--${name}`);
    return i > -1 ? argv[i + 1] : dflt;
  };
  const path = argv[2];
  const existing = path && existsSync(path) ? readFileSync(path, "utf8") : null;
  const { types, xml } = mergeManifest(existing, flag("include", ""), flag("api"));
  writeFileSync(flag("out") ?? path, xml);
  const count = Object.values(types).reduce((n, m) => n + m.length, 0);
  console.log(`Manifest now lists ${count} component(s) across ${Object.keys(types).length} type(s)`);
}
