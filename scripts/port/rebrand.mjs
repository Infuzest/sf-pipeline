#!/usr/bin/env node
/**
 * Rebrand the pipeline for a new GitHub org when porting (see docs/PORTING.md).
 *
 * GitHub forbids expressions in a reusable workflow's `uses:` field, so the
 * caller workflows hardcode the owner/repo — this rewrites that one literal.
 * Everything else the platform reads (PIPELINE_REPO, roles, CODEOWNERS teams)
 * is config, not code, and is listed as manual follow-ups.
 *
 * Usage: node scripts/port/rebrand.mjs --org <NEW_ORG> [--repo sf-pipeline] [--from SalikPOC] [--dry]
 * Run once per stage branch (main, uat, integration) — the callers live on each.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
};
const dry = process.argv.includes("--dry");
const from = arg("from", "SalikPOC");
const repo = arg("repo", "sf-pipeline");
const org = arg("org");

if (!org) {
  console.error("Usage: rebrand.mjs --org <NEW_ORG> [--repo sf-pipeline] [--from SalikPOC] [--dry]");
  process.exit(2);
}

const callers = [".github/workflows/pr-validate.yml", ".github/workflows/deploy.yml"];
const needle = `${from}/${repo}/`;
const replacement = `${org}/${repo}/`;

let changed = 0;
for (const path of callers) {
  if (!existsSync(path)) {
    console.warn(`• skip ${path} (not on this branch)`);
    continue;
  }
  const before = readFileSync(path, "utf8");
  if (!before.includes(needle)) {
    console.log(`• ${path}: no "${needle}" reference (already rebranded?)`);
    continue;
  }
  const after = before.split(needle).join(replacement);
  if (dry) {
    console.log(`• ${path}: would rewrite ${needle} → ${replacement}`);
  } else {
    writeFileSync(path, after);
    console.log(`✔ ${path}: ${needle} → ${replacement}`);
  }
  changed++;
}

console.log(`\n${dry ? "[dry run] " : ""}rewrote ${changed} file(s).`);
console.log(`\nManual follow-ups (config, not code — see docs/PORTING.md):`);
console.log(`  1. CODEOWNERS: replace @${from} with your Bupa team slug(s).`);
console.log(`  2. orbitops-ui env: PIPELINE_REPO=${org}/${repo}`);
console.log(`  3. orbitops-ui env: ROLE_RELEASE_MANAGERS / ROLE_ADMINS = EMU usernames or team checks.`);
console.log(`  4. Re-run this on every stage branch (main, uat, integration).`);
