import { test } from "node:test";
import assert from "node:assert/strict";
import { parseValidation, renderErrorsMarkdown } from "./parse-validate-result.mjs";

const SUCCESS = {
  status: 0,
  result: {
    success: true,
    id: "0AfKa00000TESTID",
    details: {
      runTestResult: {
        numTestsRun: "12",
        numFailures: "0",
        codeCoverage: [
          { name: "DiscountService", numLocations: "100", numLocationsNotCovered: "10" },
          { name: "CaseRouter", numLocations: "50", numLocationsNotCovered: "25" },
        ],
        failures: [],
      },
    },
  },
};

const FAILURE = {
  status: 1,
  result: {
    success: false,
    id: "0AfKa00000FAILID",
    details: {
      componentFailures: [
        {
          fullName: "DiscountService",
          componentType: "ApexClass",
          problem: "Method does not exist: applyDiscnt",
          lineNumber: 42,
        },
      ],
      runTestResult: {
        numTestsRun: "12",
        numFailures: "1",
        failures: [{ name: "DiscountServiceTest", methodName: "testApply", message: "Assertion failed" }],
      },
    },
  },
};

test("parses successful validation with coverage", () => {
  const p = parseValidation(SUCCESS);
  assert.equal(p.succeeded, true);
  assert.equal(p.validationId, "0AfKa00000TESTID");
  assert.equal(p.overallCoverage, 76.7); // 150 locations, 35 uncovered
  assert.equal(p.coverage.find((c) => c.name === "CaseRouter").percent, 50);
});

test("parses failure with component errors and test failures", () => {
  const p = parseValidation(FAILURE);
  assert.equal(p.succeeded, false);
  assert.equal(p.failures.length, 1);
  assert.equal(p.testsFailed, 1);
  const md = renderErrorsMarkdown(p);
  assert.match(md, /Method does not exist: applyDiscnt/);
  assert.match(md, /DiscountServiceTest\.testApply/);
});

test("no tests → overall coverage null", () => {
  const p = parseValidation({ status: 0, result: { success: true, id: "x", details: {} } });
  assert.equal(p.overallCoverage, null);
  assert.equal(p.testsRan, 0);
});

test("CLI-level error (no result body) surfaces the message", () => {
  const p = parseValidation({ status: 1, name: "Error", message: "Expected --test-level=NoTestRun to be one of: ..." });
  assert.equal(p.succeeded, false);
  assert.match(renderErrorsMarkdown(p), /Expected --test-level=NoTestRun/);
});

/**
 * Real regression: `sf project deploy validate --json` reported three
 * component errors in `message` while `details.componentFailures` was empty,
 * so the pipeline said "0 component error(s)" and the UI showed no reason at
 * all. Captured verbatim from sf-pipeline PR #29.
 */
const CLI_MESSAGE_ONLY = {
  status: 1,
  message:
    "Failed to validate the deployment (0AfgK00000PdJKdSAN). Due To:\n" +
    "Error in Bank_Transactions__c.Amount__c - Entity 'Bank_Transactions__c' not found. (167:13)\n" +
    "Error in Bank_Transactions__c.Description__c - Entity 'Bank_Transactions__c' not found. (177:13)\n" +
    "Error in Bank_Transactions__c-Bank Transactions Layout - Parent entity failed to deploy\n\n" +
    "3 component error(s)",
  result: { success: false, details: {} },
};

test("recovers component errors from the CLI message when componentFailures is empty", () => {
  const parsed = parseValidation(CLI_MESSAGE_ONLY);
  assert.equal(parsed.succeeded, false);
  assert.equal(parsed.failures.length, 3);
  assert.deepEqual(parsed.failures[0], {
    fullName: "Bank_Transactions__c.Amount__c",
    type: "",
    problem: "Entity 'Bank_Transactions__c' not found.",
    line: "167",
  });
  // The trailing error carries no line/column.
  assert.equal(parsed.failures[2].fullName, "Bank_Transactions__c-Bank Transactions Layout");
  assert.equal(parsed.failures[2].line, "");
});

test("those errors reach the markdown table instead of the generic fallback", () => {
  const md = renderErrorsMarkdown(parseValidation(CLI_MESSAGE_ONLY));
  assert.match(md, /\| Component \| Type \| Problem \| Line \|/);
  assert.match(md, /Bank_Transactions__c\.Amount__c/);
  assert.doesNotMatch(md, /The CLI reported/);
});

test("reads the sf CLI v2 files[] shape", () => {
  const parsed = parseValidation({
    status: 1,
    result: {
      success: false,
      files: [
        { fullName: "Foo__c.Bar__c", type: "CustomField", state: "Failed", error: "Entity not found", lineNumber: 12 },
        { fullName: "Baz__c", type: "CustomObject", state: "Changed" },
      ],
    },
  });
  assert.equal(parsed.failures.length, 1);
  assert.equal(parsed.failures[0].type, "CustomField");
  assert.equal(parsed.failures[0].problem, "Entity not found");
});

test("componentFailures still wins when present", () => {
  const parsed = parseValidation({
    status: 1,
    message: "Error in Ignored__c - should not be used",
    result: {
      success: false,
      details: { componentFailures: [{ fullName: "Real__c", componentType: "CustomObject", problem: "Boom" }] },
    },
  });
  assert.equal(parsed.failures.length, 1);
  assert.equal(parsed.failures[0].fullName, "Real__c");
});
