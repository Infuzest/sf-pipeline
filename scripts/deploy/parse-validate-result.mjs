#!/usr/bin/env node
/**
 * Parses `sf project deploy validate --json` output.
 * Usage: parse-validate-result.mjs <result.json> [--quickdeploy quickdeploy.json] [--coverage coverage.json] [--errors errors.md]
 * Job outputs: succeeded, validation_id, tests_ran, tests_failed.
 * Exit code mirrors validation success so the step can gate.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { setOutputs } from "../lib/output.mjs";

/**
 * Component failures, from whichever shape this CLI/API version used.
 *
 * `details.componentFailures` is the MDAPI shape and is often EMPTY on a
 * failed `sf project deploy validate --json` — which is how three real
 * Salesforce errors ("Entity 'Bank_Transactions__c' not found") became
 * "0 component error(s)" and never reached the UI. `result.files` carries them
 * in sf CLI v2, and the CLI always restates them in `message`, so parse that
 * as a last resort rather than reporting a failure with no reason.
 */
function extractFailures(json, result) {
  const fromDetails = (result.details?.componentFailures ?? []).map((f) => ({
    fullName: f.fullName,
    type: f.componentType ?? "",
    problem: f.problem,
    line: f.lineNumber ?? "",
  }));
  if (fromDetails.length) return fromDetails;

  const fromFiles = (result.files ?? [])
    .filter((f) => f.state === "Failed" || f.error)
    .map((f) => ({
      fullName: f.fullName ?? f.filePath ?? "",
      type: f.type ?? "",
      problem: f.error ?? f.problem ?? "",
      line: f.lineNumber ?? "",
    }));
  if (fromFiles.length) return fromFiles;

  // "Error in <name> - <problem> (line:col)", one per line.
  const text = String(json.message ?? "");
  const parsed = [];
  for (const m of text.matchAll(/^Error in (.+?) - (.+?)(?:\s*\((\d+):(\d+)\))?\s*$/gm)) {
    parsed.push({ fullName: m[1], type: "", problem: m[2], line: m[3] ?? "" });
  }
  return parsed;
}

export function parseValidation(json) {
  const result = json.result ?? {};
  const succeeded = json.status === 0 && result.success === true;
  const test = result.details?.runTestResult ?? {};

  const failures = extractFailures(json, result);

  const coverage = (test.codeCoverage ?? []).map((c) => {
    const total = Number(c.numLocations ?? 0);
    const uncovered = Number(c.numLocationsNotCovered ?? 0);
    return {
      name: c.name,
      percent: total === 0 ? 100 : Math.round(((total - uncovered) / total) * 1000) / 10,
      total,
      uncovered,
    };
  });
  const totals = coverage.reduce(
    (acc, c) => ({ total: acc.total + c.total, uncovered: acc.uncovered + c.uncovered }),
    { total: 0, uncovered: 0 }
  );
  const overallCoverage =
    totals.total === 0 ? null : Math.round(((totals.total - totals.uncovered) / totals.total) * 1000) / 10;

  return {
    succeeded,
    cliMessage: json.message ?? null,
    validationId: result.id ?? null,
    failures,
    testsRan: Number(test.numTestsRun ?? 0),
    testsFailed: Number(test.numFailures ?? 0),
    testFailures: (test.failures ?? []).map((f) => ({ name: f.name, method: f.methodName, message: f.message })),
    coverage,
    overallCoverage,
  };
}

export function renderErrorsMarkdown(parsed) {
  const lines = ["## ❌ Validation failed", ""];
  if (parsed.failures.length) {
    lines.push("| Component | Type | Problem | Line |", "|---|---|---|---|");
    for (const f of parsed.failures) {
      lines.push(`| ${f.fullName} | ${f.type} | ${(f.problem ?? "").replaceAll("|", "\\|")} | ${f.line} |`);
    }
  }
  if (parsed.testFailures.length) {
    lines.push("", "### Failing tests", "");
    for (const t of parsed.testFailures) lines.push(`- **${t.name}.${t.method}** — ${t.message}`);
  }
  if (!parsed.failures.length && !parsed.testFailures.length) {
    lines.push(
      parsed.cliMessage
        ? `The CLI reported: \`${parsed.cliMessage}\``
        : "The deployment failed without component-level details — see the workflow run log."
    );
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv;
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i > -1 ? argv[i + 1] : null;
  };
  const parsed = parseValidation(JSON.parse(readFileSync(argv[2], "utf8")));

  setOutputs({
    succeeded: parsed.succeeded,
    validation_id: parsed.validationId ?? "",
    tests_ran: parsed.testsRan,
    tests_failed: parsed.testsFailed,
  });

  if (parsed.succeeded && flag("quickdeploy")) {
    writeFileSync(
      flag("quickdeploy"),
      JSON.stringify({ validationId: parsed.validationId, sha: process.env.GITHUB_SHA ?? null }, null, 2)
    );
  }
  if (flag("coverage")) {
    writeFileSync(
      flag("coverage"),
      JSON.stringify({ overall: parsed.overallCoverage, perClass: parsed.coverage }, null, 2)
    );
  }
  if (!parsed.succeeded && flag("errors")) writeFileSync(flag("errors"), renderErrorsMarkdown(parsed));

  console.log(
    parsed.succeeded
      ? `✔ Validation succeeded (id ${parsed.validationId}, ${parsed.testsRan} tests)`
      : `✖ Validation failed: ${parsed.failures.length} component error(s), ${parsed.testsFailed} test failure(s)`
  );
  process.exit(parsed.succeeded ? 0 : 1);
}
