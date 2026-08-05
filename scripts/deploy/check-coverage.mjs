#!/usr/bin/env node
/**
 * Coverage gate: compares coverage.json (from parse-validate-result.mjs)
 * against a stage's minCoverage.
 * Usage: check-coverage.mjs <coverage.json> <minCoverage> [--has-apex <true|false>] [--summary summary.md]
 * Exits 1 when below threshold.
 */
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Decide the coverage gate. Returns { ok, lines }.
 * `hasApex` distinguishes the two reasons coverage can be absent:
 *   - no Apex in the change  → nothing to cover, gate is not applicable (pass)
 *   - Apex present but no coverage produced → real problem (fail)
 * When hasApex is undefined (caller didn't pass it), fall back to the old
 * strict behaviour so nothing silently loosens.
 */
export function evaluateCoverage({ overall, perClass = [], min, hasApex }) {
  const lines = ["## 🧪 Coverage gate", ""];

  if (min === 0) {
    lines.push("No minimum coverage required for this stage — gate passes.");
    return { ok: true, lines };
  }
  if (hasApex === false) {
    lines.push("No Apex in this change — there's nothing to cover, so the coverage gate does not apply. ✅");
    return { ok: true, lines };
  }
  if (overall === null || overall === undefined) {
    lines.push(
      hasApex === true
        ? `This change contains Apex but produced no coverage, and this stage requires ≥ ${min}%. Make sure the deployed Apex has tests.`
        : `No Apex tests ran, but this stage requires ≥ ${min}% coverage.`
    );
    return { ok: false, lines };
  }

  const mark = overall >= min ? "✅" : "❌";
  lines.push(`${mark} Overall coverage **${overall}%** (required: ${min}%)`);
  const weak = perClass.filter((c) => c.percent < min);
  if (weak.length) {
    lines.push("", "| Class | Coverage |", "|---|---|");
    for (const c of weak) lines.push(`| ${c.name} | ${c.percent}% |`);
  }
  return { ok: overall >= min, lines };
}

// CLI entry (skip when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, minRaw] = process.argv.slice(2);
  const min = Number(minRaw);
  const { overall, perClass } = JSON.parse(readFileSync(file, "utf8"));

  const hasApexIdx = process.argv.indexOf("--has-apex");
  const hasApex = hasApexIdx > -1 ? process.argv[hasApexIdx + 1] === "true" : undefined;

  const { ok, lines } = evaluateCoverage({ overall, perClass, min, hasApex });

  const summaryIdx = process.argv.indexOf("--summary");
  if (summaryIdx > -1) writeFileSync(process.argv[summaryIdx + 1], lines.join("\n"));
  console.log(lines.join("\n"));
  process.exit(ok ? 0 : 1);
}
