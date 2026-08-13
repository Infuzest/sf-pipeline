#!/usr/bin/env node
/**
 * Validates .orbitops/pipeline.yml against .orbitops/schema/pipeline.schema.json,
 * plus cross-item rules the schema can't express (uniqueness).
 *
 * Usage: node scripts/validate-pipeline-config.mjs [path/to/pipeline.yml]
 * Exit codes: 0 valid, 1 invalid, 2 unreadable input.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { Ajv2020 } from "ajv/dist/2020.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(process.argv[2] ?? resolve(repoRoot, ".orbitops/pipeline.yml"));
const schemaPath = resolve(repoRoot, ".orbitops/schema/pipeline.schema.json");

function fail(code, lines) {
  console.error(`✖ ${configPath}`);
  for (const line of lines) console.error(`  - ${line}`);
  process.exit(code);
}

let config;
try {
  config = yaml.load(readFileSync(configPath, "utf8"));
} catch (err) {
  fail(2, [`Could not read or parse YAML: ${err.message}`]);
}

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);

const errors = [];
if (!validate(config)) {
  for (const e of validate.errors) {
    const where = e.instancePath || "(root)";
    const extra = e.keyword === "additionalProperties" ? ` ("${e.params.additionalProperty}")` : "";
    errors.push(`${where}: ${e.message}${extra}`);
  }
}

// Cross-item rules
if (Array.isArray(config?.pipeline)) {
  for (const key of ["branch", "org", "environment"]) {
    const seen = new Map();
    config.pipeline.forEach((stage, i) => {
      const v = stage?.[key];
      if (v === undefined) return;
      if (seen.has(v)) errors.push(`/pipeline/${i}/${key}: duplicate ${key} "${v}" (first used by stage ${seen.get(v)})`);
      else seen.set(v, i);
    });
  }
}
if (Array.isArray(config?.devOrgs)) {
  // Dev orgs may reuse a stage org key (shared org) but must be unique among themselves.
  for (const key of ["name", "org"]) {
    const seen = new Map();
    config.devOrgs.forEach((d, i) => {
      const v = d?.[key];
      if (v === undefined) return;
      if (seen.has(v)) errors.push(`/devOrgs/${i}/${key}: duplicate ${key} "${v}" (first used by devOrgs ${seen.get(v)})`);
      else seen.set(v, i);
    });
  }
}

if (errors.length) fail(1, errors);
console.log(`✔ ${configPath} is valid (${config.pipeline.length} stages: ${config.pipeline.map((s) => s.branch).join(" → ")})`);
