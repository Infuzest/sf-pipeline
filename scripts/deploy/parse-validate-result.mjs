#!/usr/bin/env node
/**
 * Parses `sf project deploy validate --json` output.
 * Usage: parse-validate-result.mjs <result.json> [--quickdeploy quickdeploy.json] [--coverage coverage.json] [--errors errors.md]
 * Job outputs: succeeded, validation_id, tests_ran, tests_failed.
 * Exit code mirrors validation success so the step can gate.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { setOutputs } from "../lib/output.mjs";

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

function decodeComponentName(value) {
  const name = String(value ?? "");
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function normalizedFailure(failure) {
  return {
    fullName: decodeComponentName(failure.fullName ?? failure.filePath ?? failure.name),
    type: String(failure.componentType ?? failure.type ?? ""),
    problem: String(failure.problem ?? failure.error ?? failure.errorMessage ?? failure.message ?? ""),
    line: failure.lineNumber ?? failure.line ?? "",
    column: failure.columnNumber ?? failure.column ?? "",
  };
}

/**
 * Salesforce CLI v2 has returned component failures in several different
 * places over time. Prefer structured Metadata API details, then the CLI's
 * files list, and finally recover the human-readable "Error in …" lines from
 * the top-level message. A citizen must never see "0 errors" when Salesforce
 * has supplied the real reason elsewhere in the same response.
 */
function extractFailures(json, result) {
  const fromDetails = asArray(result.details?.componentFailures).map(normalizedFailure);
  if (fromDetails.length) return fromDetails;

  const fromFiles = asArray(result.files)
    .filter(
      (file) =>
        /fail|error/i.test(String(file.state ?? "")) ||
        file.error ||
        file.problem ||
        file.errorMessage
    )
    .map(normalizedFailure);
  if (fromFiles.length) return fromFiles;

  const parsed = [];
  for (const line of String(json.message ?? "").split(/\r?\n/)) {
    const match = line.match(/^Error in (.+?) - (.+)$/);
    if (!match) continue;
    let problem = match[2].trim();
    const location = problem.match(/\s*\((\d+):(\d+)\)\s*$/);
    if (location) problem = problem.slice(0, location.index).trim();
    parsed.push({
      fullName: decodeComponentName(match[1].trim()),
      type: "",
      problem,
      line: location?.[1] ?? "",
      column: location?.[2] ?? "",
    });
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
    lines.push(
      `${parsed.failures.length} Salesforce component${parsed.failures.length === 1 ? " needs" : "s need"} attention.`,
      "",
      "| API Name | Type | Line | Column | Error Message |",
      "|---|---|---:|---:|---|"
    );
    const cell = (value) =>
      String(value ?? "")
        .replaceAll("\\", "\\\\")
        .replaceAll("|", "\\|")
        .replace(/\r?\n/g, "<br>");
    for (const f of parsed.failures) {
      lines.push(
        `| ${cell(f.fullName)} | ${cell(f.type)} | ${cell(f.line)} | ${cell(f.column)} | ${cell(f.problem)} |`
      );
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

  if (parsed.succeeded) {
    console.log(`✔ Validation succeeded (id ${parsed.validationId}, ${parsed.testsRan} tests)`);
  } else {
    console.log(`✖ Validation failed: ${parsed.failures.length} component error(s), ${parsed.testsFailed} test failure(s)`);
    for (const failure of parsed.failures) {
      const location =
        failure.line !== "" || failure.column !== ""
          ? ` (${failure.line || 0}:${failure.column || 0})`
          : "";
      console.log(`  - ${failure.fullName}${failure.type ? ` [${failure.type}]` : ""}${location}: ${failure.problem}`);
    }
    for (const failure of parsed.testFailures) {
      console.log(`  - ${failure.name}.${failure.method}: ${failure.message}`);
    }
    if (!parsed.failures.length && !parsed.testFailures.length && parsed.cliMessage) {
      console.log(`Salesforce CLI reported:\n${parsed.cliMessage}`);
    }
  }
  process.exit(parsed.succeeded ? 0 : 1);
}
