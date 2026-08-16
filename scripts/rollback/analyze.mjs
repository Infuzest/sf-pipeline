#!/usr/bin/env node
/**
 * Rollback safety analysis (REQUIREMENTS.md E5.3). Reads the reverse-delta
 * output (package = components to redeploy at target versions;
 * destructiveChanges = components added after target, delete candidates) and
 * emits per-component warnings about irreversible or risky operations.
 *
 * Usage: analyze.mjs <reverse-delta-dir> --env <env> --from <seq> --to <seq>
 *   --include-destructive <true|false> [--out-md report.md] [--out-json report.json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parsePackageXml } from "../delta/render-comment.mjs";

// Rules keyed by metadata type. `where` = "redeploy" (in package) or "delete" (destructive).
const RISK_RULES = {
  CustomField: {
    delete: "🔴 Deleting a field permanently destroys all data stored in it. This cannot be undone.",
    redeploy: "Field definition (type/length/picklist) reverts; existing record values are not changed.",
  },
  CustomObject: {
    delete: "🔴 Deleting an object permanently destroys the object and ALL its records.",
  },
  Flow: {
    redeploy:
      "⚠️ Deploying an older Flow version ADDS a new version and activates it; newer versions remain in the org (not removed).",
    delete:
      "⚠️ OrbitOps will query the destination org and convert this parent Flow deletion into exact version deletions. Active versions must be deactivated first, and paused interviews or references can still prevent deletion.",
  },
  RecordType: { delete: "⚠️ Deleting a record type can strip it from records that use it." },
  ValidationRule: { redeploy: "Validation rule reverts to its target-version definition." },
  Profile: { redeploy: "⚠️ Profile changes deploy destructively-by-merge and can regress permissions broadly." },
  PermissionSet: { redeploy: "Permission set reverts to its target-version definition." },
  CustomFieldTranslation: {},
};

const PICKLIST_HINT =
  "If this field is a picklist, values in use by records cannot be removed and the deploy may fail.";

export function analyzeRollback({ changed, destructive, meta }) {
  const warnings = [];
  const note = (severity, type, member, text) => warnings.push({ severity, type, member, text });

  for (const [type, members] of Object.entries(changed)) {
    const rule = RISK_RULES[type]?.redeploy;
    for (const m of members) {
      if (rule) note(rule.startsWith("⚠️") || rule.startsWith("🔴") ? "high" : "info", type, m, rule);
      if (type === "CustomField") note("info", type, m, PICKLIST_HINT);
    }
  }
  for (const [type, members] of Object.entries(destructive)) {
    const rule = RISK_RULES[type]?.delete ?? `⚠️ Deleting ${type} may be irreversible — review carefully.`;
    for (const m of members) note("high", type, m, rule);
  }

  const changedCount = Object.values(changed).reduce((n, a) => n + a.length, 0);
  const destructiveCount = Object.values(destructive).reduce((n, a) => n + a.length, 0);
  return {
    ...meta,
    changed,
    destructive,
    changedCount,
    destructiveCount,
    warnings,
    highRiskCount: warnings.filter((w) => w.severity === "high").length,
  };
}

export function renderReport(a) {
  const lines = [
    `## ⏮ Rollback preview — ${a.env}: seq ${a.from} → ${a.to}`,
    "",
    `Restoring **${a.changedCount}** component(s) to their seq-${a.to} versions.`,
  ];
  if (a.destructiveCount) {
    lines.push(
      a.includeDestructive
        ? `Deleting **${a.destructiveCount}** component(s) added after seq ${a.to} (destructive **enabled**).`
        : `**${a.destructiveCount}** component(s) were added after seq ${a.to}. They stay in the org (destructive disabled). Enable destructive rollback to remove them.`
    );
  }
  lines.push("", "### Components to restore", "");
  lines.push(...componentList(a.changed));
  if (a.destructiveCount) {
    lines.push("", `### Components added after seq ${a.to}${a.includeDestructive ? " — will be DELETED" : " — left in place"}`, "");
    lines.push(...componentList(a.destructive, a.includeDestructive));
  }
  if (a.warnings.length) {
    lines.push("", "### ⚠️ Safety warnings", "");
    const high = a.warnings.filter((w) => w.severity === "high");
    const info = a.warnings.filter((w) => w.severity !== "high");
    for (const w of [...high, ...info]) lines.push(`- **${w.type} \`${w.member}\`** — ${w.text}`);
  }
  lines.push(
    "",
    "> Rollback restores **metadata only**. Data already changed, deleted records, and",
    "> org-side manual changes are not restored. Review the warnings before executing.",
    ""
  );
  return lines.join("\n");
}

function componentList(map, strike = false) {
  const out = [];
  for (const [type, members] of Object.entries(map).sort()) {
    if (!members.length) continue;
    out.push(`- **${type}** (${members.length})`);
    for (const m of members.sort()) out.push(`  - ${strike ? `~~${m}~~` : m}`);
  }
  return out.length ? out : ["_none_"];
}

function readPkg(dir, sub, file) {
  const p = join(dir, sub, file);
  return existsSync(p) ? parsePackageXml(readFileSync(p, "utf8")) : {};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = (n, d = null) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > -1 ? process.argv[i + 1] : d;
  };
  const dir = process.argv[2];
  const includeDestructive = flag("include-destructive") === "true";
  const a = analyzeRollback({
    changed: readPkg(dir, "package", "package.xml"),
    destructive: readPkg(dir, "destructiveChanges", "destructiveChanges.xml"),
    meta: { env: flag("env"), from: Number(flag("from")), to: Number(flag("to")), includeDestructive },
  });
  const md = renderReport(a);
  if (flag("out-md")) writeFileSync(flag("out-md"), md);
  if (flag("out-json")) writeFileSync(flag("out-json"), JSON.stringify(a, null, 2));
  console.log(md);
}
