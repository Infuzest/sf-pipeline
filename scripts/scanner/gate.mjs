#!/usr/bin/env node
/**
 * Scanner severity gate.
 * Usage: gate.mjs <results.sarif> <maxSeverity> [--baseline baseline.json]
 *   [--out summary.md] [--comment-out scan-comment.md]
 * A NEW finding (not in baseline) with severity <= maxSeverity (1 = most severe)
 * blocks. Exit 1 when blocked. Job outputs: total, new, blockers.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadSarifFile, isBaselined } from "./sarif.mjs";
import { setOutputs } from "../lib/output.mjs";

export function evaluateGate(findings, maxSeverity, baseline) {
  const fresh = findings.filter((f) => !isBaselined(f, baseline));
  const blockers = fresh.filter((f) => f.severity <= maxSeverity);
  return { fresh, blockers };
}

const SEVERITY_LABELS = {
  1: "Critical",
  2: "High",
  3: "Moderate",
  4: "Low",
  5: "Information",
};

const RULE_GUIDANCE = {
  TriggerEntryCriteria:
    "Add entry conditions in the Flow's Start configuration so it runs only for records that need it.",
  SameRecordUpdate:
    "Where possible, change the record-triggered Flow to run before save when it only updates the record that started it.",
};

export function severityLabel(severity) {
  return SEVERITY_LABELS[severity] ?? `Severity ${severity}`;
}

export function componentLabel(file) {
  const normalized = String(file ?? "").replaceAll("\\", "/");
  const patterns = [
    [/\/flows\/([^/]+)\.flow-meta\.xml$/, "Flow"],
    [/\/classes\/([^/]+)\.cls(?:-meta\.xml)?$/, "Apex class"],
    [/\/triggers\/([^/]+)\.trigger(?:-meta\.xml)?$/, "Apex trigger"],
    [/\/lwc\/([^/]+)\//, "Lightning web component"],
    [/\/aura\/([^/]+)\//, "Aura component"],
  ];
  for (const [pattern, kind] of patterns) {
    const match = normalized.match(pattern);
    if (match) return `${kind} “${match[1]}”`;
  }
  const name = normalized.split("/").at(-1) || "changed component";
  return `Component “${name}”`;
}

export function findingGuidance(finding) {
  return (
    RULE_GUIDANCE[finding.rule] ??
    "Review the scanner message with a developer and update this component before promoting the change."
  );
}

export function toFindingContract(finding) {
  return {
    rule: finding.rule,
    engine: finding.engine ?? "unknown",
    file: finding.file,
    line: finding.line,
    message: finding.message,
    severity: finding.severity,
    severityLabel: severityLabel(finding.severity),
    component: componentLabel(finding.file),
    guidance: findingGuidance(finding),
    helpUri: finding.helpUri ?? null,
  };
}

export function renderScanContract({ findings, fresh, blockers, maxSeverity }) {
  return {
    version: 1,
    maxSeverity,
    totalCount: findings.length,
    newCount: fresh.length,
    blockingCount: blockers.length,
    blockers: blockers.slice(0, 100).map(toFindingContract),
    nonBlocking: fresh
      .filter((finding) => !blockers.includes(finding))
      .slice(0, 100)
      .map(toFindingContract),
  };
}

export function renderScanComment(args) {
  const encoded = Buffer.from(JSON.stringify(renderScanContract(args)), "utf8").toString("base64url");
  return `<!-- orbitops:scan -->\n<!-- orbitops:scan-data:v1 ${encoded} -->\n${renderSummary(args)}\n`;
}

function escapeWorkflowCommand(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

function emitAnnotations(blockers) {
  for (const finding of blockers.slice(0, 50)) {
    const title = `${severityLabel(finding.severity)} code scan issue: ${finding.rule}`;
    const properties = [
      `file=${escapeWorkflowCommand(finding.file)}`,
      ...(finding.line > 0 ? [`line=${finding.line}`, `endLine=${finding.line}`] : []),
      `title=${escapeWorkflowCommand(title)}`,
    ].join(",");
    const message = `${finding.message} What to do: ${findingGuidance(finding)}`;
    console.log(`::error ${properties}::${escapeWorkflowCommand(message)}`);
  }
}

export function renderSummary({ findings, fresh, blockers, maxSeverity }) {
  const lines = [blockers.length ? "## ❌ Code quality checks need attention" : "## ✅ Code scan passed", ""];
  if (findings.length === 0) {
    lines.push("No code-quality or security issues were found in the changed files.");
    return lines.join("\n");
  }
  lines.push(
    blockers.length
      ? `**${blockers.length} new ${blockers.length === 1 ? "issue" : "issues"} must be resolved before this change can be promoted.**`
      : "No new issues exceed this stage's blocking threshold.",
    "",
    `${findings.length} total finding${findings.length === 1 ? "" : "s"} in the changed files; ` +
      `${fresh.length} ${fresh.length === 1 ? "is" : "are"} new. This stage blocks ${severityLabel(maxSeverity)} (${maxSeverity}) or more serious findings.`,
    ""
  );
  const show = (list, title) => {
    if (!list.length) return;
    lines.push(`### ${title}`, "");
    for (const [index, f] of list.slice(0, 25).entries()) {
      const rule = f.helpUri ? `[${f.rule}](${f.helpUri})` : f.rule;
      lines.push(
        `#### ${index + 1}. ${componentLabel(f.file)}`,
        "",
        `- **Severity:** ${severityLabel(f.severity)} (${f.severity})`,
        `- **Rule:** ${rule}`,
        `- **Where:** \`${f.file}${f.line ? `:${f.line}` : ""}\``,
        `- **What the scanner found:** ${f.message}`,
        `- **What to do:** ${findingGuidance(f)}`,
        ""
      );
    }
    if (list.length > 25) lines.push("", `…and ${list.length - 25} more (see the SARIF artifact).`);
  };
  show(blockers, "Blocking issues");
  show(
    fresh.filter((f) => !blockers.includes(f)),
    "Other new findings that do not block this stage"
  );
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [sarifPath, maxRaw] = process.argv.slice(2);
  const maxSeverity = Number(maxRaw);
  const baselineIdx = process.argv.indexOf("--baseline");
  const baseline =
    baselineIdx > -1 && existsSync(process.argv[baselineIdx + 1])
      ? JSON.parse(readFileSync(process.argv[baselineIdx + 1], "utf8"))
      : [];

  const findings = existsSync(sarifPath) ? loadSarifFile(sarifPath) : [];
  const { fresh, blockers } = evaluateGate(findings, maxSeverity, baseline);
  const args = { findings, fresh, blockers, maxSeverity };
  const summary = renderSummary(args);

  const outIdx = process.argv.indexOf("--out");
  if (outIdx > -1) writeFileSync(process.argv[outIdx + 1], summary);
  const commentOutIdx = process.argv.indexOf("--comment-out");
  if (commentOutIdx > -1) writeFileSync(process.argv[commentOutIdx + 1], renderScanComment(args));
  console.log(summary);
  emitAnnotations(blockers);

  setOutputs({ total: findings.length, new: fresh.length, blockers: blockers.length });
  process.exit(blockers.length ? 1 : 0);
}
